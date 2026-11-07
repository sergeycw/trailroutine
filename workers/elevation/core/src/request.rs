// The parser repeats the Go server of the author: lines split by `\n`, one trailing `\n` is
// allowed, latitude and longitude split by the first space, numbers as in `strconv.ParseFloat`
// (`1e1`, `nan` pass). An empty line in the middle, an extra space, `\r` give `400`. The limits of
// the author: 250 000 bytes and 10 000 points, otherwise `413`. A difference from Go: Rust does not
// parse hexadecimal numbers and `_` in numbers, the client does not send them.
pub const MAX_BODY_BYTES: usize = 250_000;
pub const MAX_POINTS: usize = 10_000;
// Our own limit, the author does not have it: points that touch more storage reads (degrees +
// chunks, `read_count`) get the same `413`. Points along a track of 5 000 km touch ≈ 450 chunks,
// 10 000 scattered points touch up to 20 000 R2 class B reads (security audit, item 2; change
// limit-elevation-reads).
pub const MAX_READS: usize = 512;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ParseError {
    Invalid,
    TooBig,
}

pub fn parse_points(body: &[u8]) -> Result<Vec<(f64, f64)>, ParseError> {
    if body.len() > MAX_BODY_BYTES {
        return Err(ParseError::TooBig);
    }
    let mut points = Vec::new();
    let mut lines = body.split(|&byte| byte == b'\n').peekable();
    while let Some(line) = lines.next() {
        if line.is_empty() && lines.peek().is_none() {
            break;
        }
        points.push(parse_line(line)?);
        if points.len() > MAX_POINTS {
            return Err(ParseError::TooBig);
        }
    }
    Ok(points)
}

fn parse_line(line: &[u8]) -> Result<(f64, f64), ParseError> {
    let space = line
        .iter()
        .position(|&byte| byte == b' ')
        .ok_or(ParseError::Invalid)?;
    let lat = parse_number(&line[..space])?;
    let lon = parse_number(&line[space + 1..])?;
    Ok((lat, lon))
}

fn parse_number(text: &[u8]) -> Result<f64, ParseError> {
    std::str::from_utf8(text)
        .ok()
        .and_then(|text| text.parse::<f64>().ok())
        .ok_or(ParseError::Invalid)
}
