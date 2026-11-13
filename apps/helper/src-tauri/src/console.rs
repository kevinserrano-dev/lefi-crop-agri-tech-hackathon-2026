//! After setup (ADR-043): the first credentials, shown until the person confirms they saved them;
//! the administrator check that protects everything that takes something away; the status of this
//! PC's services. The Brain decides who the administrator is; this file never stores a password.

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::ipc::Channel;
use tauri::State;

use crate::activation::Activation;
use crate::error::{Result, SetupError};
use crate::installer::{self, InstallerMsg, Layout, RunResult, Runner};
use crate::session::Sessions;

/// Typed by a person for one action, never kept or logged.
#[derive(Deserialize)]
pub struct AdminAuth {
    pub username: String,
    pub password: String,
}

pub struct Paths {
    pub state: PathBuf,
    pub env: PathBuf,
}

const FINISHED_FILE: &str = "setup-finished.json";

impl Paths {
    pub fn locate() -> Result<Self> {
        let state = std::env::var_os("LEFI_STATE_DIR")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".lefi-crop")))
            .ok_or_else(|| SetupError::new("NO_HOME", "HOME is not set."))?;
        let root = Layout::locate()?.root;
        // Same rule as scripts/lib/common.sh (ADR-034).
        let packaged = root.ends_with("Contents/Resources/payload");
        let env = if packaged {
            state.join("lefi.env")
        } else {
            root.join(".env")
        };
        Ok(Self { state, env })
    }

    pub fn finished_for(&self, data_dir: &str) -> bool {
        Path::new(data_dir).join(FINISHED_FILE).exists()
    }

    pub(crate) fn env_get(&self, key: &str) -> Option<String> {
        env_value(&std::fs::read_to_string(&self.env).ok()?, key)
    }

    pub(crate) fn has_role(&self, role: &str) -> bool {
        self.env_get("LEFI_ROLES")
            .is_some_and(|r| r.split(',').any(|x| x.trim() == role))
    }

    fn brain_url(&self) -> String {
        let port = self
            .env_get("LEFI_API_PORT")
            .filter(|p| !p.is_empty())
            .unwrap_or_else(|| "8000".into());
        format!("http://127.0.0.1:{port}")
    }

    fn admin_username(&self) -> String {
        self.env_get("LEFI_BOOTSTRAP_ADMIN_USERNAME")
            .filter(|u| !u.is_empty())
            .unwrap_or_else(|| "admin".into())
    }
}

fn env_value(text: &str, key: &str) -> Option<String> {
    let prefix = format!("{key}=");
    text.lines()
        .filter_map(|l| l.strip_prefix(&prefix))
        .next_back()
        .map(str::to_string)
}

fn http() -> Result<reqwest::Client> {
    reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(5))
        .build()
        .map_err(|e| SetupError::new("HTTP", e.to_string()))
}

fn wrong_password() -> SetupError {
    SetupError::new(
        "ADMIN_PASSWORD_WRONG",
        "That user name or password is not correct.",
    )
}

/// The password is checked by the Brain's own login, with its lockout and audit. A session is
/// opened only to do that, and closed at once.
async fn admin_session(p: &Paths, auth: &AdminAuth) -> Result<Option<String>> {
    let c = http()?;
    let url = p.brain_url();
    let resp = c
        .post(format!("{url}/api/v1/auth/login"))
        .json(&json!({
            "username": auth.username, "password": auth.password, "token_transport": "bearer",
        }))
        .send()
        .await;
    let Ok(resp) = resp else {
        return Ok(None); // the Brain is not answering
    };
    match resp.status().as_u16() {
        200 => {}
        401 => return Err(wrong_password()),
        429 => {
            return Err(SetupError::new(
                "LOGIN_LOCKED",
                "Too many wrong passwords: this account is locked for a few minutes.",
            ))
        }
        s => {
            return Err(SetupError::new(
                "BRAIN_ERROR",
                format!("Lefi Brain could not check the password (HTTP {s})."),
            ))
        }
    }
    let v: Value = resp.json().await.unwrap_or(Value::Null);
    let token = v["token"].as_str().unwrap_or("").to_string();
    if v["role"]["id"] != "admin" {
        let _ = c
            .post(format!("{url}/api/v1/auth/logout"))
            .bearer_auth(&token)
            .send()
            .await;
        return Err(SetupError::new(
            "ADMIN_ONLY",
            "Only an administrator can do this.",
        ));
    }
    Ok(Some(token))
}

/// The Brain's own check when it is stopped: uninstalling must work with a broken Brain.
fn offline_check(p: &Paths, auth: &AdminAuth) -> Result<()> {
    use std::io::Write;
    use std::process::{Command, Stdio};
    let python = [
        p.state.join("runtime/brain/current/venv/bin/python"),
        p.state.join("runtime/brain-venv/bin/python"),
    ]
    .into_iter()
    .find(|x| x.is_file())
    .ok_or_else(|| {
        SetupError::new(
            "BRAIN_DOWN",
            "Lefi Brain is not answering and its program is missing, so the password cannot be checked.",
        )
    })?;
    let mut child = Command::new(python)
        .args([
            "-m",
            "lefi_brain",
            "user",
            "verify",
            &auth.username,
            "--json",
        ])
        .env("LEFI_ENV_FILE", &p.env)
        .env("LEFI_STATE_DIR", &p.state)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| SetupError::new("BRAIN_DOWN", e.to_string()))?;
    if let Some(mut i) = child.stdin.take() {
        let _ = writeln!(i, "{}", auth.password);
    }
    let out = child
        .wait_with_output()
        .map_err(|e| SetupError::new("BRAIN_DOWN", e.to_string()))?;
    let v = parse_verify(&String::from_utf8_lossy(&out.stdout));
    if !out.status.success() || v["ok"] != true {
        return Err(wrong_password());
    }
    if v["role"] != "admin" {
        return Err(SetupError::new(
            "ADMIN_ONLY",
            "Only an administrator can do this.",
        ));
    }
    Ok(())
}

/// `lefi_brain user verify --json` prints one indented object.
fn parse_verify(stdout: &str) -> Value {
    serde_json::from_str(stdout.trim()).unwrap_or(Value::Null)
}

async fn close_session(p: &Paths, token: &str) {
    if let Ok(c) = http() {
        let _ = c
            .post(format!("{}/api/v1/auth/logout", p.brain_url()))
            .bearer_auth(token)
            .send()
            .await;
    }
}

/// True when this PC has an administrator to ask for: it runs the Brain.
fn admin_exists(p: &Paths) -> bool {
    p.has_role("core")
}

async fn check_admin(p: &Paths, auth: Option<&AdminAuth>) -> Result<()> {
    if !admin_exists(p) {
        return Ok(()); // no Brain installed yet: no account exists to ask for
    }
    let auth = auth.ok_or_else(|| {
        SetupError::new("ADMIN_REQUIRED", "This needs the administrator's password.")
    })?;
    match admin_session(p, auth).await? {
        Some(token) => {
            close_session(p, &token).await;
            Ok(())
        }
        None => offline_check(p, auth),
    }
}

pub async fn require_admin(auth: Option<&AdminAuth>) -> Result<()> {
    check_admin(&Paths::locate()?, auth).await
}

#[derive(Serialize)]
pub struct ConsoleState {
    pub finished: bool,
    pub admin_required: bool,
    pub admin_username: String,
    pub has_credentials: bool,
}

#[tauri::command]
pub fn console_state(activation: State<'_, Activation>) -> Result<ConsoleState> {
    let p = Paths::locate()?;
    Ok(ConsoleState {
        finished: p.finished_for(&activation.status()?.data_dir),
        admin_required: admin_exists(&p),
        admin_username: p.admin_username(),
        has_credentials: p.state.join("credentials/admin.txt").is_file(),
    })
}

#[derive(Serialize, Default, Debug, PartialEq)]
pub struct Credentials {
    pub admin: Option<Login>,
    pub devices: Vec<Login>,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct Login {
    pub username: String,
    pub password: String,
}

fn parse_credentials(dir: &Path) -> Credentials {
    let admin = std::fs::read_to_string(dir.join("admin.txt"))
        .ok()
        .and_then(|t| {
            Some(Login {
                username: env_value(&t, "username")?,
                password: env_value(&t, "password")?,
            })
        });
    let devices = std::fs::read_to_string(dir.join("mqtt.env"))
        .unwrap_or_default()
        .lines()
        .filter_map(|l| {
            let (u, v) = l.split_once('=')?;
            Some(Login {
                username: u.to_string(),
                password: v.to_string(),
            })
        })
        .collect();
    Credentials { admin, devices }
}

/// Only until setup is finished: after that it returns nothing, also when setup runs again.
#[tauri::command]
pub fn read_credentials(activation: State<'_, Activation>) -> Result<Credentials> {
    let p = Paths::locate()?;
    if p.finished_for(&activation.status()?.data_dir) {
        return Ok(Credentials::default());
    }
    Ok(parse_credentials(&p.state.join("credentials")))
}

/// The installer's first password disappears from disk. The account stays in the Brain's database.
fn seal_admin(p: &Paths) -> Result<()> {
    let text = std::fs::read_to_string(&p.env)
        .map_err(|e| SetupError::new("CONFIG_UNREADABLE", e.to_string()))?;
    let mut out: Vec<String> = text
        .lines()
        .filter(|l| !l.starts_with("LEFI_ADMIN_SEALED="))
        .map(|l| {
            if l.starts_with("LEFI_BOOTSTRAP_ADMIN_PASSWORD=") {
                "LEFI_BOOTSTRAP_ADMIN_PASSWORD=".to_string()
            } else {
                l.to_string()
            }
        })
        .collect();
    out.push("LEFI_ADMIN_SEALED=1".into());
    std::fs::write(&p.env, out.join("\n") + "\n")
        .map_err(|e| SetupError::new("CONFIG_WRITE", e.to_string()))?;
    let _ = std::fs::remove_file(p.state.join("credentials/admin.txt"));
    Ok(())
}

/// "Finish setup and continue". Refused while the shown password does not open the Brain: sealing
/// then would leave nobody able to sign in.
#[tauri::command]
pub async fn finish_setup(activation: State<'_, Activation>) -> Result<Value> {
    let p = Paths::locate()?;
    let creds = parse_credentials(&p.state.join("credentials"));
    if let Some(admin) = &creds.admin {
        let auth = AdminAuth {
            username: admin.username.clone(),
            password: admin.password.clone(),
        };
        check_admin(&p, Some(&auth)).await.map_err(|e| {
            SetupError::new(
                "ADMIN_NOT_VERIFIED",
                format!(
                    "The administrator account could not be confirmed: {}",
                    e.message
                ),
            )
            .with_hint(
                "Nothing was removed. Check that Lefi Brain runs (Verify step), then try again.",
            )
        })?;
        seal_admin(&p)?;
    }
    let marker = Path::new(&activation.status()?.data_dir).join(FINISHED_FILE);
    std::fs::write(marker, b"{\"finished\":true}\n")
        .map_err(|e| SetupError::new("STATE_WRITE", e.to_string()))?;
    // The Lefi Desktop installed here pairs by itself on its next start (ADR-048). Best effort:
    // Apps → "Pair the Lefi Desktop of this PC" does the same, and says why if it cannot.
    let home = std::env::var_os("HOME").map(std::path::PathBuf::from);
    let desktop_paired = match home {
        Some(h) => crate::devices::offer_to_local_desktop(&p, activation.data_dir(), &h)
            .map(|o| o.is_some())
            .unwrap_or(false),
        None => false,
    };
    Ok(json!({ "ok": true, "desktop_pairing_offered": desktop_paired }))
}

#[tauri::command]
pub async fn change_admin_password(auth: AdminAuth, new_password: String) -> Result<Value> {
    let p = Paths::locate()?;
    let token = admin_session(&p, &auth).await?.ok_or_else(|| {
        SetupError::new(
            "BRAIN_DOWN",
            "Lefi Brain is not answering, so the password cannot be changed now.",
        )
    })?;
    let resp = http()?
        .post(format!("{}/api/v1/auth/password", p.brain_url()))
        .bearer_auth(&token)
        .json(&json!({ "current_password": auth.password, "new_password": new_password }))
        .send()
        .await
        .map_err(|e| SetupError::new("BRAIN_DOWN", e.to_string()))?;
    let ok = resp.status().is_success();
    let v: Value = resp.json().await.unwrap_or(Value::Null);
    close_session(&p, &token).await;
    if ok {
        return Ok(json!({ "ok": true }));
    }
    let msg = v["error"]["message"]
        .as_str()
        .unwrap_or("Lefi Brain refused the new password.")
        .to_string();
    Err(SetupError::new("PASSWORD_REFUSED", msg))
}

async fn port_open(port: u16) -> bool {
    tokio::time::timeout(
        Duration::from_secs(2),
        tokio::net::TcpStream::connect(("127.0.0.1", port)),
    )
    .await
    .is_ok_and(|r| r.is_ok())
}

fn port_of(url: &str) -> Option<u16> {
    url.rsplit(':').next()?.trim_end_matches('/').parse().ok()
}

/// What runs on this PC, measured now.
#[tauri::command]
pub async fn system_status() -> Result<Value> {
    let p = Paths::locate()?;
    let c = http()?;
    let mut items: Vec<Value> = vec![];
    if p.has_role("core") {
        let health: Option<Value> = match c
            .get(format!("{}/api/v1/health", p.brain_url()))
            .send()
            .await
        {
            Ok(r) => r.json().await.ok(),
            Err(_) => None,
        };
        let up = health
            .as_ref()
            .is_some_and(|h| h["service"] == "lefi-brain");
        items.push(json!({
            "id": "brain", "title": "Lefi Brain", "state": if up { "running" } else { "down" },
            "version": health.as_ref().and_then(|h| h["version"].as_str()),
            "detail": p.brain_url(),
        }));
        let port = p
            .env_get("LEFI_MQTT_PORT")
            .and_then(|v| v.parse().ok())
            .unwrap_or(1883);
        items.push(json!({
            "id": "mqtt", "title": "MQTT broker (Mosquitto)",
            "state": if port_open(port).await { "running" } else { "down" },
            "detail": format!("port {port}"),
        }));
        let ai_url = p.env_get("OLLAMA_BASE_URL").filter(|u| !u.is_empty());
        let mut ai = json!({ "id": "ai", "title": "AI used by Lefi Brain", "state": "down" });
        if let Some(u) = &ai_url {
            ai["detail"] = json!(u);
            ai["model"] = json!(p.env_get("OLLAMA_MODEL"));
            if let Ok(r) = c.get(format!("{u}/api/version")).send().await {
                if let Ok(v) = r.json::<Value>().await {
                    ai["state"] = json!("running");
                    ai["version"] = v["version"].clone();
                }
            }
            if let Ok(r) = c.get(format!("{u}/api/ps")).send().await {
                if let Ok(v) = r.json::<Value>().await {
                    ai["loaded"] = v["models"]
                        .as_array()
                        .map(|a| {
                            json!(a
                                .iter()
                                .map(|m| {
                                    let size = m["size"].as_f64().unwrap_or(0.0);
                                    json!({
                                        "name": m["name"],
                                        "gpu_pct": lefi_helperd::report::gpu_pct(
                                            size,
                                            m["size_vram"].as_f64().unwrap_or(0.0)
                                        ),
                                    })
                                })
                                .collect::<Vec<_>>())
                        })
                        .unwrap_or(json!([]));
                }
            }
        }
        items.push(ai);
    }
    if p.has_role("admin") {
        let url = p.env_get("LEFI_ADMIN_URL").unwrap_or_default();
        let open = match port_of(&url) {
            Some(port) => port_open(port).await,
            None => false,
        };
        items.push(json!({
            "id": "gateway", "title": "Lefi Gateway",
            "state": if open { "running" } else { "down" }, "detail": url,
        }));
    }
    let pc = lefi_helperd::report::pc_facts();
    let metrics = lefi_helperd::report::metrics();
    Ok(json!({
        "name": lefi_helperd::names::MAIN_NAME,
        "hostname": lefi_helperd::satellite::hostname(),
        "pc": pc,
        "metrics": metrics,
        "items": items,
    }))
}

/// Removes a component from this PC, after the administrator's password.
#[tauri::command]
pub async fn remove_component(
    role: String,
    auth: Option<AdminAuth>,
    on_event: Channel<InstallerMsg>,
    runner: State<'_, Runner>,
) -> Result<RunResult> {
    if role != "desktop" {
        return Err(SetupError::new(
            "REMOVE_UNSUPPORTED",
            "Only Lefi Desktop can be removed on its own here. Lefi Brain goes with Uninstall in Settings.",
        ));
    }
    require_admin(auth.as_ref()).await?;
    installer::unsupported_os()?;
    let layout = Layout::locate()?;
    let _guard = runner.acquire()?;
    let cmd = installer::command(
        &layout.install_sh(),
        &["--remove-role", &role, "--events", "ndjson"],
        None,
    );
    installer::run(cmd, |m| {
        let _ = on_event.send(m);
    })
    .await
}

/// Lefi Crop off this PC, its data included. The licence and the root CA stay, so installing again
/// needs no new activation code; the PCs that joined must join again.
#[tauri::command]
pub async fn uninstall_everything(
    auth: Option<AdminAuth>,
    on_event: Channel<InstallerMsg>,
    runner: State<'_, Runner>,
    sessions: State<'_, Sessions>,
    activation: State<'_, Activation>,
) -> Result<RunResult> {
    require_admin(auth.as_ref()).await?;
    installer::unsupported_os()?;
    let layout = Layout::locate()?;
    let _guard = runner.acquire()?;
    // Its own service first: asks for the Mac's password, and stops here if that is refused.
    if lefi_helperd::service::registered("main") == "boot" {
        let bin = crate::fleet::helperd_bin()?;
        let cmd = format!(
            "{} uninstall-service main --scope boot",
            lefi_helperd::service::sh_quote(&bin.display().to_string())
        );
        crate::fleet::run_as_admin(&cmd, "Lefi Crop Helper wants to remove its service.")?;
    }
    lefi_helperd::service::uninstall("main", false)
        .map_err(|e| SetupError::new("SERVICE_STOP", e.to_string()))?;
    let cmd = installer::command(
        &layout.install_sh(),
        &["--uninstall-everything", "--events", "ndjson"],
        None,
    );
    let res = installer::run(cmd, |m| {
        let _ = on_event.send(m);
    })
    .await?;
    if res.exit_code == Some(0) {
        sessions.clear();
        let dir = PathBuf::from(activation.status()?.data_dir);
        let _ = std::fs::remove_file(dir.join(FINISHED_FILE));
        let _ = std::fs::remove_dir_all(dir.join("fleet"));
    }
    Ok(res)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paths(d: &Path, port: u16, roles: &str) -> Paths {
        let env = d.join("lefi.env");
        std::fs::write(
            &env,
            format!(
                "LEFI_ROLES={roles}\nLEFI_API_PORT={port}\nLEFI_BOOTSTRAP_ADMIN_USERNAME=admin\nLEFI_BOOTSTRAP_ADMIN_PASSWORD=first-password\nOTHER=x\n"
            ),
        )
        .unwrap();
        Paths {
            state: d.to_path_buf(),
            env,
        }
    }

    /// A FAKE Brain: `right-password` opens an admin session, `worker-password` a worker's.
    async fn fake_brain() -> u16 {
        use axum::http::StatusCode;
        use axum::routing::post;
        let app = axum::Router::new()
            .route(
                "/api/v1/auth/login",
                post(|axum::Json(b): axum::Json<Value>| async move {
                    match b["password"].as_str() {
                        Some("right-password") => (
                            StatusCode::OK,
                            axum::Json(json!({"role":{"id":"admin"},"token":"t"})),
                        ),
                        Some("worker-password") => (
                            StatusCode::OK,
                            axum::Json(json!({"role":{"id":"worker"},"token":"t"})),
                        ),
                        Some("locked") => (StatusCode::TOO_MANY_REQUESTS, axum::Json(json!({}))),
                        _ => (StatusCode::UNAUTHORIZED, axum::Json(json!({}))),
                    }
                }),
            )
            .route(
                "/api/v1/auth/logout",
                post(|| async { axum::Json(json!({})) }),
            );
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = l.local_addr().unwrap().port();
        tokio::spawn(async move { axum::serve(l, app).await });
        port
    }

    fn auth(p: &str) -> AdminAuth {
        AdminAuth {
            username: "admin".into(),
            password: p.into(),
        }
    }

    #[tokio::test]
    async fn only_the_administrator_gets_through() {
        let d = tempfile::tempdir().unwrap();
        let port = fake_brain().await;
        let p = paths(d.path(), port, "core,admin");
        assert!(check_admin(&p, Some(&auth("right-password"))).await.is_ok());
        for (pw, code) in [
            ("nope", "ADMIN_PASSWORD_WRONG"),
            ("worker-password", "ADMIN_ONLY"),
            ("locked", "LOGIN_LOCKED"),
        ] {
            assert_eq!(
                check_admin(&p, Some(&auth(pw))).await.unwrap_err().code,
                code
            );
        }
        assert_eq!(
            check_admin(&p, None).await.unwrap_err().code,
            "ADMIN_REQUIRED"
        );
        // A stopped Brain with no program to ask: never an open door.
        let down = paths(d.path(), 1, "core");
        assert_eq!(
            check_admin(&down, Some(&auth("right-password")))
                .await
                .unwrap_err()
                .code,
            "BRAIN_DOWN"
        );
        // No Brain installed on this PC yet: there is no account to ask for.
        assert!(check_admin(&paths(d.path(), 1, "ai"), None).await.is_ok());
    }

    #[test]
    fn the_offline_answer_is_read_whole() {
        let v = parse_verify("{\n  \"ok\": true,\n  \"role\": \"admin\"\n}\n");
        assert_eq!((&v["ok"], &v["role"]), (&json!(true), &json!("admin")));
        assert_eq!(parse_verify("not json"), Value::Null);
    }

    #[test]
    fn sealing_removes_the_first_password_and_keeps_the_rest() {
        let d = tempfile::tempdir().unwrap();
        let p = paths(d.path(), 1, "core");
        std::fs::create_dir_all(d.path().join("credentials")).unwrap();
        let admin = d.path().join("credentials/admin.txt");
        std::fs::write(&admin, "username=admin\npassword=first-password\n").unwrap();
        std::fs::write(d.path().join("credentials/mqtt.env"), "esp32-01=abc=d\n").unwrap();
        let c = parse_credentials(&d.path().join("credentials"));
        assert_eq!(c.admin.unwrap().password, "first-password");
        assert_eq!(c.devices[0].username, "esp32-01");
        assert_eq!(
            c.devices[0].password, "abc=d",
            "base64-like values keep their '='"
        );
        seal_admin(&p).unwrap();
        seal_admin(&p).unwrap();
        let env = std::fs::read_to_string(&p.env).unwrap();
        assert!(!env.contains("first-password"));
        assert_eq!(env.matches("LEFI_ADMIN_SEALED=1").count(), 1);
        assert!(env.contains("OTHER=x"));
        assert!(!admin.exists());
        assert!(d.path().join("credentials/mqtt.env").exists());
    }
}
