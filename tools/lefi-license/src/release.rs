//! Signed update packages (`.lefiupdate`, ADR-035). One file per Lefi Crop release:
//! an uncompressed tar with `manifest.json`, `manifest.sig` and `app.tar.gz` (Lefi Crop Helper.app,
//! which carries every component). The Ed25519 signature covers `LEFIREL1.` + the exact bytes of
//! `manifest.json`; the manifest carries the SHA-256 of `app.tar.gz`. The release key is separate
//! from the licence key, so a leaked key can forge one kind of artefact, not both.

use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
use base64::Engine;
use ed25519_dalek::{Signature, VerifyingKey};
use serde::{Deserialize, Serialize};

use crate::key_id;

const SIGNED_PREFIX: &[u8] = b"LEFIREL1.";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(deny_unknown_fields)]
pub struct Components {
    pub helper: String,
    pub helperd: String,
    pub brain: String,
    pub desktop: Option<String>,
    /// The installer and CLI (the repository `VERSION`).
    pub installer: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReleaseManifest {
    pub v: u8,
    /// The Lefi Crop release (`VERSION`), compared to decide what is newer.
    pub release: String,
    /// YYYY-MM-DD; a licence whose support ended before this date may not install it.
    pub released_at: String,
    /// Security fix: notified with priority.
    pub security: bool,
    pub notes: String,
    pub components: Components,
    pub app_sha256: String,
    pub app_size: u64,
    pub key_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReleaseError {
    Malformed(&'static str),
    UnknownKey(String),
    BadSignature,
}

impl std::fmt::Display for ReleaseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Malformed(w) => write!(f, "This is not a valid Lefi Crop update ({w})."),
            Self::UnknownKey(k) => write!(f, "This update was not signed by Lefi (key {k})."),
            Self::BadSignature => write!(
                f,
                "The update's signature is not valid; the file was altered or damaged."
            ),
        }
    }
}

impl std::error::Error for ReleaseError {}

impl ReleaseError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Malformed(_) => "UPDATE_MALFORMED",
            Self::UnknownKey(_) => "UPDATE_UNKNOWN_KEY",
            Self::BadSignature => "UPDATE_BAD_SIGNATURE",
        }
    }
}

/// Verifies `manifest.json` bytes against `manifest.sig` text with the trusted release keys.
pub fn verify_manifest(
    manifest: &[u8],
    sig_text: &str,
    trusted: &[VerifyingKey],
) -> Result<ReleaseManifest, ReleaseError> {
    let m: ReleaseManifest =
        serde_json::from_slice(manifest).map_err(|_| ReleaseError::Malformed("manifest"))?;
    if m.v != 1 {
        return Err(ReleaseError::Malformed("manifest version"));
    }
    let sig: [u8; 64] = B64
        .decode(sig_text.trim())
        .ok()
        .and_then(|b| b.try_into().ok())
        .ok_or(ReleaseError::Malformed("signature"))?;
    let key = trusted
        .iter()
        .find(|k| key_id(k) == m.key_id)
        .ok_or_else(|| ReleaseError::UnknownKey(m.key_id.clone()))?;
    let mut signed = SIGNED_PREFIX.to_vec();
    signed.extend_from_slice(manifest);
    key.verify_strict(&signed, &Signature::from_bytes(&sig))
        .map_err(|_| ReleaseError::BadSignature)?;
    if parse_version(&m.release).is_none()
        || !crate::is_date(&m.released_at)
        || m.app_sha256.len() != 64
    {
        return Err(ReleaseError::Malformed("fields"));
    }
    Ok(m)
}

/// `MAJOR.MINOR.PATCH` → comparable tuple (pre-release suffixes are not used).
pub fn parse_version(v: &str) -> Option<(u64, u64, u64)> {
    let mut it = v.trim().split('.').map(|p| p.parse::<u64>().ok());
    let t = (it.next()??, it.next()??, it.next()??);
    if it.next().is_some() {
        return None;
    }
    Some(t)
}

/// a > b ?
pub fn newer(a: &str, b: &str) -> bool {
    match (parse_version(a), parse_version(b)) {
        (Some(x), Some(y)) => x > y,
        _ => false,
    }
}

#[cfg(feature = "issue")]
pub mod sign {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    /// Signs a manifest (its `key_id` is set from `key`); returns (manifest bytes, signature text).
    pub fn sign_manifest(mut m: ReleaseManifest, key: &SigningKey) -> (Vec<u8>, String) {
        m.key_id = key_id(&key.verifying_key());
        let bytes = serde_json::to_vec_pretty(&m).expect("manifest serialises");
        let mut signed = SIGNED_PREFIX.to_vec();
        signed.extend_from_slice(&bytes);
        (bytes, B64.encode(key.sign(&signed).to_bytes()))
    }
}

#[cfg(all(test, feature = "issue"))]
mod tests {
    use super::sign::sign_manifest;
    use super::*;
    use crate::issue::generate_key;

    fn manifest() -> ReleaseManifest {
        ReleaseManifest {
            v: 1,
            release: "0.3.0".into(),
            released_at: "2026-11-06".into(),
            security: false,
            notes: "fake release for tests".into(),
            components: Components::default(),
            app_sha256: "a".repeat(64),
            app_size: 1,
            key_id: String::new(),
        }
    }

    #[test]
    fn signed_manifest_verifies_and_tampering_is_caught() {
        let k = generate_key().unwrap();
        let (bytes, sig) = sign_manifest(manifest(), &k);
        assert_eq!(
            verify_manifest(&bytes, &sig, &[k.verifying_key()])
                .unwrap()
                .release,
            "0.3.0"
        );
        let mut altered = bytes.clone();
        let i = altered.windows(5).position(|w| w == b"0.3.0").unwrap();
        altered[i + 2] = b'9';
        assert_eq!(
            verify_manifest(&altered, &sig, &[k.verifying_key()]).unwrap_err(),
            ReleaseError::BadSignature
        );
        let other = generate_key().unwrap();
        assert!(matches!(
            verify_manifest(&bytes, &sig, &[other.verifying_key()]),
            Err(ReleaseError::UnknownKey(_))
        ));
    }

    #[test]
    fn versions_compare_numerically() {
        assert!(newer("0.10.0", "0.9.9"));
        assert!(!newer("0.2.0", "0.2.0"));
        assert!(
            !newer("1.0", "0.9.0"),
            "malformed versions never count as newer"
        );
    }
}
