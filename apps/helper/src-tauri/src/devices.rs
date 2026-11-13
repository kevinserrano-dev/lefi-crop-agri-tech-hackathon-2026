//! Lefi Desktop devices, from Lefi Crop Helper (ADR-048): the LEFI root signs Lefi Brain's issuing CA,
//! pairing codes, the list of paired PCs and revocation (behind the administrator's password,
//! ADR-043), and automatic pairing of the Lefi Desktop installed on this PC.
//!
//! Everything goes through Lefi Brain's own CLI on this PC (`python -m lefi_brain …`), like user
//! management (ADR-025): the Brain decides; this file only carries its answers.

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::State;

use crate::activation::Activation;
use crate::console::{require_admin, AdminAuth, Paths};
use crate::error::{Result, SetupError};

/// Where the Lefi Desktop of this PC looks for a pairing offer (its Tauri data folder).
pub const DESKTOP_IDENTIFIER: &str = "ai.leficrop.desktop";
const OFFER_FILE: &str = "pairing-offer.json";
const DESKTOP_KEY_FILE: &str = "device-key.pem";

fn brain_python(p: &Paths) -> Result<PathBuf> {
    [
        p.state.join("runtime/brain/current/venv/bin/python"),
        p.state.join("runtime/brain-venv/bin/python"),
    ]
    .into_iter()
    .find(|x| x.is_file())
    .ok_or_else(|| {
        SetupError::new(
            "NO_BRAIN",
            "Lefi Brain is not installed on this PC, so there is nothing to pair with.",
        )
    })
}

/// Runs `python -m lefi_brain <args>` on this installation; returns (success, stdout).
fn brain_cli(p: &Paths, args: &[&str]) -> Result<(bool, String)> {
    let out = Command::new(brain_python(p)?)
        .args(["-m", "lefi_brain"])
        .args(args)
        .env("LEFI_ENV_FILE", &p.env)
        .env("LEFI_STATE_DIR", &p.state)
        .output()
        .map_err(|e| SetupError::new("BRAIN_CLI", e.to_string()))?;
    Ok((
        out.status.success(),
        String::from_utf8_lossy(&out.stdout).into_owned(),
    ))
}

fn brain_json(p: &Paths, args: &[&str]) -> Result<Value> {
    let (ok, stdout) = brain_cli(p, args)?;
    let v: Value = serde_json::from_str(stdout.trim()).unwrap_or(Value::Null);
    if !ok {
        let msg = v["error"]
            .as_str()
            .unwrap_or("Lefi Brain refused the request.")
            .to_string();
        return Err(SetupError::new("BRAIN_REFUSED", msg));
    }
    Ok(v)
}

/// The issuing CA signed by the LEFI root (two levels, ADR-026). The installer makes a self-signed
/// one so pairing works at once; this replaces its certificate (same key: paired PCs stay valid).
pub fn ensure_two_level(p: &Paths, data_dir: &Path) -> Result<Value> {
    let status = brain_json(p, &["ca", "status", "--json"]).unwrap_or(Value::Null);
    if status["ready"] == true && status["two_level"] == true {
        return Ok(status);
    }
    let (ok, csr) = brain_cli(p, &["ca", "request"])?;
    if !ok || !csr.contains("CERTIFICATE REQUEST") {
        return Err(SetupError::new(
            "CA_REQUEST",
            "Lefi Brain could not prepare its certificate authority.",
        ));
    }
    let root = lefi_helperd::ca::RootCa::load(data_dir)
        .map_err(|e| SetupError::new("NOT_ACTIVATED", e.to_string()))?;
    let cert = root
        .sign_brain_issuing_csr(&csr)
        .map_err(|e| SetupError::new("CA_SIGN", e.to_string()))?;
    let dir = p.state.join("ca");
    let cert_path = dir.join("issuing.from-helper.crt");
    let root_path = dir.join("root.from-helper.crt");
    std::fs::write(&cert_path, cert).map_err(|e| SetupError::new("CA_WRITE", e.to_string()))?;
    std::fs::write(&root_path, &root.cert_pem)
        .map_err(|e| SetupError::new("CA_WRITE", e.to_string()))?;
    let installed = brain_json(
        p,
        &[
            "ca",
            "install",
            "--json",
            "--cert",
            &cert_path.to_string_lossy(),
            "--root",
            &root_path.to_string_lossy(),
        ],
    );
    let _ = std::fs::remove_file(&cert_path);
    let _ = std::fs::remove_file(&root_path);
    installed
}

/// The address a Lefi Desktop should use: the main PC's Lefi name on the gateway's port.
fn gateway_url(p: &Paths) -> Option<String> {
    let url = p.env_get("LEFI_ADMIN_URL")?;
    let rest = url.strip_prefix("https://")?;
    let port = rest
        .split('/')
        .next()?
        .rsplit_once(':')
        .map(|(_, port)| port.to_string())
        .unwrap_or_else(|| "443".into());
    Some(format!(
        "https://{}.local:{port}",
        lefi_helperd::names::MAIN_NAME
    ))
}

fn gateway_ca_fingerprint(p: &Paths) -> Option<String> {
    let path = p.env_get("LEFI_GATEWAY_CA_FILE")?;
    let pem = std::fs::read_to_string(path).ok()?;
    let der = lefi_helperd::ca::der_from_pem(&pem).ok()?;
    Some(lefi_helperd::ca::fingerprint(&der))
}

#[derive(Serialize)]
pub struct PairingCode {
    pub code: String,
    pub expires_at: String,
    pub url: Option<String>,
    /// SHA-256 of Lefi Gateway's CA: Lefi Desktop shows the same after pairing.
    pub gateway_ca_fingerprint: Option<String>,
}

fn new_code(p: &Paths, data_dir: &Path, label: &str) -> Result<PairingCode> {
    if p.env_get("LEFI_DEVICE_CERT_REQUIRED").as_deref() != Some("true") {
        return Err(SetupError::new(
            "PAIRING_OFF",
            "Lefi Gateway is not set up for Lefi Desktop yet. Run \"Change what this PC runs\" with Lefi Gateway over HTTPS.",
        ));
    }
    ensure_two_level(p, data_dir)?;
    let v = brain_json(p, &["pair", "new", "--json", "--label", label])?;
    Ok(PairingCode {
        code: v["code"].as_str().unwrap_or_default().to_string(),
        expires_at: v["expires_at"].as_str().unwrap_or_default().to_string(),
        url: gateway_url(p),
        gateway_ca_fingerprint: gateway_ca_fingerprint(p),
    })
}

/// A one-time code (10 minutes) to pair a Lefi Desktop on another PC. Creating one takes nothing
/// away, so it does not ask for the password; revoking does.
#[tauri::command]
pub fn create_pairing_code(activation: State<'_, Activation>) -> Result<PairingCode> {
    new_code(&Paths::locate()?, activation.data_dir(), "Lefi Crop Helper")
}

/// Paired Lefi Desktop PCs and whether pairing is set up on this PC.
#[tauri::command]
pub fn paired_devices() -> Result<Value> {
    let p = Paths::locate()?;
    if !p.has_role("core") {
        return Ok(json!({ "available": false, "devices": [] }));
    }
    let ca = brain_json(&p, &["ca", "status", "--json"]).unwrap_or(Value::Null);
    let devices = brain_json(&p, &["pair", "list", "--json"])?;
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let local = home.as_deref().map(desktop_data_dir);
    let status = local
        .as_deref()
        .and_then(|d| std::fs::read_to_string(d.join("pairing-status.json")).ok())
        .and_then(|t| serde_json::from_str::<Value>(&t).ok());
    Ok(json!({
        "available": true,
        "local_installed": home.as_deref().is_some_and(desktop_installed),
        "local_machine_id": lefi_helperd::machine::machine_id(),
        "local_status": status,
        "offer_waiting": local.as_deref().is_some_and(|d| d.join(OFFER_FILE).is_file()),
        "local_device_id": local.as_deref().and_then(local_desktop_device),
        "local_paired": local.as_deref().is_some_and(local_desktop_paired),
        "gateway_requires_device": p.env_get("LEFI_DEVICE_CERT_REQUIRED").as_deref() == Some("true"),
        "ca": ca,
        "devices": devices,
    }))
}

/// Revokes one Lefi Desktop PC: refused at its next request. Needs the administrator (ADR-043).
#[tauri::command]
pub async fn revoke_device(device_id: String, auth: Option<AdminAuth>) -> Result<Value> {
    require_admin(auth.as_ref()).await?;
    if !device_id.chars().all(|c| c.is_ascii_hexdigit() || c == '-') {
        return Err(SetupError::new("BAD_ID", "That is not a device id."));
    }
    let p = Paths::locate()?;
    brain_json(
        &p,
        &[
            "pair",
            "revoke",
            &device_id,
            "--json",
            "--reason",
            "removed in Lefi Crop Helper",
        ],
    )
}

/// The Lefi Desktop installed on this PC pairs by itself: a code and the gateway CA's fingerprint
/// go into its data folder (mode 600); it uses them once on its next start and deletes the file.
pub fn desktop_installed(home: &Path) -> bool {
    [
        PathBuf::from("/Applications/Lefi Crop.app"),
        home.join("Applications/Lefi Crop.app"),
    ]
    .iter()
    .any(|a| a.join("Contents").is_dir())
}

pub fn offer_to_local_desktop(p: &Paths, data_dir: &Path, home: &Path) -> Result<Option<PathBuf>> {
    if !desktop_installed(home) {
        return Ok(None);
    }
    let dir = desktop_data_dir(home);
    if local_desktop_paired(&dir) {
        return Ok(None); // already paired
    }
    let code = new_code(p, data_dir, "Lefi Desktop on this PC")?;
    let Some(url) = code.url.clone() else {
        return Ok(None);
    };
    std::fs::create_dir_all(&dir).map_err(|e| SetupError::new("OFFER_WRITE", e.to_string()))?;
    let path = dir.join(OFFER_FILE);
    // Also the gateway's address and loopback: used when lefi-main.local does not resolve (ADR-055).
    let port = url
        .rsplit_once(':')
        .and_then(|(_, p)| p.parse().ok())
        .unwrap_or(8443);
    let env = std::fs::read_to_string(&p.env).unwrap_or_default();
    let caddy = std::fs::read_to_string(p.state.join("caddy/Caddyfile")).unwrap_or_default();
    let alternates = lefi_helperd::main_node::local_alternates(&env, &caddy, port);
    let body = json!({
        "url": url,
        "code": code.code,
        "gateway_ca_fingerprint": code.gateway_ca_fingerprint,
        "expires_at": code.expires_at,
        "alternates": alternates,
    });
    crate::activation::private_file(&path, body.to_string().as_bytes())?;
    Ok(Some(path))
}

/// Paired = its pairing and its private key are both there. A `pairing.json` without
/// `device-key.pem` is one Lefi Desktop 0.3.1 or older kept in the keychain, which an update cannot
/// read: Lefi Desktop drops it and pairs again, so it gets an offer (ADR-053).
pub fn local_desktop_paired(dir: &Path) -> bool {
    dir.join("pairing.json").is_file() && dir.join(DESKTOP_KEY_FILE).is_file()
}

/// The device id of this PC's Lefi Desktop pairing, if any (to mark it in the list).
pub fn local_desktop_device(dir: &Path) -> Option<String> {
    let text = std::fs::read_to_string(dir.join("pairing.json")).ok()?;
    let v: Value = serde_json::from_str(&text).ok()?;
    v["device_id"].as_str().map(str::to_string)
}

pub fn desktop_data_dir(home: &Path) -> PathBuf {
    if cfg!(target_os = "macos") {
        home.join("Library/Application Support")
            .join(DESKTOP_IDENTIFIER)
    } else {
        home.join(".local/share").join(DESKTOP_IDENTIFIER)
    }
}

/// "Reset pairing on this PC": revokes the pairing this PC's Lefi Desktop holds (if Lefi Brain still
/// has it active), removes its pairing files and leaves a fresh offer, so it pairs again by itself
/// within seconds — also when its old pairing was revoked or its key could not be read. Takes a
/// pairing away, so it asks for the administrator (ADR-043).
#[tauri::command]
pub async fn reset_local_pairing(
    activation: State<'_, Activation>,
    auth: Option<AdminAuth>,
) -> Result<Value> {
    let p = Paths::locate()?;
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| SetupError::new("NO_HOME", "HOME is not set."))?;
    let dir = desktop_data_dir(&home);
    let mut revoked = None;
    if let Some(id) = local_desktop_device(&dir) {
        if id.chars().all(|c| c.is_ascii_hexdigit() || c == '-') {
            let active = brain_json(&p, &["pair", "list", "--json"])
                .ok()
                .and_then(|v| {
                    v.as_array().map(|a| {
                        a.iter()
                            .any(|d| d["id"] == id.as_str() && d["status"] == "active")
                    })
                })
                .unwrap_or(false);
            if active {
                // Only taking an active pairing away asks for the administrator (ADR-043); a
                // broken or revoked one is just replaced.
                require_admin(auth.as_ref()).await?;
                brain_json(
                    &p,
                    &[
                        "pair",
                        "revoke",
                        &id,
                        "--json",
                        "--reason",
                        "pairing reset in Lefi Crop Helper",
                    ],
                )?;
                revoked = Some(id);
            }
        }
    }
    for f in [
        "pairing.json",
        DESKTOP_KEY_FILE,
        OFFER_FILE,
        "pairing-status.json",
    ] {
        match std::fs::remove_file(dir.join(f)) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(SetupError::new("RESET", format!("{f}: {e}"))),
        }
    }
    let offered = offer_to_local_desktop(&p, activation.data_dir(), &home)?;
    Ok(json!({ "revoked": revoked, "offered": offered.is_some() }))
}

/// "Pair the Lefi Desktop of this PC" in Apps, and the end of setup.
#[tauri::command]
pub fn pair_local_desktop(activation: State<'_, Activation>) -> Result<Value> {
    let p = Paths::locate()?;
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| SetupError::new("NO_HOME", "HOME is not set."))?;
    let offered = offer_to_local_desktop(&p, activation.data_dir(), &home)?;
    Ok(json!({ "offered": offered.is_some() }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paths(dir: &Path, env: &str) -> Paths {
        std::fs::create_dir_all(dir).unwrap();
        let env_path = dir.join("lefi.env");
        std::fs::write(&env_path, env).unwrap();
        Paths {
            state: dir.join("state"),
            env: env_path,
        }
    }

    /// The real Brain CLI of this checkout on a temporary state (no installed Brain is touched):
    /// the LEFI root (a throwaway test root) signs the issuing CA, and Lefi Brain accepts it.
    #[test]
    fn the_root_signs_the_issuing_ca_and_lefi_brain_accepts_it() {
        let venv = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../services/brain/.venv");
        if !venv.join("bin/python").is_file() {
            eprintln!("skipped: no services/brain/.venv (run `uv sync` there)");
            return;
        }
        let d = std::env::temp_dir().join(format!("lefi-dev-test4-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        let p = paths(&d, "");
        std::fs::create_dir_all(p.state.join("runtime")).unwrap();
        std::os::unix::fs::symlink(
            venv.canonicalize().unwrap(),
            p.state.join("runtime/brain-venv"),
        )
        .unwrap();
        let data = d.join("helper-data");
        std::fs::create_dir_all(data.join("ca")).unwrap();
        let (cert, key) = lefi_helperd::ca::test_root();
        std::fs::write(data.join("ca/root-ca.pem"), &cert).unwrap();
        std::fs::write(data.join("ca/root-ca.key.pem"), key).unwrap();

        let status = ensure_two_level(&p, &data).expect("installed");
        assert_eq!(status["two_level"], true, "{status}");
        let root_der = lefi_helperd::ca::der_from_pem(&cert).unwrap();
        assert_eq!(
            status["root_fingerprint"],
            lefi_helperd::ca::fingerprint(&root_der)
        );
        // Asked again: nothing to do, same certificate.
        let again = ensure_two_level(&p, &data).unwrap();
        assert_eq!(again["fingerprint"], status["fingerprint"]);
        let mode = std::fs::metadata(p.state.join("ca/issuing.key")).unwrap();
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(mode.permissions().mode() & 0o777, 0o600);
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn the_desktop_gets_the_main_pc_name_and_the_gateway_port() {
        let d = std::env::temp_dir().join(format!("lefi-dev-test-{}", std::process::id()));
        let p = paths(&d, "LEFI_ADMIN_URL=https://192.0.2.10:8443\n");
        assert_eq!(
            gateway_url(&p).as_deref(),
            Some("https://lefi-main.local:8443")
        );
        let p = paths(&d, "LEFI_ADMIN_URL=http://192.0.2.10:8080\n");
        assert_eq!(gateway_url(&p), None);
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn no_code_without_device_certificates_on_the_gateway() {
        let d = std::env::temp_dir().join(format!("lefi-dev-test2-{}", std::process::id()));
        let p = paths(
            &d,
            "LEFI_ROLES=core,admin\nLEFI_DEVICE_CERT_REQUIRED=false\n",
        );
        let err = new_code(&p, &d, "x").err().expect("refused");
        assert_eq!(err.code, "PAIRING_OFF");
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn no_offer_without_a_local_lefi_desktop() {
        let d = std::env::temp_dir().join(format!("lefi-dev-test3-{}", std::process::id()));
        let p = paths(&d, "LEFI_DEVICE_CERT_REQUIRED=true\n");
        // A temporary HOME: no Lefi Desktop in ~/Applications. (/Applications may have one on a
        // developer Mac; then the offer stops at "no Brain" instead, still without writing.)
        let r = offer_to_local_desktop(&p, &d, &d.join("home"));
        assert!(matches!(r, Ok(None)) || r.is_err());
        assert!(!desktop_data_dir(&d.join("home")).join(OFFER_FILE).exists());
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn a_pairing_without_its_key_file_counts_as_not_paired() {
        let d = std::env::temp_dir().join(format!("lefi-dev-test4-{}", std::process::id()));
        let dir = desktop_data_dir(&d);
        std::fs::create_dir_all(&dir).unwrap();
        assert!(!local_desktop_paired(&dir));
        std::fs::write(dir.join("pairing.json"), r#"{"device_id":"0f-test"}"#).unwrap();
        // Lefi Desktop 0.3.1 or older: the key was in the keychain, which an update cannot read.
        assert!(!local_desktop_paired(&dir));
        assert_eq!(local_desktop_device(&dir).as_deref(), Some("0f-test"));
        std::fs::write(dir.join(DESKTOP_KEY_FILE), "TEST ONLY").unwrap();
        assert!(local_desktop_paired(&dir));
        let _ = std::fs::remove_dir_all(d);
    }
}
