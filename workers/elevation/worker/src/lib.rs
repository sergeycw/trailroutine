//! Main adapter: a Cloudflare Worker (`workers-rs`) over the R2 bucket `DEM` (`nakarte-elevation`).
//!
//! The Cache API has no use here: it does not work on `*.workers.dev`, and the Worker has only
//! the address `*.nakarte-routing.workers.dev`, without an own domain. Thus the headers and the
//! compressed chunks are cached in the isolate memory
//! (`ByteCache`), the isolate lives between requests and gives frequently used areas without
//! requests to R2.

use std::cell::RefCell;
use std::collections::HashMap;

use elevation_core::request::MAX_BODY_BYTES;
use elevation_core::{Error as CoreError, Source, http};
use worker::{Bucket, Context, Env, RateLimiter, Request, Response, Result, console_error, event};

// The isolate limit is 128 MB with wasm; 32 MB is hundreds of compressed chunks (≈ 40–100 KB each).
const CACHE_BYTES: usize = 32 * 1024 * 1024;

#[derive(Default)]
struct ByteCache {
    entries: HashMap<String, (Vec<u8>, u64)>,
    total: usize,
    clock: u64,
}

impl ByteCache {
    fn get(&mut self, key: &str) -> Option<Vec<u8>> {
        self.clock += 1;
        let clock = self.clock;
        let (bytes, used) = self.entries.get_mut(key)?;
        *used = clock;
        Some(bytes.clone())
    }

    fn put(&mut self, key: String, bytes: Vec<u8>) {
        self.clock += 1;
        self.total += bytes.len();
        if let Some((old, _)) = self.entries.insert(key, (bytes, self.clock)) {
            self.total -= old.len();
        }
        while self.total > CACHE_BYTES {
            let Some(oldest) = self
                .entries
                .iter()
                .min_by_key(|(_, (_, used))| *used)
                .map(|(key, _)| key.clone())
            else {
                break;
            };
            if let Some((bytes, _)) = self.entries.remove(&oldest) {
                self.total -= bytes.len();
            }
        }
    }
}

thread_local! {
    static CACHE: RefCell<ByteCache> = RefCell::new(ByteCache::default());
}

struct R2Source {
    bucket: Bucket,
}

impl Source for R2Source {
    async fn read(
        &self,
        key: &str,
        offset: u64,
        length: u64,
    ) -> std::result::Result<Option<Vec<u8>>, CoreError> {
        let cache_key = format!("{key}@{offset}+{length}");
        if let Some(bytes) = CACHE.with_borrow_mut(|cache| cache.get(&cache_key)) {
            return Ok(Some(bytes));
        }
        let source_error = |error: worker::Error| CoreError::Source(format!("{key}: {error}"));
        let object = self
            .bucket
            .get(key)
            .range(worker::Range::OffsetWithLength { offset, length })
            .execute()
            .await
            .map_err(source_error)?;
        let Some(object) = object else {
            return Ok(None);
        };
        let body = object
            .body()
            .ok_or_else(|| CoreError::Source(format!("{key}: no body")))?;
        let bytes = body.bytes().await.map_err(source_error)?;
        CACHE.with_borrow_mut(|cache| cache.put(cache_key, bytes.clone()));
        Ok(Some(bytes))
    }
}

// The API request rate from one IP: the `API_RATE_LIMITER` binding from wrangler.toml.
// Without CF-Connecting-IP (local wrangler dev, tests) there is no limit.
async fn over_limit(
    request: &Request,
    env: &Env,
    core_request: &http::Request<'_>,
    allowed_origins: &[&str],
) -> Result<bool> {
    let Some(ip) = request.headers().get("CF-Connecting-IP")? else {
        return Ok(false);
    };
    if !http::counts_toward_limit(core_request, allowed_origins) {
        return Ok(false);
    }
    Ok(!env
        .rate_limiter("API_RATE_LIMITER")?
        .limit(ip)
        .await?
        .success)
}

// The R2 read budget from one IP: a unit is one `limit()` call of the `API_READS_RATE_LIMITER`
// binding (`http::READS_PER_UNIT` reads). Without CF-Connecting-IP (local wrangler dev, tests)
// there is no limit; a binding failure also gives no limit: the cost is the budget, not a refusal
// of the API.
struct ReadsBudget {
    limiter: Option<(RateLimiter, String)>,
}

impl http::ReadBudget for ReadsBudget {
    async fn spend(&self, units: usize) -> bool {
        let Some((limiter, ip)) = &self.limiter else {
            return true;
        };
        for _ in 0..units {
            match limiter.limit(ip.clone()).await {
                Ok(outcome) if !outcome.success => return false,
                Ok(_) => {}
                Err(error) => {
                    console_error!("reads budget unavailable: {error}");
                    return true;
                }
            }
        }
        true
    }
}

#[event(fetch)]
async fn fetch(mut request: Request, env: Env, _ctx: Context) -> Result<Response> {
    let header = |request: &Request, name: &str| request.headers().get(name).ok().flatten();
    let origin = header(&request, "Origin");
    let request_headers = header(&request, "Access-Control-Request-Headers");
    let content_length: Option<u64> =
        header(&request, "Content-Length").and_then(|value| value.parse().ok());
    let method = request.method().to_string();
    let path = request.path();
    // Do not read a body that is too large for sure: the core answers `413` by `Content-Length`.
    let body = match (method.as_str(), content_length) {
        ("POST", Some(length)) if length > MAX_BODY_BYTES as u64 => Vec::new(),
        ("POST", _) => request.bytes().await?,
        _ => Vec::new(),
    };
    let allowed_origins = env
        .var("ALLOWED_ORIGINS")
        .map(|value| value.to_string())
        .unwrap_or_default();
    let core_request = http::Request {
        method: &method,
        path: &path,
        origin: origin.as_deref(),
        content_length,
        request_headers: request_headers.as_deref(),
        body: &body,
    };
    let allowed_origins = http::parse_origins(&allowed_origins);
    let response = if over_limit(&request, &env, &core_request, &allowed_origins).await? {
        // over_limit counts only requests with an allowed Origin: thus Origin is always here
        http::too_many_requests(core_request.origin.unwrap_or_default())
    } else {
        let source = R2Source {
            bucket: env.bucket("DEM")?,
        };
        let ip = header(&request, "CF-Connecting-IP");
        let budget = ReadsBudget {
            limiter: ip.and_then(|ip| {
                env.rate_limiter("API_READS_RATE_LIMITER")
                    .ok()
                    .map(|limiter| (limiter, ip))
            }),
        };
        http::handle(&core_request, &allowed_origins, &source, &budget).await
    };
    if let Some(error) = &response.error {
        console_error!("elevation error: {error}");
    }
    // An empty body gives a response with no body: `new Response("", {status: 204})` throws in JS.
    let mut result = if response.body.is_empty() {
        Response::empty()?
    } else {
        Response::from_bytes(response.body)?
    }
    .with_status(response.status);
    for (name, value) in &response.headers {
        result.headers_mut().set(name, value)?;
    }
    Ok(result)
}
