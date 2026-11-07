use crate::request::{self, MAX_BODY_BYTES, MAX_READS, ParseError};
use crate::{Source, elevations, read_count, response};

const ALLOWED_METHODS: &str = "POST, OPTIONS";
const TEXT: &str = "text/plain; charset=utf-8";
// The window length of `[[ratelimits]]` in wrangler.toml.
const RETRY_AFTER_SECONDS: &str = "60";
/// The unit of the read budget: the rate limiting binding counts `limit()` calls without weight,
/// thus a request uses `ceil(reads / 64)` calls; the budget in units is `API_READS_RATE_LIMITER` in
/// wrangler.toml.
pub const READS_PER_UNIT: usize = 64;

/// The storage read budget per client. `spend` gets the number of units (`READS_PER_UNIT`) and
/// tells if the request is within the budget; `false` gives `429`. The `worker` adapter uses the
/// `[[ratelimits]]` binding by IP, `server` and the tests use `Unlimited`.
#[allow(async_fn_in_trait)]
pub trait ReadBudget {
    async fn spend(&self, units: usize) -> bool;
}

pub struct Unlimited;

impl ReadBudget for Unlimited {
    async fn spend(&self, _units: usize) -> bool {
        true
    }
}

pub struct Request<'a> {
    pub method: &'a str,
    pub path: &'a str,
    pub origin: Option<&'a str>,
    pub content_length: Option<u64>,
    pub request_headers: Option<&'a str>,
    pub body: &'a [u8],
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Response {
    pub status: u16,
    pub headers: Vec<(&'static str, String)>,
    pub body: Vec<u8>,
    pub error: Option<String>,
}

impl Response {
    fn new(status: u16, body: impl Into<Vec<u8>>) -> Response {
        Response {
            status,
            headers: Vec::new(),
            body: body.into(),
            error: None,
        }
    }

    fn text(mut self) -> Response {
        self.headers.push(("Content-Type", TEXT.to_string()));
        self
    }

    fn with_cors(mut self, origin: &str) -> Response {
        self.headers
            .push(("Access-Control-Allow-Origin", origin.to_string()));
        self.headers
            .push(("Access-Control-Allow-Credentials", "true".to_string()));
        self.headers.push(("Vary", "Origin".to_string()));
        self
    }

    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }
}

pub fn parse_origins(list: &str) -> Vec<&str> {
    list.split(',')
        .map(str::trim)
        .filter(|origin| !origin.is_empty())
        .collect()
}

/// Tells if the request uses the rate counter for one IP (`API_RATE_LIMITER` in wrangler.toml). A
/// request with an `Origin` that is not allowed, or without `Origin`, gets `403` anyway and does
/// not use the counter. The elevation tiles with their own counter do not exist any more (change
/// retire-old-client-services).
pub fn counts_toward_limit(request: &Request<'_>, allowed_origins: &[&str]) -> bool {
    request
        .origin
        .is_some_and(|origin| allowed_origins.contains(&origin))
}

/// The answer above the limit has the same CORS headers as a usual API answer, so the client sees
/// `429` and not a CORS failure. Only requests with an allowed `Origin` use the counter
/// (`counts_toward_limit`).
pub fn too_many_requests(origin: &str) -> Response {
    rate_limited().with_cors(origin)
}

// `429` without CORS: the handler of the path adds the headers.
fn rate_limited() -> Response {
    let mut response = Response::new(429, "Too many requests\n").text();
    response
        .headers
        .push(("Retry-After", RETRY_AFTER_SECONDS.to_string()));
    response
}

// HTTP without a link to the runtime: the adapter makes the `Request` and converts the `Response`
// back. The elevation API: CORS as in `workers/tracks`, only an origin from `ALLOWED_ORIGINS`,
// otherwise (and without `Origin`) 403; the error codes and texts are as in the Go server of the
// author (`http.Error` adds `\n`). The old tile route `/tiles/` has no separate branch: such a
// request is a usual API request.
pub async fn handle<S: Source, B: ReadBudget>(
    request: &Request<'_>,
    allowed_origins: &[&str],
    source: &S,
    budget: &B,
) -> Response {
    let Some(origin) = request
        .origin
        .filter(|origin| allowed_origins.contains(origin))
    else {
        return Response::new(403, "Origin not allowed\n").text();
    };
    respond(request, source, budget).await.with_cors(origin)
}

async fn respond<S: Source, B: ReadBudget>(
    request: &Request<'_>,
    source: &S,
    budget: &B,
) -> Response {
    if request.method == "OPTIONS" {
        let mut response = Response::new(204, "");
        response
            .headers
            .push(("Access-Control-Allow-Methods", ALLOWED_METHODS.to_string()));
        if let Some(headers) = request.request_headers {
            response
                .headers
                .push(("Access-Control-Allow-Headers", headers.to_string()));
        }
        return response;
    }
    if request.method != "POST" {
        let mut response = Response::new(405, "Method not allowed\n").text();
        response
            .headers
            .push(("Allow", ALLOWED_METHODS.to_string()));
        return response;
    }
    if request.path != "/" {
        return Response::new(404, "404 page not found\n").text();
    }
    if request
        .content_length
        .is_some_and(|length| length > MAX_BODY_BYTES as u64)
    {
        return Response::new(413, "Request too big\n").text();
    }
    let points = match request::parse_points(request.body) {
        Ok(points) => points,
        Err(ParseError::TooBig) => return Response::new(413, "Request too big\n").text(),
        Err(ParseError::Invalid) => return Response::new(400, "Invalid request\n").text(),
    };
    // The cost of a request is R2 reads: first the limit per request, then the client budget, and
    // only then the read.
    let reads = read_count(&points);
    if reads > MAX_READS {
        return Response::new(413, "Request too big\n").text();
    }
    if reads > 0 && !budget.spend(reads.div_ceil(READS_PER_UNIT)).await {
        return rate_limited();
    }
    match elevations(source, &points).await {
        Ok(values) => Response::new(200, response::format_elevations(&values)).text(),
        Err(error) => Response {
            error: Some(error.to_string()),
            ..Response::new(500, "Server error\n").text()
        },
    }
}
