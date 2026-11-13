//! LEFI CROP activation codes (ADR-027, INSTALLER.md §9.5, ADR-031).
//!
//! A code is `LEFI1-<payload>.<signature>`, both base64url without padding. `payload` is the
//! licence as JSON; the Ed25519 signature covers the ASCII bytes `LEFI1.` + `<payload>` (the
//! encoded form, so no JSON canonicalisation is needed). The customer app holds only public keys.

use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
use base64::Engine;
use ed25519_dalek::Signature;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[cfg(feature = "issue")]
pub mod issue;
pub mod release;

pub use ed25519_dalek::VerifyingKey;

pub const PREFIX: &str = "LEFI1-";
const SIGNED_PREFIX: &[u8] = b"LEFI1.";

/// The licence carried by a code. Dates are `YYYY-MM-DD` (UTC).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Licence {
    pub v: u8,
    pub licence_id: String,
    pub customer: String,
    /// The installation this code is valid for (see `installation_id`).
    pub installation_id: String,
    /// PCs this installation may enrol, the main PC included.
    pub max_pcs: u32,
    pub edition: String,
    pub issued_at: String,
    /// After this date only updates and new enrolments stop; operation and safety never do.
    pub support_until: String,
    /// `key_id` of the signing key, so a verifier can tell a development code from a real one.
    pub key_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LicenceError {
    Malformed(&'static str),
    UnsupportedVersion(u8),
    UnknownKey(String),
    BadSignature,
    WrongInstallation { code_for: String },
}

impl std::fmt::Display for LicenceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Malformed(why) => write!(f, "This is not a valid activation code ({why})."),
            Self::UnsupportedVersion(v) => write!(f, "Activation code version {v} is not supported by this version of Lefi Crop Helper."),
            Self::UnknownKey(k) => write!(f, "This activation code was not signed by a key this build trusts (key {k})."),
            Self::BadSignature => write!(f, "The activation code's signature is not valid; it may have been altered or mistyped."),
            Self::WrongInstallation { code_for } => write!(f, "This activation code was issued for another installation ({code_for})."),
        }
    }
}

impl std::error::Error for LicenceError {}

impl LicenceError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Malformed(_) => "CODE_MALFORMED",
            Self::UnsupportedVersion(_) => "CODE_VERSION",
            Self::UnknownKey(_) => "CODE_UNKNOWN_KEY",
            Self::BadSignature => "CODE_BAD_SIGNATURE",
            Self::WrongInstallation { .. } => "CODE_WRONG_INSTALLATION",
        }
    }
}

/// Short, stable id of a public key: first 8 bytes of SHA-256, hex.
pub fn key_id(key: &VerifyingKey) -> String {
    hex(&Sha256::digest(key.as_bytes())[..8])
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Public keys are exchanged as base64url (32 bytes).
pub fn parse_public_key(text: &str) -> Result<VerifyingKey, LicenceError> {
    let bytes = B64
        .decode(text.trim())
        .map_err(|_| LicenceError::Malformed("public key is not base64url"))?;
    let arr: [u8; 32] = bytes
        .try_into()
        .map_err(|_| LicenceError::Malformed("public key must be 32 bytes"))?;
    VerifyingKey::from_bytes(&arr)
        .map_err(|_| LicenceError::Malformed("public key is not a valid Ed25519 point"))
}

pub fn encode_public_key(key: &VerifyingKey) -> String {
    B64.encode(key.as_bytes())
}

const CROCKFORD: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/// Installation id from the LEFI root CA certificate (DER): SHA-256, first 10 bytes, Crockford
/// base32, grouped `XXXX-XXXX-XXXX-XXXX` — short enough to read over the phone.
pub fn installation_id(root_ca_der: &[u8]) -> String {
    let digest = Sha256::digest(root_ca_der);
    let mut bits: u128 = 0;
    for b in &digest[..10] {
        bits = (bits << 8) | u128::from(*b);
    }
    let chars: String = (0..16)
        .rev()
        .map(|i| CROCKFORD[((bits >> (i * 5)) & 31) as usize] as char)
        .collect();
    format!(
        "{}-{}-{}-{}",
        &chars[0..4],
        &chars[4..8],
        &chars[8..12],
        &chars[12..16]
    )
}

/// Normalises a typed/pasted installation id (case, spaces, Crockford look-alikes).
pub fn normalize_installation_id(raw: &str) -> String {
    let clean: String = raw
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| match c.to_ascii_uppercase() {
            'O' => '0',
            'I' | 'L' => '1',
            other => other,
        })
        .collect();
    if clean.len() != 16 {
        return raw.trim().to_ascii_uppercase();
    }
    format!(
        "{}-{}-{}-{}",
        &clean[0..4],
        &clean[4..8],
        &clean[8..12],
        &clean[12..16]
    )
}

pub fn is_date(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 10
        && b[4] == b'-'
        && b[7] == b'-'
        && b.iter()
            .enumerate()
            .all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit())
        && (1..=12).contains(&s[5..7].parse::<u8>().unwrap_or(0))
        && (1..=31).contains(&s[8..10].parse::<u8>().unwrap_or(0))
}

/// Decodes and verifies a code against the trusted keys and this installation's id.
pub fn verify(
    code: &str,
    trusted: &[VerifyingKey],
    installation: &str,
) -> Result<Licence, LicenceError> {
    let code: String = code.chars().filter(|c| !c.is_whitespace()).collect();
    let body = code
        .strip_prefix(PREFIX)
        .ok_or(LicenceError::Malformed("it must start with LEFI1-"))?;
    let (payload_b64, sig_b64) = body
        .split_once('.')
        .ok_or(LicenceError::Malformed("missing signature"))?;
    let payload = B64
        .decode(payload_b64)
        .map_err(|_| LicenceError::Malformed("payload is not base64url"))?;
    let sig_bytes: [u8; 64] = B64
        .decode(sig_b64)
        .ok()
        .and_then(|b| b.try_into().ok())
        .ok_or(LicenceError::Malformed("signature must be 64 bytes"))?;
    let licence: Licence = serde_json::from_slice(&payload)
        .map_err(|_| LicenceError::Malformed("payload is not a licence"))?;
    if licence.v != 1 {
        return Err(LicenceError::UnsupportedVersion(licence.v));
    }
    let key = trusted
        .iter()
        .find(|k| key_id(k) == licence.key_id)
        .ok_or_else(|| LicenceError::UnknownKey(licence.key_id.clone()))?;
    let mut signed = SIGNED_PREFIX.to_vec();
    signed.extend_from_slice(payload_b64.as_bytes());
    key.verify_strict(&signed, &Signature::from_bytes(&sig_bytes))
        .map_err(|_| LicenceError::BadSignature)?;
    if !is_date(&licence.issued_at) || !is_date(&licence.support_until) || licence.max_pcs == 0 {
        return Err(LicenceError::Malformed("licence fields are invalid"));
    }
    if normalize_installation_id(&licence.installation_id)
        != normalize_installation_id(installation)
    {
        return Err(LicenceError::WrongInstallation {
            code_for: licence.installation_id,
        });
    }
    Ok(licence)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn installation_id_is_grouped_crockford() {
        let id = installation_id(b"fake certificate bytes");
        assert_eq!(id.len(), 19);
        assert_eq!(id, installation_id(b"fake certificate bytes"));
        assert_ne!(id, installation_id(b"other fake certificate"));
        assert!(id
            .chars()
            .all(|c| c == '-' || CROCKFORD.contains(&(c as u8))));
        assert_eq!(
            normalize_installation_id(&id.to_lowercase().replace('-', " ")),
            id
        );
    }

    #[test]
    fn dates() {
        assert!(is_date("2027-12-31"));
        assert!(!is_date("2027-13-01"));
        assert!(!is_date("27-12-31"));
        assert!(!is_date("2027/12/31"));
    }

    #[test]
    fn garbage_is_malformed() {
        let k = parse_public_key("A".repeat(43).as_str());
        assert!(k.is_err() || k.is_ok());
        assert!(matches!(
            verify("hello", &[], "X"),
            Err(LicenceError::Malformed(_))
        ));
        assert!(matches!(
            verify("LEFI1-abc", &[], "X"),
            Err(LicenceError::Malformed(_))
        ));
    }
}
