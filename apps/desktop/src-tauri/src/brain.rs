//! Brain HTTP client. Every request from the WebView goes through `api_request`, so the
//! session cookie and (after pairing) the device certificate never reach JavaScript.

use std::time::Duration;

use reqwest::{Client, Method};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::config::BrainConfig;
use crate::error::{AppError, AppResult};

#[derive(Debug, Deserialize)]
pub struct ApiCall {
    pub method: String,
    /// `/api/v1/...` path built by `@lefi/platform` (`buildApiPath`).
    pub path: String,
    #[serde(default)]
    pub body: Option<Value>,
}

#[derive(Debug, Serialize)]
pub struct ApiAnswer {
    pub status: u16,
    pub body: Value,
}

/// The client in use; replaced as a whole when this PC is paired or forgets its pairing.
pub struct BrainState {
    current: std::sync::RwLock<std::sync::Arc<BrainClient>>,
}

impl BrainState {
    pub fn new(client: BrainClient) -> Self {
        Self {
            current: std::sync::RwLock::new(std::sync::Arc::new(client)),
        }
    }

    pub fn get(&self) -> std::sync::Arc<BrainClient> {
        self.current
            .read()
            .map(|c| c.clone())
            .unwrap_or_else(|p| p.into_inner().clone())
    }

    pub fn replace(&self, client: BrainClient) {
        let mut slot = self.current.write().unwrap_or_else(|p| p.into_inner());
        *slot = std::sync::Arc::new(client);
    }
}

pub struct BrainClient {
    config: BrainConfig,
    /// `None` when no Brain is known, or for HTTPS without a pinned CA (not paired yet).
    http: Option<Client>,
}

impl BrainClient {
    pub fn new(config: BrainConfig) -> AppResult<Self> {
        let http = match (&config.base_url, &config.ca_pem) {
            (None, _) => None,
            // Debug-only loopback mock (enforced by BrainConfig::parse).
            (Some(_), _) if config.is_plain_http() => Some(build(base_builder())?),
            // HTTPS trusts only the pinned CA: never the system store, never invalid certificates.
            (Some(_), Some(pem)) => {
                let mut builder = pinned_builder(pem)?;
                if let Some(id) = &config.identity_pem {
                    let identity = reqwest::Identity::from_pem(id)
                        .map_err(|e| AppError::Config(format!("device identity: {e}")))?;
                    builder = builder.identity(identity);
                }
                Some(build(builder)?)
            }
            (Some(_), None) => None,
        };
        Ok(Self { config, http })
    }

    pub fn config(&self) -> &BrainConfig {
        &self.config
    }

    pub async fn call(&self, call: ApiCall) -> AppResult<ApiAnswer> {
        let method = parse_method(&call.method)?;
        validate_path(&call.path)?;
        let base = self.config.base_url.as_ref().ok_or(AppError::NoBrain)?;
        let url = base
            .join(&call.path)
            .map_err(|e| AppError::InvalidRequest(e.to_string()))?;
        if url.origin() != base.origin() {
            return Err(AppError::InvalidRequest(
                "path escapes the Brain origin".into(),
            ));
        }
        let http = self.http.as_ref().ok_or(AppError::NotPaired)?;

        let mut req = http.request(method, url);
        if let Some(body) = call.body.filter(|b| !b.is_null()) {
            req = req.json(&body);
        }
        let res = req
            .send()
            .await
            .map_err(|e| AppError::Unreachable(e.without_url().to_string()))?;
        let status = res.status().as_u16();
        let bytes = res
            .bytes()
            .await
            .map_err(|e| AppError::Unreachable(e.without_url().to_string()))?;
        let body = if bytes.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&bytes).unwrap_or(Value::Null)
        };
        Ok(ApiAnswer { status, body })
    }
}

impl BrainClient {
    /// A long-lived GET (a camera's live stream, ADR-079): same Brain, same pinned TLS and
    /// device certificate, same path rules; no 20 s limit, the caller stops reading instead.
    pub async fn open_stream(&self, path: &str) -> AppResult<reqwest::Response> {
        validate_path(path)?;
        let base = self.config.base_url.as_ref().ok_or(AppError::NoBrain)?;
        let url = base
            .join(path)
            .map_err(|e| AppError::InvalidRequest(e.to_string()))?;
        if url.origin() != base.origin() {
            return Err(AppError::InvalidRequest(
                "path escapes the Brain origin".into(),
            ));
        }
        let http = self.http.as_ref().ok_or(AppError::NotPaired)?;
        http.get(url)
            .timeout(Duration::from_secs(6 * 60 * 60))
            .send()
            .await
            .map_err(|e| AppError::Unreachable(e.without_url().to_string()))
    }
}

fn build(builder: reqwest::ClientBuilder) -> AppResult<Client> {
    builder.build().map_err(|e| AppError::Config(e.to_string()))
}

/// HTTPS client that trusts exactly one CA (the gateway's, pinned at pairing time).
pub fn pinned_builder(ca_pem: &[u8]) -> AppResult<reqwest::ClientBuilder> {
    let certs = reqwest::Certificate::from_pem_bundle(ca_pem)
        .map_err(|e| AppError::Config(format!("pinned CA: {e}")))?;
    if certs.len() != 1 {
        return Err(AppError::Config(format!(
            "pinned CA: expected one certificate, found {}",
            certs.len()
        )));
    }
    Ok(base_builder().https_only(true).tls_certs_only(certs))
}

fn base_builder() -> reqwest::ClientBuilder {
    Client::builder()
        .no_proxy() // LAN only: never route Brain traffic through a proxy
        .cookie_store(true) // session cookie kept in Rust memory
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(20))
        .user_agent(concat!("lefi-desktop/", env!("CARGO_PKG_VERSION")))
}

fn parse_method(m: &str) -> AppResult<Method> {
    match m {
        "GET" => Ok(Method::GET),
        "POST" => Ok(Method::POST),
        "PUT" => Ok(Method::PUT),
        "PATCH" => Ok(Method::PATCH),
        "DELETE" => Ok(Method::DELETE),
        other => Err(AppError::InvalidRequest(format!(
            "method {other} not allowed"
        ))),
    }
}

/// Only relative `/api/v1/...` paths: no scheme, authority, traversal or fragments.
pub fn validate_path(path: &str) -> AppResult<()> {
    let ok = path.starts_with("/api/v1/")
        && !path.contains("//")
        && !path.contains("://")
        && !path.contains("..")
        && !path.contains('#')
        && !path.contains('\\')
        && !path.chars().any(|c| c.is_control() || c.is_whitespace());
    if ok {
        Ok(())
    } else {
        Err(AppError::InvalidRequest(format!(
            "path not allowed: {path}"
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_api_paths() {
        assert!(validate_path("/api/v1/plants").is_ok());
        assert!(validate_path("/api/v1/alerts?status=open").is_ok());
    }

    #[test]
    fn rejects_escapes() {
        for p in [
            "/plants",
            "//evil.example/api/v1/x",
            "/api/v1//evil.example",
            "/api/v1/../admin",
            "/api/v1/x?u=https://evil.example",
            "/api/v1/x#frag",
            "/api/v1/a b",
            "/api/v1/a\\b",
        ] {
            assert!(validate_path(p).is_err(), "{p} should be rejected");
        }
    }

    #[test]
    fn rejects_unknown_methods() {
        assert!(parse_method("TRACE").is_err());
    }

    #[tokio::test]
    async fn https_without_pairing_refuses_to_send() {
        let cfg = BrainConfig::parse("https://lefi-main.local:8443", false).unwrap();
        let client = BrainClient::new(cfg).unwrap();
        let err = client
            .call(ApiCall {
                method: "GET".into(),
                path: "/api/v1/plants".into(),
                body: None,
            })
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::NotPaired));
    }

    #[tokio::test]
    async fn no_brain_known_refuses_to_send() {
        let client = BrainClient::new(BrainConfig::none()).unwrap();
        let err = client
            .call(ApiCall {
                method: "GET".into(),
                path: "/api/v1/health".into(),
                body: None,
            })
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::NoBrain));
    }

    #[test]
    fn a_bad_pinned_ca_is_refused() {
        assert!(pinned_builder(b"not a certificate").is_err());
    }
}
