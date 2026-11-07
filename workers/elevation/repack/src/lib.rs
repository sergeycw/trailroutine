//! HGT 3″ (viewfinderpanoramas, 1201×1201 `i16` big-endian, rows from the north, nodata `-32768`)
//! → a degree object from `elevation_core::format`. The split into chunks repeats `splitDem` from
//! `cmd/make_data` of the Go server of the author.
//!
//! Several viewfinderpanoramas `dem3/` zips contain 1″ tiles (3601×3601, for example `N63E008` in
//! zone P). The 3″ nodes are exactly each third 1″ node (3600 = 3 × 1200), thus such tiles
//! are thinned to 1201×1201 without interpolation.

use elevation_core::format::{CHUNKS, SPLIT, TILE_SIZE, encode_degree};

pub const HGT_SIZE: usize = 1201;
pub const HGT_BYTES: usize = HGT_SIZE * HGT_SIZE * 2;
pub const HGT1_SIZE: usize = 3601;
pub const HGT1_BYTES: usize = HGT1_SIZE * HGT1_SIZE * 2;

#[derive(Debug, PartialEq, Eq)]
pub enum RepackError {
    BadName(String),
    BadSize(usize),
}

impl std::fmt::Display for RepackError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RepackError::BadName(name) => write!(f, "not an HGT name: {name}"),
            RepackError::BadSize(size) => {
                write!(
                    f,
                    "HGT must be {HGT_BYTES} (3″) or {HGT1_BYTES} (1″) bytes, got {size}"
                )
            }
        }
    }
}

impl std::error::Error for RepackError {}

// `N43E042.hgt` (any case, with a path) → `N43E042`. The file name is the only source of the
// degree coordinates: HGT has no header.
pub fn degree_name(file_name: &str) -> Result<String, RepackError> {
    let bad = || RepackError::BadName(file_name.to_string());
    let base = file_name
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(file_name)
        .to_ascii_uppercase();
    let stem = base.strip_suffix(".HGT").ok_or_else(bad)?;
    let bytes = stem.as_bytes();
    let well_formed = bytes.len() == 7
        && matches!(bytes[0], b'N' | b'S')
        && matches!(bytes[3], b'E' | b'W')
        && bytes[1..3]
            .iter()
            .chain(&bytes[4..7])
            .all(u8::is_ascii_digit);
    if !well_formed {
        return Err(bad());
    }
    Ok(stem.to_string())
}

pub fn split_hgt(hgt: &[u8]) -> Result<Vec<Vec<i16>>, RepackError> {
    let (source_size, stride) = match hgt.len() {
        HGT_BYTES => (HGT_SIZE, 1),
        HGT1_BYTES => (HGT1_SIZE, 3),
        size => return Err(RepackError::BadSize(size)),
    };
    let node = |row: usize, col: usize| {
        let at = (row * stride * source_size + col * stride) * 2;
        i16::from_be_bytes([hgt[at], hgt[at + 1]])
    };
    let step = TILE_SIZE - 1;
    let chunks = (0..CHUNKS)
        .map(|chunk| {
            let (dy, dx) = (chunk / SPLIT, chunk % SPLIT);
            let mut values = Vec::with_capacity(TILE_SIZE * TILE_SIZE);
            for row in 0..TILE_SIZE {
                let hgt_row = HGT_SIZE - 1 - dy * step - row;
                for col in 0..TILE_SIZE {
                    values.push(node(hgt_row, dx * step + col));
                }
            }
            values
        })
        .collect();
    Ok(chunks)
}

// `only` is the chunk numbers that go into the object; the other chunks get zero length.
// It is necessary for the thinned fixtures of the contract test.
pub fn repack_hgt(hgt: &[u8], only: Option<&[usize]>, level: i32) -> Result<Vec<u8>, RepackError> {
    let chunks: Vec<Option<Vec<i16>>> = split_hgt(hgt)?
        .into_iter()
        .enumerate()
        .map(|(index, values)| match only {
            Some(only) if !only.contains(&index) => None,
            _ => Some(values),
        })
        .collect();
    Ok(encode_degree(&chunks, level))
}
