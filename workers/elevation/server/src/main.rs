//! `elevation-server --data DIR [--port 8789]`; the allowed origins come from `ALLOWED_ORIGINS`
//! (comma-separated, as in `wrangler.toml`).

use std::path::PathBuf;

use elevation_server::{AppState, FileSource, app};

#[tokio::main]
async fn main() {
    let mut data = None;
    let mut port = 8789u16;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--data" => data = args.next().map(PathBuf::from),
            "--port" => {
                port = args
                    .next()
                    .and_then(|value| value.parse().ok())
                    .expect("bad --port")
            }
            _ => panic!("unknown argument {arg}"),
        }
    }
    let state = AppState {
        source: FileSource {
            root: data.expect("missing --data"),
        },
        allowed_origins: std::env::var("ALLOWED_ORIGINS").unwrap_or_default(),
    };
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port))
        .await
        .expect("bind");
    println!("listening on http://127.0.0.1:{port}");
    axum::serve(listener, app(state)).await.expect("serve");
}
