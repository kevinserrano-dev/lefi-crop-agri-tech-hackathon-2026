//! Activation before installing (ADR-027, INSTALLER.md §9.5, ADR-031).
//!
//! On first start the main PC creates the LEFI root CA; the installation id is derived from its
//! certificate. Lefi staff sign an activation code for that id with `lefi-license`; this module
//! verifies it offline against the public keys compiled in. Nothing is installed before that.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use lefi_license::{installation_id, key_id, parse_public_key, verify, Licence};
use serde::Serialize;

use crate::error::{Result, SetupError};

const PRODUCTION_PUB: &str = include_str!("../keys/production.pub");
const DEV_PUB: &str = include_str!("../../../../tools/lefi-license/dev-key/dev-signing.pub");
/// The hackathon build activates itself with the public development key (see `activate_for_hackathon`).
#[cfg(feature = "hackathon")]
const DEV_SEED: &str = include_str!("../../../../tools/lefi-license/dev-key/dev-signing.seed");

/// Built with `--features hackathon`: a packaged build for the competition's judges that activates
/// without a code from Lefi Crop. Normal release builds keep strict activation.
pub const HACKATHON_BUILD: bool = cfg!(feature = "hackathon");
/// Debug and hackathon builds also trust the public development key.
const TRUST_DEV_KEY: bool = cfg!(debug_assertions) || HACKATHON_BUILD;

/// Root CA validity. Rotation and lifetimes are still open (OD-7); 10 years keeps an installed
/// greenhouse from failing on a date while that policy is decided.
const ROOT_CA_YEARS: i64 = 10;

fn err(code: &'static str, e: impl std::fmt::Display) -> SetupError {
    SetupError::new(code, e.to_string())
}

/// Keys this build trusts: the production key (when one is embedded) and, in debug and hackathon
/// builds only, the development key from `tools/lefi-license/dev-key`.
pub fn trusted_keys() -> Vec<lefi_license::VerifyingKey> {
    let mut keys = Vec::new();
    if let Ok(k) = parse_public_key(PRODUCTION_PUB) {
        keys.push(k);
    }
    if TRUST_DEV_KEY {
        if let Ok(k) = parse_public_key(DEV_PUB) {
            keys.push(k);
        }
    }
    keys
}

pub fn production_key_embedded() -> bool {
    parse_public_key(PRODUCTION_PUB).is_ok()
}

fn dev_key_id() -> Option<String> {
    parse_public_key(DEV_PUB).ok().map(|k| key_id(&k))
}

#[derive(Debug, Clone, Serialize)]
pub struct ActivationStatus {
    pub installation_id: String,
    pub licence: Option<Licence>,
    /// The stored licence was signed with the development key (debug builds only).
    pub development_licence: bool,
    pub production_key_embedded: bool,
    /// A stored code that no longer verifies (e.g. a different build's key).
    pub stored_code_problem: Option<String>,
    /// Development builds may continue without a code, under a visible notice.
    pub dev_skipped: bool,
    pub data_dir: String,
}

impl ActivationStatus {
    pub fn activated(&self) -> bool {
        self.licence.is_some()
    }
}

pub struct Activation {
    dir: PathBuf,
    dev_skipped: AtomicBool,
}

pub(crate) fn private_file(path: &Path, content: &[u8]) -> Result<()> {
    let tmp = path.with_extension("tmp");
    let _ = fs::remove_file(&tmp);
    let mut opts = fs::OpenOptions::new();
    opts.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let mut f = opts.open(&tmp).map_err(|e| err("DATA_WRITE", e))?;
    f.write_all(content).map_err(|e| err("DATA_WRITE", e))?;
    f.sync_all().map_err(|e| err("DATA_WRITE", e))?;
    fs::rename(&tmp, path).map_err(|e| err("DATA_WRITE", e))
}

fn pem_to_der(pem: &str) -> Option<Vec<u8>> {
    use base64_engine::decode;
    let body: String = pem.lines().filter(|l| !l.starts_with("-----")).collect();
    decode(&body)
}

mod base64_engine {
    /// Minimal standard-alphabet base64 decoder for the PEM we wrote ourselves.
    pub fn decode(s: &str) -> Option<Vec<u8>> {
        let mut out = Vec::with_capacity(s.len() * 3 / 4);
        let (mut buf, mut bits) = (0u32, 0u32);
        for c in s.bytes() {
            let v = match c {
                b'A'..=b'Z' => c - b'A',
                b'a'..=b'z' => c - b'a' + 26,
                b'0'..=b'9' => c - b'0' + 52,
                b'+' => 62,
                b'/' => 63,
                b'=' => break,
                b'\r' | b'\n' | b' ' => continue,
                _ => return None,
            };
            buf = (buf << 6) | u32::from(v);
            bits += 6;
            if bits >= 8 {
                bits -= 8;
                out.push((buf >> bits) as u8);
            }
        }
        Some(out)
    }
}

impl Activation {
    pub fn new(dir: PathBuf) -> Self {
        Self {
            dir,
            dev_skipped: AtomicBool::new(false),
        }
    }

    fn ca_dir(&self) -> PathBuf {
        self.dir.join("ca")
    }

    /// The app's data folder (the LEFI root CA lives in `ca/` there).
    pub fn data_dir(&self) -> &Path {
        &self.dir
    }
    fn code_path(&self) -> PathBuf {
        self.dir.join("licence.code")
    }

    /// The LEFI root CA certificate (DER), created on first use. The private key never leaves
    /// this PC (mode 600, directory 700).
    pub fn root_ca_der(&self) -> Result<Vec<u8>> {
        let cert_path = self.ca_dir().join("root-ca.pem");
        if let Ok(pem) = fs::read_to_string(&cert_path) {
            return pem_to_der(&pem).filter(|d| !d.is_empty()).ok_or_else(|| {
                SetupError::new(
                    "CA_CORRUPT",
                    format!("{} is not a certificate", cert_path.display()),
                )
            });
        }
        fs::create_dir_all(self.ca_dir()).map_err(|e| err("DATA_WRITE", e))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            for d in [&self.dir, &self.ca_dir()] {
                fs::set_permissions(d, fs::Permissions::from_mode(0o700))
                    .map_err(|e| err("DATA_WRITE", e))?;
            }
        }
        let key = rcgen::KeyPair::generate().map_err(|e| err("CA_CREATE", e))?;
        let mut params = rcgen::CertificateParams::default();
        params
            .distinguished_name
            .push(rcgen::DnType::CommonName, "LEFI CROP root CA");
        params
            .distinguished_name
            .push(rcgen::DnType::OrganizationName, "Lefi Crop installation");
        params.is_ca = rcgen::IsCa::Ca(rcgen::BasicConstraints::Unconstrained);
        params.key_usages = vec![
            rcgen::KeyUsagePurpose::KeyCertSign,
            rcgen::KeyUsagePurpose::CrlSign,
        ];
        let now = time::OffsetDateTime::now_utc();
        params.not_before = now - time::Duration::days(1);
        params.not_after = now + time::Duration::days(365 * ROOT_CA_YEARS);
        let cert = params.self_signed(&key).map_err(|e| err("CA_CREATE", e))?;
        private_file(
            &self.ca_dir().join("root-ca.key.pem"),
            key.serialize_pem().as_bytes(),
        )?;
        // Written last: its presence means the CA is complete.
        fs::write(&cert_path, cert.pem()).map_err(|e| err("DATA_WRITE", e))?;
        Ok(cert.der().to_vec())
    }

    pub fn installation_id(&self) -> Result<String> {
        Ok(installation_id(&self.root_ca_der()?))
    }

    pub fn status(&self) -> Result<ActivationStatus> {
        let id = self.installation_id()?;
        let (mut licence, mut problem) = (None, None);
        if let Ok(code) = fs::read_to_string(self.code_path()) {
            match verify(&code, &trusted_keys(), &id) {
                Ok(l) => licence = Some(l),
                Err(e) => problem = Some(e.to_string()),
            }
        }
        let development_licence = licence
            .as_ref()
            .is_some_and(|l| Some(&l.key_id) == dev_key_id().as_ref());
        Ok(ActivationStatus {
            installation_id: id,
            licence,
            development_licence,
            production_key_embedded: production_key_embedded(),
            stored_code_problem: problem,
            dev_skipped: self.dev_skipped.load(Ordering::SeqCst),
            data_dir: self.dir.display().to_string(),
        })
    }

    /// Verifies `code` for this installation and stores it. Invalid codes are never stored.
    pub fn activate(&self, code: &str) -> Result<ActivationStatus> {
        let id = self.installation_id()?;
        let licence = verify(code, &trusted_keys(), &id)
            .map_err(|e| SetupError::new(e.code(), e.to_string()))?;
        let clean: String = code.chars().filter(|c| !c.is_whitespace()).collect();
        private_file(&self.code_path(), clean.as_bytes())?;
        let event = serde_json::json!({
            "event": "setup.activated",
            "licence_id": licence.licence_id,
            "installation_id": id,
            "key_id": licence.key_id,
            "at": time::OffsetDateTime::now_utc().unix_timestamp(),
        });
        if let Ok(mut f) = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(self.dir.join("events.ndjson"))
        {
            let _ = writeln!(f, "{event}");
        }
        self.status()
    }

    /// Development builds only: continue without a code for this session.
    #[cfg_attr(feature = "hackathon", allow(dead_code))]
    pub fn skip_for_development(&self) -> Result<ActivationStatus> {
        if !cfg!(debug_assertions) {
            return Err(SetupError::new(
                "ACTIVATION_REQUIRED",
                "Activation cannot be skipped in this build.",
            ));
        }
        self.dev_skipped.store(true, Ordering::SeqCst);
        self.status()
    }

    /// Hackathon build only: activates this installation with a licence for 10 PCs signed by the
    /// public development key, stored like any other code, so the main PC's service runs too.
    #[cfg(feature = "hackathon")]
    pub fn activate_for_hackathon(&self) -> Result<ActivationStatus> {
        use lefi_license::issue::{parse_signing_key, random_licence_id, sign, today_utc};
        let key = parse_signing_key(DEV_SEED).map_err(|e| err("ACTIVATION_FAILED", e))?;
        let licence = Licence {
            v: 1,
            licence_id: random_licence_id().map_err(|e| err("ACTIVATION_FAILED", e))?,
            customer: "Hackathon evaluation".into(),
            installation_id: self.installation_id()?,
            max_pcs: 10,
            edition: "hackathon".into(),
            issued_at: today_utc(),
            support_until: "2027-12-31".into(),
            key_id: String::new(),
        };
        self.activate(&sign(licence, &key))
    }

    /// The "continue without a code" button: a real activation in the hackathon build, this
    /// session only in debug builds.
    pub fn continue_without_code(&self) -> Result<ActivationStatus> {
        #[cfg(feature = "hackathon")]
        {
            self.activate_for_hackathon()
        }
        #[cfg(not(feature = "hackathon"))]
        {
            self.skip_for_development()
        }
    }

    /// May the installer run? Release: only with a valid licence. Debug: licence or skip.
    pub fn install_allowed(&self) -> Result<bool> {
        let s = self.status()?;
        Ok(s.activated() || (cfg!(debug_assertions) && s.dev_skipped))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "lefi-helper-test-{name}-{}-{nanos}",
            std::process::id()
        ))
    }

    #[test]
    fn root_ca_is_created_once_and_private() {
        let dir = temp_dir("ca");
        let a = Activation::new(dir.clone());
        let id1 = a.installation_id().unwrap();
        let id2 = Activation::new(dir.clone()).installation_id().unwrap();
        assert_eq!(id1, id2, "the id must survive a restart");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(dir.join("ca/root-ca.key.pem"))
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o600);
        }
        assert_ne!(
            id1,
            Activation::new(temp_dir("ca2")).installation_id().unwrap()
        );
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn development_code_activates_only_its_installation() {
        let seed = include_str!("../../../../tools/lefi-license/dev-key/dev-signing.seed");
        let key = lefi_license::issue::parse_signing_key(seed).unwrap();
        let code_for = |installation: &str| {
            lefi_license::issue::sign(
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
                },
                &key,
            )
        };
        let a = Activation::new(temp_dir("act"));
        let id = a.installation_id().unwrap();
        assert!(!a.install_allowed().unwrap());

        let other = code_for("ZZZZ-ZZZZ-ZZZZ-ZZZZ");
        assert_eq!(
            a.activate(&other).unwrap_err().code,
            "CODE_WRONG_INSTALLATION"
        );
        assert!(
            a.status().unwrap().licence.is_none(),
            "a rejected code is never stored"
        );

        let good = code_for(&id);
        let s = a.activate(&good).unwrap();
        assert!(s.activated());
        assert!(s.development_licence);
        assert!(a.install_allowed().unwrap());
        assert!(
            Activation::new(PathBuf::from(&s.data_dir))
                .status()
                .unwrap()
                .activated(),
            "stored across restarts"
        );
        let _ = fs::remove_dir_all(&s.data_dir);
    }

    #[test]
    fn skipping_is_a_development_only_session_flag() {
        let a = Activation::new(temp_dir("skip"));
        let s = a.skip_for_development().unwrap();
        assert!(s.dev_skipped && !s.activated());
        assert!(a.install_allowed().unwrap());
        assert!(
            !Activation::new(PathBuf::from(&s.data_dir))
                .install_allowed()
                .unwrap(),
            "not persisted"
        );
        let _ = fs::remove_dir_all(&s.data_dir);
    }

    #[cfg(feature = "hackathon")]
    #[test]
    fn the_hackathon_build_activates_itself_with_a_stored_licence() {
        let a = Activation::new(temp_dir("hackathon"));
        let s = a.continue_without_code().unwrap();
        assert!(s.activated());
        assert!(a.install_allowed().unwrap());
        assert!(a.data_dir().join("licence.code").exists());
    }
}
