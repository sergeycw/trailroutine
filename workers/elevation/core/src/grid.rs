use crate::format::{NO_VALUE, SPLIT, TILE_SIZE};

// The position of a point in a chunk. The arithmetic repeats `GetInterpolated` and
// `TileIndexFromLatLon` of the Go server of the author exactly (the same steps in f64), so the
// answers match to hundredths.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Cell {
    pub lat0: i32,
    pub lon0: i32,
    pub chunk: usize,
    pub ix: usize,
    pub iy: usize,
    pub dx: f64,
    pub dy: f64,
}

pub fn locate(lat: f64, lon: f64) -> Option<Cell> {
    // For the author, `nan` and points beyond ±90/±180 are not an error but `NULL`: the tile index
    // is outside the grid. In Rust `NaN as i64` gives 0, thus the check is explicit.
    if !lat.is_finite() || !lon.is_finite() {
        return None;
    }
    let parts = SPLIT as f64;
    let steps = (TILE_SIZE - 1) as f64;
    let tile_x = (lon * parts).floor();
    let tile_y = (lat * parts).floor();
    if !(-180.0 * parts..180.0 * parts).contains(&tile_x)
        || !(-90.0 * parts..90.0 * parts).contains(&tile_y)
    {
        return None;
    }
    let x = (lon * parts - tile_x) * steps;
    let y = (lat * parts - tile_y) * steps;
    // `min` guards against x == 300.0 after f64 rounding: the author reads past the row end there.
    let ix = (x.floor() as usize).min(TILE_SIZE - 2);
    let iy = (y.floor() as usize).min(TILE_SIZE - 2);
    let tile_x = tile_x as i32;
    let tile_y = tile_y as i32;
    let split = SPLIT as i32;
    Some(Cell {
        lat0: tile_y.div_euclid(split),
        lon0: tile_x.div_euclid(split),
        chunk: (tile_y.rem_euclid(split) * split + tile_x.rem_euclid(split)) as usize,
        ix,
        iy,
        dx: x - ix as f64,
        dy: y - iy as f64,
    })
}

pub fn object_key(lat0: i32, lon0: i32) -> String {
    let ns = if lat0 < 0 { 'S' } else { 'N' };
    let ew = if lon0 < 0 { 'W' } else { 'E' };
    format!(
        "dem3/{ns}{:02}{ew}{:03}",
        lat0.unsigned_abs(),
        lon0.unsigned_abs()
    )
}

pub fn interpolate(values: &[i16], cell: &Cell) -> Option<f64> {
    let at = |ix: usize, iy: usize| values[iy * TILE_SIZE + ix];
    let v1 = at(cell.ix, cell.iy);
    let v2 = at(cell.ix + 1, cell.iy);
    let v3 = at(cell.ix, cell.iy + 1);
    let v4 = at(cell.ix + 1, cell.iy + 1);
    if [v1, v2, v3, v4].contains(&NO_VALUE) {
        return None;
    }
    let (dx, dy) = (cell.dx, cell.dy);
    Some(
        f64::from(v1) * (1.0 - dx) * (1.0 - dy)
            + f64::from(v2) * dx * (1.0 - dy)
            + f64::from(v3) * (1.0 - dx) * dy
            + f64::from(v4) * dx * dy,
    )
}
