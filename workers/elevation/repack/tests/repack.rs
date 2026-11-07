use elevation_core::format::{CHUNKS, HEADER_LEN, Header, NO_VALUE, TILE_SIZE, decode_chunk};
use elevation_repack::{HGT_SIZE, HGT1_SIZE, RepackError, degree_name, repack_hgt};

// The node value by the HGT row and column (rows from the north), unique in the degree.
fn hgt_value(row: usize, col: usize) -> i16 {
    if (row, col) == (7, 9) {
        return NO_VALUE;
    }
    ((row * 7 + col * 3) % 9000) as i16 - 400
}

fn synthetic_hgt() -> Vec<u8> {
    let mut hgt = Vec::with_capacity(HGT_SIZE * HGT_SIZE * 2);
    for row in 0..HGT_SIZE {
        for col in 0..HGT_SIZE {
            hgt.extend_from_slice(&hgt_value(row, col).to_be_bytes());
        }
    }
    hgt
}

fn chunk(object: &[u8], header: &Header, index: usize) -> Vec<i16> {
    let (offset, length) = header.chunk_range(index).unwrap();
    decode_chunk(&object[offset as usize..(offset + length) as usize]).unwrap()
}

#[test]
fn every_node_survives_repack() {
    let object = repack_hgt(&synthetic_hgt(), None, 3).unwrap();
    let header = Header::parse(&object[..HEADER_LEN]).unwrap();
    for index in 0..CHUNKS {
        let (dy, dx) = (index / 4, index % 4);
        let values = chunk(&object, &header, index);
        for iy in 0..TILE_SIZE {
            for ix in 0..TILE_SIZE {
                let row = HGT_SIZE - 1 - (dy * 300 + iy);
                let col = dx * 300 + ix;
                assert_eq!(
                    values[iy * TILE_SIZE + ix],
                    hgt_value(row, col),
                    "chunk {index} {ix},{iy}"
                );
            }
        }
    }
}

#[test]
fn only_keeps_listed_chunks() {
    let object = repack_hgt(&synthetic_hgt(), Some(&[0, 15]), 3).unwrap();
    let header = Header::parse(&object[..HEADER_LEN]).unwrap();
    let present: Vec<usize> = (0..CHUNKS)
        .filter(|&index| header.chunk_range(index).is_some())
        .collect();
    assert_eq!(present, vec![0, 15]);
    assert_eq!(
        chunk(&object, &header, 15)[TILE_SIZE * TILE_SIZE - 1],
        hgt_value(0, HGT_SIZE - 1)
    );
}

#[test]
fn one_arcsecond_hgt_is_decimated_to_three_arcseconds() {
    let value = |row: usize, col: usize| ((row * 5 + col * 11) % 7000) as i16;
    let mut hgt = Vec::with_capacity(HGT1_SIZE * HGT1_SIZE * 2);
    for row in 0..HGT1_SIZE {
        for col in 0..HGT1_SIZE {
            hgt.extend_from_slice(&value(row, col).to_be_bytes());
        }
    }
    let object = repack_hgt(&hgt, None, 3).unwrap();
    let header = Header::parse(&object[..HEADER_LEN]).unwrap();
    for index in [0, 5, 15] {
        let (dy, dx) = (index / 4, index % 4);
        let values = chunk(&object, &header, index);
        for (iy, ix) in [(0, 0), (150, 77), (300, 300)] {
            let row3 = HGT_SIZE - 1 - (dy * 300 + iy);
            let col3 = dx * 300 + ix;
            assert_eq!(
                values[iy * TILE_SIZE + ix],
                value(row3 * 3, col3 * 3),
                "chunk {index} {ix},{iy}"
            );
        }
    }
}

#[test]
fn wrong_size_is_rejected() {
    assert_eq!(repack_hgt(&[0; 10], None, 3), Err(RepackError::BadSize(10)));
}

#[test]
fn degree_names() {
    assert_eq!(degree_name("K38/N43E042.hgt"), Ok("N43E042".to_string()));
    assert_eq!(degree_name("s33w071.HGT"), Ok("S33W071".to_string()));
    assert!(degree_name("N43E042.tif").is_err());
    assert!(degree_name("X43E042.hgt").is_err());
    assert!(degree_name("N4E042.hgt").is_err());
}
