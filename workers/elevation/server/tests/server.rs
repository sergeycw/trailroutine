// Starts a real server on a free port over `fixtures/` and sends raw HTTP/1.1,
// without an HTTP client in the dependencies.

use std::path::Path;

use elevation_server::{AppState, FileSource, app};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const ORIGIN: &str = "http://localhost:8766";

async fn start() -> u16 {
    let state = AppState {
        source: FileSource {
            root: Path::new(env!("CARGO_MANIFEST_DIR")).join("../fixtures"),
        },
        allowed_origins: format!("https://nakarte-routing.pages.dev, {ORIGIN}"),
    };
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move { axum::serve(listener, app(state)).await.unwrap() });
    port
}

async fn send(port: u16, method: &str, origin: Option<&str>, body: &str) -> String {
    let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", port))
        .await
        .unwrap();
    let origin = origin
        .map(|origin| format!("Origin: {origin}\r\n"))
        .unwrap_or_default();
    let request = format!(
        "{method} / HTTP/1.1\r\nHost: localhost\r\n{origin}Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    stream.write_all(request.as_bytes()).await.unwrap();
    let mut response = String::new();
    stream.read_to_string(&mut response).await.unwrap();
    response
}

fn body(response: &str) -> &str {
    response.split_once("\r\n\r\n").unwrap().1
}

#[tokio::test]
async fn answers_reference_points() {
    let port = start().await;
    let response = send(
        port,
        "POST",
        Some(ORIGIN),
        "43.250000 42.250000\n43.000000 35.000000\n",
    )
    .await;
    assert!(response.starts_with("HTTP/1.1 200"), "{response}");
    assert!(
        response.contains(&format!("access-control-allow-origin: {ORIGIN}")),
        "{response}"
    );
    assert!(
        response.contains("access-control-allow-credentials: true"),
        "{response}"
    );
    assert_eq!(body(&response), "3157.00\nNULL");
}

#[tokio::test]
async fn rejects_foreign_origin_and_wrong_method() {
    let port = start().await;
    assert!(
        send(port, "POST", Some("https://example.com"), "1 2")
            .await
            .starts_with("HTTP/1.1 403")
    );
    assert!(
        send(port, "POST", None, "1 2")
            .await
            .starts_with("HTTP/1.1 403")
    );
    assert!(
        send(port, "GET", Some(ORIGIN), "")
            .await
            .starts_with("HTTP/1.1 405")
    );
    let invalid = send(port, "POST", Some(ORIGIN), "abc def").await;
    assert!(invalid.starts_with("HTTP/1.1 400"), "{invalid}");
    assert_eq!(body(&invalid), "Invalid request\n");
}

// The elevation tiles do not exist any more (change retire-old-client-services): `/tiles/…` without
// `Origin` gives `403`, as each API request without an allowed origin.
#[tokio::test]
async fn former_tiles_route_needs_origin() {
    let port = start().await;
    let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", port))
        .await
        .unwrap();
    stream
        .write_all(
            b"GET /tiles/11/1277/754 HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
        )
        .await
        .unwrap();
    let mut response = Vec::new();
    stream.read_to_end(&mut response).await.unwrap();
    let head = String::from_utf8_lossy(&response).to_ascii_lowercase();
    assert!(head.starts_with("http/1.1 403"), "{head}");
    assert!(!head.contains("access-control-allow-origin"), "{head}");
}
