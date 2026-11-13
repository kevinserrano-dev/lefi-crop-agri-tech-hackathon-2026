use url::Url;

use crate::error::{AppError, AppResult};

/// Development mock Brain (`packages/mock-brain`), debug builds only.
const DEBUG_DEFAULT: &str = "http://127.0.0.1:8787";

/// Where this PC's Brain address and trust come from. There is no built-in address: a PC
/// that was never paired and has nothing configured knows no Brain (the UI says so).
#[derive(Debug, Clone)]
pub struct BrainConfig {
    pub base_url: Option<Url>,
    /// PEM of the only CA trusted for HTTPS to the Brain's gateway (pinned). Never the system store.
    pub ca_pem: Option<Vec<u8>>,
    /// This device's private key + certificate (PEM) for mTLS, after pairing (ADR-048).
    pub identity_pem: Option<Vec<u8>>,
    /// `config`: set for this PC (environment, Advanced). `paired`: from pairing. `none`: nothing.
    pub source: &'static str,
}

impl BrainConfig {
    pub fn none() -> Self {
        Self {
            base_url: None,
            ca_pem: None,
            identity_pem: None,
            source: "none",
        }
    }

    /// `LEFI_BRAIN_URL` (+ `LEFI_BRAIN_CA`, a PEM file to pin) set an address by hand.
    pub fn from_env() -> AppResult<Self> {
        let ca = match std::env::var_os("LEFI_BRAIN_CA") {
            Some(path) => Some(
                std::fs::read(&path)
                    .map_err(|e| AppError::Config(format!("LEFI_BRAIN_CA: {e}")))?,
            ),
            None => None,
        };
        Self::resolve(
            std::env::var("LEFI_BRAIN_URL").ok(),
            ca,
            cfg!(debug_assertions),
        )
    }

    fn resolve(env: Option<String>, ca_pem: Option<Vec<u8>>, debug: bool) -> AppResult<Self> {
        match env {
            Some(raw) => Ok(Self {
                ca_pem,
                ..Self::parse(&raw, debug)?
            }),
            None if debug => Self::parse(DEBUG_DEFAULT, debug),
            None => Ok(Self::none()),
        }
    }

    /// Plain HTTP is accepted only for loopback in debug builds (the mock Brain).
    pub fn parse(raw: &str, debug: bool) -> AppResult<Self> {
        Ok(Self {
            base_url: Some(parse_origin(raw, debug)?),
            ca_pem: None,
            identity_pem: None,
            source: "config",
        })
    }

    /// What a paired PC uses: the paired address, the pinned gateway CA and its own identity.
    pub fn from_pairing(p: &crate::pairing::Pairing, key_pem: &str) -> AppResult<Self> {
        Ok(Self {
            base_url: Some(parse_origin(&p.url, false)?),
            ca_pem: Some(p.gateway_ca_pem.clone().into_bytes()),
            identity_pem: Some(format!("{key_pem}\n{}", p.cert_pem).into_bytes()),
            source: "paired",
        })
    }

    pub fn is_plain_http(&self) -> bool {
        self.base_url.as_ref().is_some_and(|u| u.scheme() == "http")
    }
}

/// An origin (`https://host:port`) the app may talk to.
pub fn parse_origin(raw: &str, debug: bool) -> AppResult<Url> {
    let base_url = Url::parse(raw).map_err(|e| AppError::Config(format!("Brain address: {e}")))?;
    match base_url.scheme() {
        "https" => {}
        "http" if debug && is_loopback(&base_url) => {}
        "http" => {
            return Err(AppError::Config(
                "plain HTTP is only allowed to loopback in debug builds".into(),
            ))
        }
        other => return Err(AppError::Config(format!("unsupported scheme {other}"))),
    }
    if base_url.path() != "/"
        || base_url.query().is_some()
        || !base_url.username().is_empty()
        || base_url.password().is_some()
    {
        return Err(AppError::Config(
            "the Brain address must be an origin, without path, query or user".into(),
        ));
    }
    Ok(base_url)
}

fn is_loopback(url: &Url) -> bool {
    match url.host() {
        Some(url::Host::Ipv4(ip)) => ip.is_loopback(),
        Some(url::Host::Ipv6(ip)) => ip.is_loopback(),
        Some(url::Host::Domain(d)) => d == "localhost",
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn https_is_accepted() {
        assert!(BrainConfig::parse("https://lefi-main.local:8443", false).is_ok());
    }

    #[test]
    fn http_only_to_loopback_in_debug() {
        assert!(BrainConfig::parse("http://127.0.0.1:8787", true).is_ok());
        assert!(BrainConfig::parse("http://127.0.0.1:8787", false).is_err());
        assert!(BrainConfig::parse("http://192.168.8.10:8000", true).is_err());
    }

    #[test]
    fn a_release_build_knows_no_brain_by_itself() {
        let release = BrainConfig::resolve(None, None, false).unwrap();
        assert!(release.base_url.is_none());
        assert_eq!(release.source, "none");
        assert_eq!(
            BrainConfig::resolve(None, None, true).unwrap().source,
            "config"
        );
        let set = BrainConfig::resolve(Some("https://192.0.2.1:8443".into()), None, false).unwrap();
        assert_eq!(set.source, "config");
    }

    #[test]
    fn rejects_paths_and_users() {
        assert!(BrainConfig::parse("https://lefi-main.local:8443/api", false).is_err());
        assert!(BrainConfig::parse("https://u:p@lefi-main.local:8443", false).is_err());
    }
}
