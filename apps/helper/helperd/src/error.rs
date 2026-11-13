use serde::Serialize;

/// A stable machine code and a plain message, also returned as JSON by the HTTP endpoints.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Error {
    pub code: &'static str,
    pub message: String,
}

impl Error {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for Error {}

pub type Result<T> = std::result::Result<T, Error>;

pub fn io(code: &'static str) -> impl Fn(std::io::Error) -> Error {
    move |e| Error::new(code, e.to_string())
}
