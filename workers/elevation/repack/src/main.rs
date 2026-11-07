//! `elevation-repack --out DIR [--level N] [--only N43E042=5,6] FILE.hgt...`
//!
//! Writes `DIR/dem3/<degree>` and one line `<degree> <bytes>` per file to stdout. If the object
//! exists (one HGT occurs in several viewfinderpanoramas zips), the tool does not overwrite the
//! first one, and writes `duplicate <degree> same|different` to stdout: this is how the pipeline
//! sees repeats. `--only` can repeat; with it, the tool writes only the listed degrees and chunks.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::sync::Mutex;

use elevation_repack::{degree_name, repack_hgt};

struct Args {
    out: PathBuf,
    level: i32,
    only: Option<HashMap<String, Vec<usize>>>,
    files: Vec<PathBuf>,
}

fn parse_args() -> Result<Args, String> {
    let mut out = None;
    let mut level = 19;
    let mut only: Option<HashMap<String, Vec<usize>>> = None;
    let mut files = Vec::new();
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--out" => out = args.next().map(PathBuf::from),
            "--level" => {
                level = args
                    .next()
                    .and_then(|value| value.parse().ok())
                    .ok_or("bad --level")?;
            }
            "--only" => {
                let spec = args.next().ok_or("missing --only value")?;
                let (degree, chunks) = spec.split_once('=').ok_or("--only wants N43E042=5,6")?;
                let chunks = chunks
                    .split(',')
                    .map(|chunk| {
                        chunk
                            .parse::<usize>()
                            .map_err(|_| format!("bad chunk in {spec}"))
                    })
                    .collect::<Result<Vec<_>, _>>()?;
                only.get_or_insert_default()
                    .insert(degree.to_ascii_uppercase(), chunks);
            }
            _ => files.push(PathBuf::from(arg)),
        }
    }
    let out = out.ok_or("missing --out")?;
    Ok(Args {
        out,
        level,
        only,
        files,
    })
}

fn repack_file(path: &Path, args: &Args, write_lock: &Mutex<()>) -> Result<String, String> {
    let file_name = path.to_string_lossy();
    let degree = degree_name(&file_name).map_err(|error| error.to_string())?;
    let only = match &args.only {
        None => None,
        Some(only) => match only.get(&degree) {
            Some(chunks) => Some(chunks.as_slice()),
            None => return Ok(format!("skip {degree}")),
        },
    };
    let hgt = std::fs::read(path).map_err(|error| format!("{file_name}: {error}"))?;
    let object =
        repack_hgt(&hgt, only, args.level).map_err(|error| format!("{file_name}: {error}"))?;
    let target = args.out.join("dem3").join(&degree);
    let _guard = write_lock.lock().unwrap();
    if let Ok(existing) = std::fs::read(&target) {
        let verdict = if existing == object {
            "same"
        } else {
            "different"
        };
        return Ok(format!("duplicate {degree} {verdict}"));
    }
    std::fs::write(&target, &object).map_err(|error| format!("{}: {error}", target.display()))?;
    Ok(format!("{degree} {}", object.len()))
}

fn main() -> ExitCode {
    let args = match parse_args() {
        Ok(args) => args,
        Err(error) => {
            eprintln!("{error}");
            return ExitCode::from(2);
        }
    };
    if let Err(error) = std::fs::create_dir_all(args.out.join("dem3")) {
        eprintln!("{error}");
        return ExitCode::FAILURE;
    }
    // zstd -19 is slow (≈ one second per degree), thus the threads share the files.
    // The write mutex separates repeated names in one run (the compression runs outside it).
    let queue = Mutex::new(args.files.iter());
    let write_lock = Mutex::new(());
    let failed = Mutex::new(false);
    let threads = std::thread::available_parallelism().map_or(1, |n| n.get());
    std::thread::scope(|scope| {
        for _ in 0..threads {
            scope.spawn(|| {
                loop {
                    let Some(path) = queue.lock().unwrap().next() else {
                        break;
                    };
                    match repack_file(path, &args, &write_lock) {
                        Ok(line) => println!("{line}"),
                        Err(error) => {
                            eprintln!("{error}");
                            *failed.lock().unwrap() = true;
                        }
                    }
                }
            });
        }
    });
    if *failed.lock().unwrap() {
        return ExitCode::FAILURE;
    }
    ExitCode::SUCCESS
}
