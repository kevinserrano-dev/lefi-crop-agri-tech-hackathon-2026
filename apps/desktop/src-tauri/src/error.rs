use serde::Serialize;

/// Errors returned to the WebView. Serialised as a plain message: no internals, no secrets.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("invalid request: {0}")]
    InvalidRequest(String),
    #[error("no Lefi Brain is known on this PC yet")]
    NoBrain,
    #[error("this device is not paired with a Brain yet")]
    NotPaired,
    #[error("not available yet: {0}")]
    NotImplemented(&'static str),
    #[error("Brain unreachable: {0}")]
    Unreachable(String),
    #[error("{0}")]
    Pairing(String),
    #[error("configuration error: {0}")]
    Config(String),
    #[error("keychain error: {0}")]
    Keychain(String),
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
