// Contract test: the answers of the core on the thinned objects from `fixtures/dem3` against the
// answers of `elevation.nakarte.me` that `fixtures/make_reference.py` recorded. The network is not
// necessary. The data and the arithmetic are the same as the author has, thus the tolerance is an
// exact match of the answer lines (first run 2026-10-07: 306 of 306). A difference means that the
// viewfinderpanoramas data changed or the interpolation broke; see the section
// «Допуск контрактного теста» in `openspec/changes/archive/2026-10-07-add-elevation-api/design.md`.

mod common;

use common::{MemorySource, fixtures_dir};
use elevation_core::elevations;
use elevation_core::response::format_elevation;
use futures::executor::block_on;

struct Reference {
    lat: f64,
    lon: f64,
    expected: String,
}

fn references() -> Vec<Reference> {
    std::fs::read_to_string(fixtures_dir().join("reference.txt"))
        .unwrap()
        .lines()
        .map(|line| {
            let mut fields = line.split(' ');
            let lat = fields.next().unwrap().parse().unwrap();
            let lon = fields.next().unwrap().parse().unwrap();
            Reference {
                lat,
                lon,
                expected: fields.next().unwrap().to_string(),
            }
        })
        .collect()
}

#[test]
fn matches_author_service() {
    let references = references();
    assert!(references.len() >= 300);
    let source = MemorySource::from_dir(&fixtures_dir());
    let points: Vec<(f64, f64)> = references.iter().map(|r| (r.lat, r.lon)).collect();
    let values = block_on(elevations(&source, &points)).unwrap();

    let mut report = Vec::new();
    for (reference, value) in references.iter().zip(&values) {
        let actual = format_elevation(*value);
        if actual != reference.expected {
            report.push(format!(
                "{} {}: ours {actual}, author {}",
                reference.lat, reference.lon, reference.expected
            ));
        }
    }
    assert!(
        report.is_empty(),
        "{} of {} points differ:\n{}",
        report.len(),
        references.len(),
        report.join("\n")
    );
}
