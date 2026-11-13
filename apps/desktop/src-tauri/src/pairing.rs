//! Pairing this PC with Lefi Brain (ADR-048). The private key is created here and never leaves this
//! PC: it is kept in `device-key.pem` (mode 600) in the app's data folder — not in the macOS
//! keychain, whose access is tied to the exact signature of the app that stored it, so an ad-hoc
//! signed update could not read it back without a permission dialog (ADR-053). Lefi Brain signs only
//! its public key. The one-time code is never sent: the request
//! carries an HMAC over the CSR keyed by it, and the answer carries an HMAC over everything this
//! app keeps — checked before anything is pinned, because this first contact has no pinned CA yet.

use std::path::{Path, PathBuf};
use std::time::Duration;

use hmac::{Hmac, Mac};
use reqwest::{redirect, Client};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::config::parse_origin;
use crate::error::{AppError, AppResult};

const LABEL: &[u8] = b"LEFIPAIR1";
const CROCKFORD: &str = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_CHARS: usize = 12;
const PAIR_PATH: &str = "/api/v1/devices/pair";
pub const KEY_ACCOUNT: &str = "device-key";
pub const KEY_FILE: &str = "device-key.pem";

/// What a paired PC remembers (no secret: the private key is in `device-key.pem`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Pairing {
    pub url: String,
    pub device_id: String,
    pub cert_pem: String,
    pub ca_pem: String,
    pub gateway_ca_pem: String,
    pub expires_at: String,
    /// Unix seconds.
    pub paired_at_unix: u64,
    /// SHA-256 of the pinned gateway CA, shown to people who want to compare.
    pub gateway_ca_fingerprint: String,
    /// Other addresses of the same Lefi Gateway (its IP when the name does not resolve), tried
    /// when `url` does not answer (ADR-055).
    #[serde(default)]
    pub alternates: Vec<String>,
}

/// Where the private key lives. The app uses a private file; tests use memory.
pub trait KeyVault: Send + Sync {
    fn get(&self) -> AppResult<Option<String>>;
    fn set(&self, pem: &str) -> AppResult<()>;
    fn del(&self) -> AppResult<()>;
}

/// `device-key.pem` in the app's data folder: file 600, folder 700, written atomically. Readable
/// only by this PC's user, the same boundary as the Brain's and Lefi Crop Helper's own keys.
pub struct FileVault {
    path: PathBuf,
}

impl FileVault {
    pub fn new(dir: &Path) -> Self {
        Self {
            path: dir.join(KEY_FILE),
        }
    }
}

fn private_write(path: &Path, text: &str) -> AppResult<()> {
    let dir = path
        .parent()
        .ok_or_else(|| AppError::Config("no folder".into()))?;
    std::fs::create_dir_all(dir).map_err(|e| AppError::Config(e.to_string()))?;
    let tmp = path.with_extension("tmp");
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
        let _ = std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700));
        let mut f = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(&tmp)
            .map_err(|e| AppError::Config(e.to_string()))?;
        f.write_all(text.as_bytes())
            .map_err(|e| AppError::Config(e.to_string()))?;
    }
    #[cfg(not(unix))]
    std::fs::write(&tmp, text).map_err(|e| AppError::Config(e.to_string()))?;
    std::fs::rename(&tmp, path).map_err(|e| AppError::Config(e.to_string()))
}

impl KeyVault for FileVault {
    fn get(&self) -> AppResult<Option<String>> {
        match std::fs::read_to_string(&self.path) {
            Ok(t) if t.contains("PRIVATE KEY") => Ok(Some(t)),
            Ok(_) => Ok(None),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(AppError::Config(e.to_string())),
        }
    }
    fn set(&self, pem: &str) -> AppResult<()> {
        private_write(&self.path, pem)
    }
    fn del(&self) -> AppResult<()> {
        match std::fs::remove_file(&self.path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(AppError::Config(e.to_string())),
        }
    }
}

/// `pairing.json` in the app's data folder.
pub struct PairingStore {
    path: PathBuf,
}

impl PairingStore {
    pub fn new(dir: &Path) -> Self {
        Self {
            path: dir.join("pairing.json"),
        }
    }

    pub fn load(&self) -> Option<Pairing> {
        let text = std::fs::read_to_string(&self.path).ok()?;
        serde_json::from_str(&text).ok()
    }

    pub fn save(&self, p: &Pairing) -> AppResult<()> {
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| AppError::Config(e.to_string()))?;
        }
        let text = serde_json::to_string_pretty(p).map_err(|e| AppError::Config(e.to_string()))?;
        let tmp = self.path.with_extension("json.tmp");
        std::fs::write(&tmp, text).map_err(|e| AppError::Config(e.to_string()))?;
        std::fs::rename(&tmp, &self.path).map_err(|e| AppError::Config(e.to_string()))
    }

    pub fn delete(&self) -> AppResult<()> {
        match std::fs::remove_file(&self.path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(AppError::Config(e.to_string())),
        }
    }

    /// The pairing and its private key, only when both are here. A `pairing.json` whose key is
    /// missing (one kept in the keychain by Lefi Desktop 0.3.1 or older, or files removed by Lefi
    /// Crop Helper's reset) cannot sign in: it is deleted, so this PC pairs again by itself.
    pub fn usable(&self, vault: &dyn KeyVault) -> Option<(Pairing, String)> {
        let p = self.load()?;
        match vault.get() {
            Ok(Some(key)) => Some((p, key)),
            _ => {
                eprintln!("pairing: no private key for {}; pairing again", p.device_id);
                let _ = self.delete();
                None
            }
        }
    }
}

/// Left by Lefi Crop Helper when it installed this Lefi Desktop (ADR-048): pair once, by itself.
#[derive(Debug, Deserialize)]
pub struct Offer {
    pub url: String,
    pub code: String,
    /// SHA-256 of Lefi Gateway's CA as Lefi Crop Helper reads it on the main PC: the answer must
    /// carry exactly this CA, so this PC trusts nothing it was not told about.
    pub gateway_ca_fingerprint: Option<String>,
    /// Other addresses of the same gateway, tried in order when `url` does not answer (ADR-055).
    #[serde(default)]
    pub alternates: Vec<String>,
}

pub const OFFER_FILE: &str = "pairing-offer.json";
pub const STATUS_FILE: &str = "pairing-status.json";
/// A pairing code lasts 10 minutes on Lefi Brain; an older offer cannot work any more.
pub const OFFER_TTL_S: u64 = 10 * 60;

/// The offer and its age in seconds. It stays until it worked, was refused or expired: a main PC
/// that is not reachable yet must not cost this PC its offer (ADR-055).
pub fn read_offer(dir: &Path) -> Option<(Offer, u64)> {
    let path = dir.join(OFFER_FILE);
    let age = std::fs::metadata(&path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.elapsed().ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let text = std::fs::read_to_string(&path).ok()?;
    match serde_json::from_str(&text) {
        Ok(o) => Some((o, age)),
        Err(_) => {
            drop_offer(dir); // unreadable: nothing could ever use it
            None
        }
    }
}

pub fn drop_offer(dir: &Path) {
    let _ = std::fs::remove_file(dir.join(OFFER_FILE));
}

/// Reads and removes the offer (one use, whatever happens next).
pub fn take_offer(dir: &Path) -> Option<Offer> {
    let o = read_offer(dir).map(|(o, _)| o);
    drop_offer(dir);
    o
}

/// The last automatic pairing attempt, for this app's sign-in page and for Lefi Crop Helper.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PairingStatus {
    /// pairing · paired · retrying · failed
    pub state: String,
    pub message: String,
    pub url: Option<String>,
    /// Unix seconds.
    pub at: u64,
}

pub fn write_status(dir: &Path, state: &str, message: &str, url: Option<&str>) {
    let st = PairingStatus {
        state: state.into(),
        message: message.chars().take(300).collect(),
        url: url.map(str::to_string),
        at: now_unix(),
    };
    if let Ok(text) = serde_json::to_string_pretty(&st) {
        let _ = std::fs::create_dir_all(dir);
        let tmp = dir.join("pairing-status.json.tmp");
        if std::fs::write(&tmp, text).is_ok() {
            let _ = std::fs::rename(tmp, dir.join(STATUS_FILE));
        }
    }
}

pub fn read_status(dir: &Path) -> Option<PairingStatus> {
    serde_json::from_str(&std::fs::read_to_string(dir.join(STATUS_FILE)).ok()?).ok()
}

/// A stable identifier of this computer, hashed so the hardware id itself never leaves it: Lefi
/// Brain uses it to replace this PC's older pairing instead of adding another device (ADR-055).
/// Same derivation as Lefi Crop Helper (`devices.rs`), so it can tell which entry is this PC.
pub fn machine_id() -> Option<String> {
    let raw = if cfg!(target_os = "macos") {
        let out = std::process::Command::new("/usr/sbin/ioreg")
            .args(["-rd1", "-c", "IOPlatformExpertDevice"])
            .output()
            .ok()?;
        let text = String::from_utf8_lossy(&out.stdout).into_owned();
        text.lines()
            .find(|l| l.contains("\"IOPlatformUUID\""))
            .and_then(|l| l.split('"').nth(3).map(str::to_string))?
    } else {
        std::fs::read_to_string("/etc/machine-id")
            .ok()?
            .trim()
            .to_string()
    };
    machine_id_for(&raw, crate::variant::identifier())
}

/// The installed app sends the id Lefi Crop Helper also computes; any other identifier (the
/// development app) mixes it in, so Lefi Brain sees another device and never replaces the
/// installed app's pairing with it (ADR-078).
pub fn machine_id_for(raw: &str, identifier: &str) -> Option<String> {
    if identifier == crate::variant::PRODUCTION {
        return machine_id_from(raw);
    }
    let raw = raw.trim();
    (!raw.is_empty()).then(|| sha256_hex(format!("LEFIMACHINE1|{raw}|{identifier}").as_bytes()))
}

pub fn machine_id_from(raw: &str) -> Option<String> {
    let raw = raw.trim();
    (!raw.is_empty()).then(|| sha256_hex(format!("LEFIMACHINE1|{raw}").as_bytes()))
}

/// Pairs with an offer; refuses an answer whose gateway CA is not the one Lefi Crop Helper named.
pub async fn pair_with_offer(
    offer: &Offer,
    device_name: &str,
    vault: &dyn KeyVault,
) -> AppResult<Pairing> {
    let expected = offer
        .gateway_ca_fingerprint
        .clone()
        .filter(|f| f.len() == 64)
        .ok_or_else(|| AppError::Pairing("The pairing offer names no gateway CA.".into()))?;
    let mut urls = vec![offer.url.clone()];
    urls.extend(offer.alternates.iter().cloned());
    let p = pair_any(&urls, &offer.code, device_name, vault, false).await?;
    if p.gateway_ca_fingerprint != expected.to_ascii_lowercase() {
        let _ = vault.del();
        return Err(AppError::Pairing(
            "The main PC answered with a different certificate authority than Lefi Crop Helper named. Nothing was kept.".into(),
        ));
    }
    Ok(p)
}

/// What a person types: spaces/dashes, lower case, O→0, I/L→1 (Crockford).
pub fn normalise_code(raw: &str) -> Option<String> {
    let s: String = raw
        .chars()
        .filter(|c| !matches!(c, '-' | ' '))
        .map(|c| match c.to_ascii_uppercase() {
            'O' => '0',
            'I' | 'L' => '1',
            other => other,
        })
        .collect();
    (s.len() == CODE_CHARS && s.chars().all(|c| CROCKFORD.contains(c))).then_some(s)
}

fn sha256_hex(data: &[u8]) -> String {
    hex::encode(Sha256::digest(data))
}

pub fn proof_key(code: &str) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(LABEL);
    h.update(b"|key|");
    h.update(code.as_bytes());
    h.finalize().into()
}

fn hmac_hex(key: &[u8], msg: &[u8]) -> String {
    let mut m = Hmac::<Sha256>::new_from_slice(key).expect("HMAC takes any key length");
    m.update(msg);
    hex::encode(m.finalize().into_bytes())
}

pub fn request_proof(key: &[u8], csr_der: &[u8]) -> String {
    let mut msg = LABEL.to_vec();
    msg.extend_from_slice(b"|req|");
    msg.extend_from_slice(sha256_hex(csr_der).as_bytes());
    hmac_hex(key, &msg)
}

pub fn response_proof(key: &[u8], device_id: &str, cert: &str, ca: &str, gw: &str) -> String {
    let parts = [
        device_id.to_string(),
        sha256_hex(cert.as_bytes()),
        sha256_hex(ca.as_bytes()),
        sha256_hex(gw.as_bytes()),
    ];
    let mut msg = LABEL.to_vec();
    msg.extend_from_slice(b"|res|");
    msg.extend_from_slice(parts.join("|").as_bytes());
    hmac_hex(key, &msg)
}

/// Constant-time comparison of two hex proofs.
fn same(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.to_ascii_lowercase().into_bytes());
    a.len() == b.len()
        && a.iter()
            .zip(b.iter())
            .fold(0u8, |acc, (x, y)| acc | (x ^ y))
            == 0
}

/// A new P-256 key (PKCS#8 PEM, for the keychain) and its CSR (PEM, DER).
pub fn new_key_and_csr(device_name: &str) -> AppResult<(String, String, Vec<u8>)> {
    let key = rcgen::KeyPair::generate_for(&rcgen::PKCS_ECDSA_P256_SHA256)
        .map_err(|e| AppError::Config(format!("key: {e}")))?;
    let mut params = rcgen::CertificateParams::default();
    params
        .distinguished_name
        .push(rcgen::DnType::CommonName, device_name);
    let csr = params
        .serialize_request(&key)
        .map_err(|e| AppError::Config(format!("CSR: {e}")))?;
    let pem = csr
        .pem()
        .map_err(|e| AppError::Config(format!("CSR: {e}")))?;
    Ok((key.serialize_pem(), pem, csr.der().to_vec()))
}

#[derive(Serialize)]
struct PairRequest<'a> {
    csr_pem: &'a str,
    proof: String,
    device_name: &'a str,
    platform: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    machine_id: Option<String>,
}

#[derive(Deserialize)]
struct PairAnswer {
    device_id: String,
    cert_pem: String,
    ca_pem: String,
    gateway_ca_pem: String,
    expires_at: String,
    proof: String,
}

/// Client for the pairing request only: the server's certificate is not checked (no CA is pinned
/// yet); the answer is authenticated by its HMAC instead. Nothing secret is sent.
fn first_contact_client() -> AppResult<Client> {
    Client::builder()
        .no_proxy()
        .redirect(redirect::Policy::none())
        .tls_danger_accept_invalid_certs(true)
        .tls_danger_accept_invalid_hostnames(true)
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(20))
        .user_agent(concat!("lefi-desktop/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| AppError::Config(e.to_string()))
}

fn brain_message(body: &serde_json::Value) -> Option<String> {
    body["error"]["message"]
        .as_str()
        .map(|m| m.chars().take(200).collect())
}

/// Tries each address of the same gateway in order; only "not answering" moves to the next one (a
/// refused code is refused everywhere). The address that answered becomes the pairing's `url`.
pub async fn pair_any(
    urls: &[String],
    code: &str,
    device_name: &str,
    vault: &dyn KeyVault,
    debug: bool,
) -> AppResult<Pairing> {
    let mut last = AppError::Unreachable("no address to try".into());
    let mut seen: Vec<&String> = vec![];
    for url in urls {
        if seen.contains(&url) {
            continue;
        }
        seen.push(url);
        match pair(url, code, device_name, vault, debug).await {
            Ok(mut p) => {
                p.alternates = urls
                    .iter()
                    .filter(|u| u.trim_end_matches('/') != p.url)
                    .cloned()
                    .collect();
                p.alternates.dedup();
                return Ok(p);
            }
            Err(AppError::Unreachable(e)) => {
                eprintln!("pairing: {url} did not answer ({e})");
                last = AppError::Unreachable(format!("{url}: {e}"));
            }
            Err(e) => return Err(e),
        }
    }
    Err(last)
}

/// Pairs with the Lefi Brain at `url` using `code`. Stores the key in `vault`, returns the pairing.
pub async fn pair(
    url: &str,
    code: &str,
    device_name: &str,
    vault: &dyn KeyVault,
    debug: bool,
) -> AppResult<Pairing> {
    let origin = parse_origin(url, debug)?;
    let origin = origin.as_str().trim_end_matches('/').to_string();
    let code = normalise_code(code).ok_or(AppError::Pairing(
        "That code is not complete: it has 12 letters and digits, like ABCD-EFGH-JKMN.".into(),
    ))?;
    let key = proof_key(&code);
    let (key_pem, csr_pem, csr_der) = new_key_and_csr(device_name)?;
    let res = first_contact_client()?
        .post(format!("{origin}{PAIR_PATH}"))
        .json(&PairRequest {
            csr_pem: &csr_pem,
            proof: request_proof(&key, &csr_der),
            device_name,
            platform: std::env::consts::OS,
            machine_id: machine_id(),
        })
        .send()
        .await
        .map_err(|e| AppError::Unreachable(e.without_url().to_string()))?;
    let status = res.status().as_u16();
    let body: serde_json::Value = res.json().await.unwrap_or(serde_json::Value::Null);
    if status != 200 {
        let msg = match body["error"]["code"].as_str() {
            Some("PAIRING_REFUSED") => "Lefi Brain refused this code: it is wrong, used or expired. Create a new one in Lefi Crop Helper.".to_string(),
            Some("PAIRING_THROTTLED") => "Too many wrong codes. Wait a few minutes, then try again.".to_string(),
            _ => brain_message(&body).unwrap_or_else(|| format!("Lefi Brain answered {status}.")),
        };
        return Err(AppError::Pairing(msg));
    }
    let a: PairAnswer = serde_json::from_value(body)
        .map_err(|_| AppError::Pairing("That address did not answer like Lefi Brain.".into()))?;
    let expected = response_proof(
        &key,
        &a.device_id,
        &a.cert_pem,
        &a.ca_pem,
        &a.gateway_ca_pem,
    );
    if !same(&expected, &a.proof) {
        // Something between this PC and the main PC changed the answer, or it is not our Brain.
        return Err(AppError::Pairing(
            "The answer could not be verified with this code. Nothing was saved. Check that this PC is on the greenhouse network and try again.".into(),
        ));
    }
    // The pinned CA and our identity must be usable before anything is saved.
    let _ = crate::brain::pinned_builder(a.gateway_ca_pem.as_bytes())?;
    reqwest::Identity::from_pem(format!("{key_pem}\n{}", a.cert_pem).as_bytes()).map_err(|e| {
        AppError::Pairing(format!(
            "The certificate from Lefi Brain is not usable: {e}"
        ))
    })?;
    vault.set(&key_pem)?;
    Ok(Pairing {
        url: origin,
        device_id: a.device_id,
        cert_pem: a.cert_pem,
        ca_pem: a.ca_pem,
        gateway_ca_fingerprint: gateway_fingerprint(&a.gateway_ca_pem),
        gateway_ca_pem: a.gateway_ca_pem,
        expires_at: a.expires_at,
        paired_at_unix: now_unix(),
        alternates: vec![],
    })
}

/// SHA-256 of the CA certificate (DER), as `openssl x509 -fingerprint -sha256` shows it.
pub fn gateway_fingerprint(pem: &str) -> String {
    use base64::Engine;
    let body: String = pem
        .lines()
        .filter(|l| !l.starts_with("-----"))
        .map(str::trim)
        .collect();
    match base64::engine::general_purpose::STANDARD.decode(body) {
        Ok(der) => sha256_hex(&der),
        Err(_) => String::new(),
    }
}

fn now_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Same vectors as Lefi Brain's Python (services/brain `client_devices/domain.py`).
    #[test]
    fn proofs_match_the_brain() {
        let code = normalise_code("abcd-efgh-jkmn").unwrap();
        assert_eq!(code, "ABCDEFGHJKMN");
        let key = proof_key(&code);
        assert_eq!(
            hex::encode(key),
            "084e917b7c7d1786c421fab3ab3215c836392ba3616b27bd4d6726c76e646d5b"
        );
        assert_eq!(
            request_proof(&key, b"TEST csr der"),
            "c4dda2a1c2d38f88593ee50b0e6fe2522cbd7e9b15ebf34980090125aaf77b9c"
        );
        assert_eq!(
            response_proof(
                &key,
                "00000000-0000-0000-0000-000000000001",
                "CERT",
                "CA",
                "GW"
            ),
            "caaed3059ab4933f7383c2b7c6557d1d3f81fe40a27341239fbf061b8cc36724"
        );
    }

    #[test]
    fn codes_accept_what_people_type() {
        assert_eq!(
            normalise_code(" 0O1I-L234 5678").as_deref(),
            Some("001112345678")
        );
        assert!(normalise_code("ABCD-EFGH-JKM").is_none());
        assert!(normalise_code("ABCD-EFGH-JKMU").is_none());
    }

    #[test]
    fn a_key_and_csr_are_made_here() {
        let (key, csr, der) = new_key_and_csr("TEST desk").unwrap();
        assert!(key.contains("PRIVATE KEY") && csr.contains("CERTIFICATE REQUEST"));
        assert!(!der.is_empty());
    }

    #[test]
    fn the_store_round_trips_without_secrets() {
        let dir = std::env::temp_dir().join(format!("lefi-pairing-test-{}", std::process::id()));
        let store = PairingStore::new(&dir);
        assert!(store.load().is_none());
        let p = Pairing {
            url: "https://lefi-main.local:8443".into(),
            device_id: "d".into(),
            cert_pem: "c".into(),
            ca_pem: "a".into(),
            gateway_ca_pem: "g".into(),
            expires_at: "e".into(),
            paired_at_unix: 1,
            gateway_ca_fingerprint: "f".into(),
            alternates: vec![],
        };
        store.save(&p).unwrap();
        assert_eq!(store.load(), Some(p));
        let text = std::fs::read_to_string(dir.join("pairing.json")).unwrap();
        assert!(!text.contains("PRIVATE KEY"));
        store.delete().unwrap();
        assert!(store.load().is_none());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn an_offer_is_used_once() {
        let dir = std::env::temp_dir().join(format!("lefi-offer-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join(OFFER_FILE),
            r#"{"url":"https://lefi-main.local:8443","code":"ABCD-EFGH-JKMN","gateway_ca_fingerprint":null}"#,
        )
        .unwrap();
        let offer = take_offer(&dir).expect("read");
        assert_eq!(offer.code, "ABCD-EFGH-JKMN");
        assert!(take_offer(&dir).is_none(), "removed after reading");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn an_offer_without_the_gateway_ca_is_refused() {
        struct Never;
        impl KeyVault for Never {
            fn get(&self) -> AppResult<Option<String>> {
                Ok(None)
            }
            fn set(&self, _: &str) -> AppResult<()> {
                panic!("nothing may be stored")
            }
            fn del(&self) -> AppResult<()> {
                Ok(())
            }
        }
        let offer = Offer {
            url: "https://192.0.2.1:8443".into(),
            code: "ABCD-EFGH-JKMN".into(),
            gateway_ca_fingerprint: None,
            alternates: vec![],
        };
        assert!(pair_with_offer(&offer, "x", &Never).await.is_err());
    }

    #[tokio::test]
    async fn an_incomplete_code_is_refused_before_any_request() {
        struct Never;
        impl KeyVault for Never {
            fn get(&self) -> AppResult<Option<String>> {
                Ok(None)
            }
            fn set(&self, _: &str) -> AppResult<()> {
                panic!("nothing may be stored")
            }
            fn del(&self) -> AppResult<()> {
                Ok(())
            }
        }
        let err = pair("https://192.0.2.1:8443", "ABCD", "x", &Never, false)
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::Pairing(_)));
    }

    struct Box(std::sync::Mutex<Option<String>>);
    impl KeyVault for Box {
        fn get(&self) -> AppResult<Option<String>> {
            Ok(self.0.lock().unwrap().clone())
        }
        fn set(&self, pem: &str) -> AppResult<()> {
            *self.0.lock().unwrap() = Some(pem.into());
            Ok(())
        }
        fn del(&self) -> AppResult<()> {
            *self.0.lock().unwrap() = None;
            Ok(())
        }
    }

    fn sample() -> Pairing {
        Pairing {
            url: "https://lefi-main.local:8443".into(),
            device_id: "d-test".into(),
            cert_pem: "CERT".into(),
            ca_pem: "CA".into(),
            gateway_ca_pem: "GW".into(),
            expires_at: "2027-01-01T00:00:00Z".into(),
            paired_at_unix: 1,
            gateway_ca_fingerprint: "00".repeat(32),
            alternates: vec!["https://192.0.2.10:8443".into()],
        }
    }

    #[cfg(unix)]
    #[test]
    fn the_key_file_is_private_and_survives_like_any_file() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("lefi-vault-{}", std::process::id()));
        let v = FileVault::new(&dir);
        assert_eq!(v.get().unwrap(), None);
        v.set("-----BEGIN PRIVATE KEY-----\nTEST ONLY\n-----END PRIVATE KEY-----\n")
            .unwrap();
        let mode = std::fs::metadata(dir.join(KEY_FILE))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
        let dmode = std::fs::metadata(&dir).unwrap().permissions().mode();
        assert_eq!(dmode & 0o077, 0, "the folder is private too");
        // A second instance (an updated app) reads it back without asking anyone.
        assert!(FileVault::new(&dir)
            .get()
            .unwrap()
            .unwrap()
            .contains("TEST ONLY"));
        v.del().unwrap();
        v.del().unwrap();
        assert_eq!(v.get().unwrap(), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_pairing_without_its_key_is_dropped_so_the_pc_pairs_again() {
        let dir = std::env::temp_dir().join(format!("lefi-store-{}", std::process::id()));
        let store = PairingStore::new(&dir);
        store.save(&sample()).unwrap();
        let empty = Box(std::sync::Mutex::new(None));
        assert!(store.usable(&empty).is_none());
        assert!(store.load().is_none(), "the stale pairing.json is gone");
        store.save(&sample()).unwrap();
        let with_key = Box(std::sync::Mutex::new(Some("KEY".into())));
        let (p, key) = store.usable(&with_key).unwrap();
        assert_eq!((p.device_id.as_str(), key.as_str()), ("d-test", "KEY"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Same vector as Lefi Crop Helper's `devices::machine_id_from` (ADR-055).
    #[test]
    fn the_development_app_is_another_machine_for_lefi_brain() {
        let prod = machine_id_for("TEST-ONLY-UUID", crate::variant::PRODUCTION);
        assert_eq!(prod, machine_id_from("TEST-ONLY-UUID"));
        let dev = machine_id_for("TEST-ONLY-UUID", "ai.leficrop.desktop.dev");
        assert!(dev.is_some() && dev != prod);
        assert_eq!(
            dev,
            machine_id_for(" TEST-ONLY-UUID ", "ai.leficrop.desktop.dev")
        );
        assert_eq!(machine_id_for("  ", "ai.leficrop.desktop.dev"), None);
    }

    #[test]
    fn the_machine_id_is_a_hash_shared_with_lefi_crop_helper() {
        assert_eq!(
            machine_id_from("TEST-ONLY-UUID").as_deref(),
            Some(sha256_hex(b"LEFIMACHINE1|TEST-ONLY-UUID").as_str())
        );
        assert_eq!(machine_id_from("  "), None);
        let real = machine_id().expect("this computer has an id");
        assert_eq!(real.len(), 64);
        assert_eq!(machine_id(), Some(real), "stable");
    }

    #[test]
    fn an_offer_stays_until_used_and_old_pairings_still_load() {
        let dir = std::env::temp_dir().join(format!("lefi-offer2-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join(OFFER_FILE),
            r#"{"url":"https://lefi-main.local:8443","code":"ABCD-EFGH-JKMN","gateway_ca_fingerprint":null,"alternates":["https://192.0.2.10:8443"]}"#,
        )
        .unwrap();
        let (o, age) = read_offer(&dir).unwrap();
        assert!(age < OFFER_TTL_S);
        assert_eq!(o.alternates, ["https://192.0.2.10:8443"]);
        assert!(read_offer(&dir).is_some(), "reading does not use it up");
        drop_offer(&dir);
        assert!(read_offer(&dir).is_none());
        // pairing.json written by Lefi Desktop 0.3.x has no alternates.
        let old = r#"{"url":"u","device_id":"d","cert_pem":"c","ca_pem":"a","gateway_ca_pem":"g","expires_at":"e","paired_at_unix":1,"gateway_ca_fingerprint":"f"}"#;
        let p: Pairing = serde_json::from_str(old).unwrap();
        assert!(p.alternates.is_empty());
        write_status(&dir, "retrying", "not answering", Some("https://x:1"));
        assert_eq!(read_status(&dir).unwrap().state, "retrying");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn every_address_is_tried_when_none_answers() {
        struct Never;
        impl KeyVault for Never {
            fn get(&self) -> AppResult<Option<String>> {
                Ok(None)
            }
            fn set(&self, _: &str) -> AppResult<()> {
                panic!("nothing may be stored")
            }
            fn del(&self) -> AppResult<()> {
                Ok(())
            }
        }
        // Closed loopback ports: nothing answers, nothing on this PC is touched.
        let urls = [
            "https://127.0.0.1:1".to_string(),
            "https://127.0.0.1:2".to_string(),
        ];
        let e = pair_any(&urls, "ABCD-EFGH-JKMN", "x", &Never, false)
            .await
            .unwrap_err();
        match e {
            AppError::Unreachable(m) => assert!(m.contains("127.0.0.1:2"), "{m}"),
            other => panic!("{other}"),
        }
    }
}
