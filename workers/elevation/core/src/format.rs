//! An R2 object for one degree (`dem3/N43E042`, the name as of the HGT file).
//!
//! Layout: a header of `HEADER_LEN` bytes: magic `NKE1`, `u16` chunk size, `u16` number of parts of
//! a degree, `CHUNKS + 1` offsets `u32` LE (the start of each chunk and the end of the last); then
//! chunks. A chunk is a quarter degree of 301×301 nodes with an overlap of one row and one column,
//! as in the Go server of the author (`wladich/elevation_server`, `HgtSplitParts = 4`): thus each
//! point interpolates in one chunk. The chunk order is `dy * SPLIT + dx`; `dy` and the rows in a
//! chunk go from the south (HGT goes from the north). Values are `i16` in meters, `NO_VALUE` is no
//! data; zstd compresses the deltas (`wrapping_sub` in sequence across the chunk, the first value
//! is a delta from zero). A chunk of zero length has no data (`repack --only` thins the fixtures
//! like this).

use std::io::Read;

use crate::Error;

pub const MAGIC: &[u8; 4] = b"NKE1";
pub const TILE_SIZE: usize = 301;
pub const SPLIT: usize = 4;
pub const CHUNKS: usize = SPLIT * SPLIT;
pub const CHUNK_VALUES: usize = TILE_SIZE * TILE_SIZE;
pub const HEADER_LEN: usize = 8 + (CHUNKS + 1) * 4;
pub const NO_VALUE: i16 = i16::MIN;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Header {
    offsets: [u32; CHUNKS + 1],
}

impl Header {
    pub fn parse(bytes: &[u8]) -> Result<Header, Error> {
        if bytes.len() != HEADER_LEN || &bytes[..4] != MAGIC {
            return Err(Error::Format("bad header"));
        }
        let tile_size = u16::from_le_bytes([bytes[4], bytes[5]]) as usize;
        let split = u16::from_le_bytes([bytes[6], bytes[7]]) as usize;
        if tile_size != TILE_SIZE || split != SPLIT {
            return Err(Error::Format("unsupported grid"));
        }
        let mut offsets = [0u32; CHUNKS + 1];
        for (i, offset) in offsets.iter_mut().enumerate() {
            let at = 8 + i * 4;
            *offset = u32::from_le_bytes(bytes[at..at + 4].try_into().unwrap());
        }
        if offsets[0] as usize != HEADER_LEN || offsets.windows(2).any(|w| w[0] > w[1]) {
            return Err(Error::Format("bad offsets"));
        }
        Ok(Header { offsets })
    }

    pub fn chunk_range(&self, chunk: usize) -> Option<(u64, u64)> {
        let start = self.offsets[chunk] as u64;
        let end = self.offsets[chunk + 1] as u64;
        if start == end {
            return None;
        }
        Some((start, end - start))
    }
}

// In wasm, decompression is pure Rust (`ruzstd`): C zstd does not build for wasm32-unknown-unknown.
pub fn decode_chunk(compressed: &[u8]) -> Result<Vec<i16>, Error> {
    let mut decoder = ruzstd::decoding::StreamingDecoder::new(compressed)
        .map_err(|_| Error::Format("bad zstd frame"))?;
    let mut raw = Vec::with_capacity(CHUNK_VALUES * 2);
    decoder
        .read_to_end(&mut raw)
        .map_err(|_| Error::Format("bad zstd data"))?;
    if raw.len() != CHUNK_VALUES * 2 {
        return Err(Error::Format("bad chunk size"));
    }
    let mut values = Vec::with_capacity(CHUNK_VALUES);
    let mut previous = 0i16;
    let (pairs, _) = raw.as_chunks::<2>();
    for &pair in pairs {
        previous = previous.wrapping_add(i16::from_le_bytes(pair));
        values.push(previous);
    }
    Ok(values)
}

#[cfg(feature = "encode")]
pub fn encode_chunk(values: &[i16], level: i32) -> Vec<u8> {
    assert_eq!(values.len(), CHUNK_VALUES);
    let mut raw = Vec::with_capacity(CHUNK_VALUES * 2);
    let mut previous = 0i16;
    for &value in values {
        raw.extend_from_slice(&value.wrapping_sub(previous).to_le_bytes());
        previous = value;
    }
    zstd::bulk::compress(&raw, level).expect("zstd compression")
}

#[cfg(feature = "encode")]
pub fn encode_degree(chunks: &[Option<Vec<i16>>], level: i32) -> Vec<u8> {
    assert_eq!(chunks.len(), CHUNKS);
    let encoded: Vec<Vec<u8>> = chunks
        .iter()
        .map(|chunk| {
            chunk
                .as_ref()
                .map(|values| encode_chunk(values, level))
                .unwrap_or_default()
        })
        .collect();
    assemble_degree(&encoded)
}

/// A degree object from chunks that are already compressed (empty means no data). It was public for
/// the thinning of fixtures by the elevation tile generator (`elevation-tiles thin`), which change
/// retire-old-client-services removed.
#[cfg(feature = "encode")]
fn assemble_degree(encoded: &[Vec<u8>]) -> Vec<u8> {
    assert_eq!(encoded.len(), CHUNKS);
    let mut object = Vec::with_capacity(HEADER_LEN + encoded.iter().map(Vec::len).sum::<usize>());
    object.extend_from_slice(MAGIC);
    object.extend_from_slice(&(TILE_SIZE as u16).to_le_bytes());
    object.extend_from_slice(&(SPLIT as u16).to_le_bytes());
    let mut offset = HEADER_LEN as u32;
    object.extend_from_slice(&offset.to_le_bytes());
    for chunk in encoded {
        offset += chunk.len() as u32;
        object.extend_from_slice(&offset.to_le_bytes());
    }
    for chunk in encoded {
        object.extend_from_slice(chunk);
    }
    object
}
