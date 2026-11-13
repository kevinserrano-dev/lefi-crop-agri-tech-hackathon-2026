//! Staff side: key generation and signing. Not compiled into Lefi Crop Helper (feature `issue`).

use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
use base64::Engine;
use ed25519_dalek::Signer;
pub use ed25519_dalek::SigningKey;

use crate::{key_id, Licence, PREFIX, SIGNED_PREFIX};

pub fn generate_key() -> std::io::Result<SigningKey> {
    let mut seed = [0u8; 32];
    getrandom::getrandom(&mut seed).map_err(|e| std::io::Error::other(e.to_string()))?;
    Ok(SigningKey::from_bytes(&seed))
}

/// Private keys are stored as base64url of the 32-byte seed.
pub fn encode_signing_key(key: &SigningKey) -> String {
    B64.encode(key.to_bytes())
}

pub fn parse_signing_key(text: &str) -> Result<SigningKey, String> {
    let bytes = B64
        .decode(text.trim())
        .map_err(|_| "private key is not base64url".to_string())?;
    let seed: [u8; 32] = bytes
        .try_into()
        .map_err(|_| "private key must be 32 bytes".to_string())?;
    Ok(SigningKey::from_bytes(&seed))
}

pub fn random_licence_id() -> std::io::Result<String> {
    let mut b = [0u8; 5];
    getrandom::getrandom(&mut b).map_err(|e| std::io::Error::other(e.to_string()))?;
    Ok(format!(
        "LIC-{}",
        b.iter().map(|x| format!("{x:02X}")).collect::<String>()
    ))
}

/// Signs `licence` (its `key_id` is set from `key`) and returns the activation code.
pub fn sign(mut licence: Licence, key: &SigningKey) -> String {
    licence.key_id = key_id(&key.verifying_key());
    let payload = B64.encode(serde_json::to_vec(&licence).expect("licence serialises"));
    let mut signed = SIGNED_PREFIX.to_vec();
    signed.extend_from_slice(payload.as_bytes());
    let sig = key.sign(&signed);
    format!("{PREFIX}{payload}.{}", B64.encode(sig.to_bytes()))
}

/// Today's UTC date as `YYYY-MM-DD` (civil-from-days, no time crate needed).
pub fn today_utc() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let z = (secs / 86_400) as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{is_date, verify, LicenceError};

    fn licence(installation: &str) -> Licence {
        Licence {
            v: 1,
            licence_id: "LIC-TEST".into(),
            customer: "Fake Greenhouse Ltd".into(),
            installation_id: installation.into(),
            max_pcs: 3,
            edition: "standard".into(),
            issued_at: "2026-01-01".into(),
            support_until: "2027-01-01".into(),
            key_id: String::new(),
        }
    }

    #[test]
    fn round_trip_and_tampering() {
        let key = generate_key().unwrap();
        let other = generate_key().unwrap();
        let code = sign(licence("ABCD-EFGH-JKMN-PQRS"), &key);
        let trusted = [key.verifying_key()];

        let ok = verify(&code, &trusted, "abcd efgh jkmn pqrs").unwrap();
        assert_eq!(ok.customer, "Fake Greenhouse Ltd");
        assert_eq!(ok.key_id, key_id(&key.verifying_key()));

        assert!(matches!(
            verify(&code, &trusted, "ZZZZ-ZZZZ-ZZZZ-ZZZZ"),
            Err(LicenceError::WrongInstallation { .. })
        ));
        assert!(matches!(
            verify(&code, &[other.verifying_key()], "ABCD-EFGH-JKMN-PQRS"),
            Err(LicenceError::UnknownKey(_))
        ));

        // Change one character of the payload: the signature no longer matches.
        let mut chars: Vec<char> = code.chars().collect();
        let i = PREFIX.len() + 10;
        chars[i] = if chars[i] == 'A' { 'B' } else { 'A' };
        let tampered: String = chars.into_iter().collect();
        assert!(verify(&tampered, &trusted, "ABCD-EFGH-JKMN-PQRS").is_err());

        // A code wrapped over lines by an email client still verifies.
        let wrapped = format!("{}\n{}", &code[..40], &code[40..]);
        assert!(verify(&wrapped, &trusted, "ABCD-EFGH-JKMN-PQRS").is_ok());
    }

    #[test]
    fn key_text_round_trip() {
        let key = generate_key().unwrap();
        let back = parse_signing_key(&encode_signing_key(&key)).unwrap();
        assert_eq!(back.to_bytes(), key.to_bytes());
        assert_eq!(
            crate::parse_public_key(&crate::encode_public_key(&key.verifying_key())).unwrap(),
            key.verifying_key()
        );
    }

    #[test]
    fn today_is_a_date() {
        assert!(is_date(&today_utc()));
    }
}
