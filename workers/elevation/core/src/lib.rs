use std::collections::BTreeMap;

use futures::stream::{self, StreamExt, TryStreamExt};

pub mod format;
pub mod grid;
pub mod http;
pub mod request;
pub mod response;

use format::{HEADER_LEN, Header};
use grid::Cell;

// R2 reads go in batches: one Worker invocation has a maximum of 10 000 subrequests and a limited
// number of simultaneous connections.
pub(crate) const PARALLEL_READS: usize = 16;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Error {
    Format(&'static str),
    Source(String),
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Error::Format(message) => write!(f, "format error: {message}"),
            Error::Source(message) => write!(f, "source error: {message}"),
        }
    }
}

impl std::error::Error for Error {}

// The only I/O point of the core: read a byte range of an object, `None` means there is no object.
// Adapters: R2 (`worker`), files (`server`), memory (tests).
#[allow(async_fn_in_trait)]
pub trait Source {
    async fn read(&self, key: &str, offset: u64, length: u64) -> Result<Option<Vec<u8>>, Error>;
}

type ChunkPoints = BTreeMap<usize, Vec<(usize, Cell)>>;

fn group(points: &[(f64, f64)]) -> BTreeMap<String, ChunkPoints> {
    let mut degrees: BTreeMap<String, ChunkPoints> = BTreeMap::new();
    for (index, &(lat, lon)) in points.iter().enumerate() {
        let Some(cell) = grid::locate(lat, lon) else {
            continue;
        };
        degrees
            .entry(grid::object_key(cell.lat0, cell.lon0))
            .or_default()
            .entry(cell.chunk)
            .or_default()
            .push((index, cell));
    }
    degrees
}

/// The number of storage reads that `elevations` does: the header of each degree it touches and
/// each chunk it touches. It is counted before the read and without the adapter cache; it limits
/// the cost of the request (R2 class B per read, `http::MAX_READS` and the read budget).
pub fn read_count(points: &[(f64, f64)]) -> usize {
    let degrees = group(points);
    degrees.len() + degrees.values().map(BTreeMap::len).sum::<usize>()
}

// The points are grouped by degrees and chunks: the header and each chunk are read once per
// request, the chunks are decompressed one at a time, so the wasm memory does not keep all of them
// at once.
pub async fn elevations<S: Source>(
    source: &S,
    points: &[(f64, f64)],
) -> Result<Vec<Option<f64>>, Error> {
    let mut result = vec![None; points.len()];
    let degrees = group(points);

    let headers: Vec<(String, Option<Header>)> = stream::iter(degrees.keys().cloned())
        .map(|key| async move {
            let header = match source.read(&key, 0, HEADER_LEN as u64).await? {
                Some(bytes) => Some(Header::parse(&bytes)?),
                None => None,
            };
            Ok::<_, Error>((key, header))
        })
        .buffered(PARALLEL_READS)
        .try_collect()
        .await?;

    let mut reads = Vec::new();
    for (key, header) in &headers {
        let Some(header) = header else {
            continue;
        };
        for &chunk in degrees[key].keys() {
            if let Some(range) = header.chunk_range(chunk) {
                reads.push((key.as_str(), chunk, range));
            }
        }
    }

    let mut chunks = stream::iter(reads)
        .map(|(key, chunk, (offset, length))| async move {
            let bytes = source
                .read(key, offset, length)
                .await?
                .ok_or_else(|| Error::Source(format!("{key} disappeared")))?;
            Ok::<_, Error>((key, chunk, bytes))
        })
        .buffered(PARALLEL_READS);
    while let Some((key, chunk, bytes)) = chunks.try_next().await? {
        let values = format::decode_chunk(&bytes)?;
        for (index, cell) in &degrees[key][&chunk] {
            result[*index] = grid::interpolate(&values, cell);
        }
    }
    Ok(result)
}
