//! OS keychain (macOS Keychain, Windows Credential Manager, Secret Service on Linux).

use crate::error::{AppError, AppResult};

fn entry(key: &str) -> AppResult<keyring::Entry> {
    let valid = !key.is_empty()
        && key.len() <= 64
        && key
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'));
    if !valid {
        return Err(AppError::InvalidRequest("invalid secret key".into()));
    }
    // The keychain service is the app's identifier: the development app never reads or writes
    // the installed app's secrets (ADR-078).
    keyring::Entry::new(crate::variant::identifier(), key)
        .map_err(|e| AppError::Keychain(e.to_string()))
}

pub fn get(key: &str) -> AppResult<Option<String>> {
    match entry(key)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(AppError::Keychain(e.to_string())),
    }
}

pub fn set(key: &str, value: &str) -> AppResult<()> {
    entry(key)?
        .set_password(value)
        .map_err(|e| AppError::Keychain(e.to_string()))
}

pub fn del(key: &str) -> AppResult<()> {
    match entry(key)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(AppError::Keychain(e.to_string())),
    }
}
