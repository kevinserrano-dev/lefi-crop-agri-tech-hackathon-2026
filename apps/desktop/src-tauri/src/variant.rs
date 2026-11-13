//! Which Lefi Desktop this is: the installed one, or the development one (ADR-078).
//!
//! `pnpm dev:desktop` runs with the identifier `ai.leficrop.desktop.dev`, so a developer can pair
//! with the real Lefi Brain from the same PC without touching the installed app: its own data
//! folder, its own keychain service, its own machine id (Lefi Brain keeps one pairing per machine
//! id, so sharing it would revoke the installed app's pairing) and "(dev)" in its name and title.

use std::sync::OnceLock;

/// The installed app's identifier (`tauri.conf.json`).
pub const PRODUCTION: &str = "ai.leficrop.desktop";

static IDENTIFIER: OnceLock<String> = OnceLock::new();

/// Set once at start from the app's configuration.
pub fn init(identifier: &str) {
    let _ = IDENTIFIER.set(identifier.to_string());
}

pub fn identifier() -> &'static str {
    IDENTIFIER.get().map(String::as_str).unwrap_or(PRODUCTION)
}

pub fn is_production() -> bool {
    identifier() == PRODUCTION
}

/// "" for the installed app, " (dev)" for any other identifier.
pub fn suffix() -> &'static str {
    if is_production() {
        ""
    } else {
        " (dev)"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_installed_app_is_the_default() {
        // Not initialised in unit tests: everything behaves as the installed app.
        assert_eq!(identifier(), PRODUCTION);
        assert!(is_production());
        assert_eq!(suffix(), "");
    }
}
