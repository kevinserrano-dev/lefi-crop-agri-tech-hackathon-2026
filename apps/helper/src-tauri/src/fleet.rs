//! "Other PCs" console (ADR-031, ADR-033): talks to the Lefi Crop Helper service (`lefi-helperd main`)
//! on loopback with the token it wrote in the app data folder, and registers that service.

use std::path::{Path, PathBuf};

use serde_json::{json, Value};
use tauri::State;

use crate::activation::Activation;
use crate::console::{self, AdminAuth};
use crate::error::{Result, SetupError};

const ADMIN: &str = "http://127.0.0.1:8792";

fn err(code: &'static str, e: impl std::fmt::Display) -> SetupError {
    SetupError::new(code, e.to_string())
}

/// The service program. Debug builds use the one built in this checkout; packaging it inside
/// the app (Tauri sidecar) is part of release packaging (S3, tech debt).
pub(crate) fn helperd_bin() -> Result<PathBuf> {
    if let Some(p) = std::env::var_os("LEFI_HELPERD_BIN") {
        return Ok(PathBuf::from(p));
    }
    // Packaged app: Tauri puts the sidecar next to the app's own executable (Contents/MacOS).
    if let Some(p) = std::env::current_exe()
        .ok()
        .and_then(|e| e.parent().map(|d| d.join("lefi-helperd")))
        .filter(|p| p.is_file())
    {
        return Ok(p);
    }
    if cfg!(debug_assertions) {
        let p = Path::new(env!("CARGO_MANIFEST_DIR")).join("../helperd/target/debug/lefi-helperd");
        if p.is_file() {
            return Ok(p);
        }
        return Err(
            SetupError::new("SERVICE_MISSING", "lefi-helperd is not built")
                .with_hint("cargo build --manifest-path apps/helper/helperd/Cargo.toml"),
        );
    }
    Err(SetupError::new(
        "SERVICE_MISSING",
        "The Lefi Crop Helper service is missing from this app (bundle it with: pnpm --filter @lefi/helper bundle).",
    ))
}

fn token(dir: &Path) -> Option<String> {
    std::fs::read_to_string(dir.join("fleet/admin.token"))
        .ok()
        .map(|t| t.trim().to_string())
}

async fn call(dir: &Path, method: &str, path: &str, body: Value) -> Result<Value> {
    let tok = token(dir).ok_or_else(|| {
        SetupError::new(
            "SERVICE_STOPPED",
            "The Lefi Crop Helper service has not started yet.",
        )
    })?;
    let c = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| err("SERVICE_STOPPED", e))?;
    let url = format!("{ADMIN}{path}");
    let req = if method == "GET" {
        c.get(url)
    } else {
        c.post(url).json(&body)
    };
    let resp = req.bearer_auth(tok).send().await.map_err(|_| {
        SetupError::new(
            "SERVICE_STOPPED",
            "The Lefi Crop Helper service is not running.",
        )
    })?;
    let ok = resp.status().is_success();
    let v: Value = resp.json().await.unwrap_or(Value::Null);
    if ok {
        return Ok(v);
    }
    let code = v["error"]["code"].as_str().unwrap_or("SERVICE_ERROR");
    let msg = v["error"]["message"]
        .as_str()
        .unwrap_or("The Lefi Crop Helper service refused the request.")
        .to_string();
    // Map to 'static codes the UI knows.
    let known: &'static str = match code {
        "LICENCE_PC_LIMIT" => "LICENCE_PC_LIMIT",
        "BRAIN_ONLY_ON_MAIN" => "BRAIN_ONLY_ON_MAIN",
        "AI_ALREADY_ASSIGNED" => "AI_ALREADY_ASSIGNED",
        "NODE_REVOKED" => "NODE_REVOKED",
        "BAD_REQUEST" => "BAD_REQUEST",
        "COMMAND_BUSY" => "COMMAND_BUSY",
        "NOTHING_TO_INSTALL" => "NOTHING_TO_INSTALL",
        "PAYLOAD_MISSING" => "PAYLOAD_MISSING",
        "COMMAND_FINISHED" => "COMMAND_FINISHED",
        "NODE_UNKNOWN" => "NODE_UNKNOWN",
        "SERVICE_OUTDATED" => "SERVICE_OUTDATED",
        "REMOVE_UNSUPPORTED" => "REMOVE_UNSUPPORTED",
        _ => "SERVICE_ERROR",
    };
    Err(SetupError::new(known, msg))
}

pub(crate) async fn admin_get(dir: &Path, path: &str) -> Result<Value> {
    call(dir, "GET", path, Value::Null).await
}

pub(crate) async fn admin_post(dir: &Path, path: &str, body: Value) -> Result<Value> {
    call(dir, "POST", path, body).await
}

fn data_dir(a: &Activation) -> Result<PathBuf> {
    Ok(PathBuf::from(a.status()?.data_dir))
}

#[tauri::command]
pub async fn fleet_status(activation: State<'_, Activation>) -> Result<Value> {
    let dir = data_dir(&activation)?;
    let service_registered = lefi_helperd::service::registered("main");
    match call(&dir, "GET", "/admin/status", Value::Null).await {
        Ok(mut v) => {
            v["service"] = json!("running");
            v["service_registered"] = json!(service_registered);
            // Replacing the app does not restart a service already running from the old one.
            v["service_outdated"] =
                json!(v["service_version"].as_str() != Some(lefi_helperd::VERSION));
            Ok(v)
        }
        Err(e) if e.code == "SERVICE_STOPPED" => Ok(
            json!({ "service": "stopped", "service_registered": service_registered, "message": e.message }),
        ),
        Err(e) => Err(e),
    }
}

fn current_user() -> String {
    std::process::Command::new("id")
        .arg("-un")
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default()
}

/// Runs a shell command as administrator through the macOS password dialog.
pub(crate) fn run_as_admin(command: &str, prompt: &str) -> Result<()> {
    let script = lefi_helperd::service::admin_applescript(command, prompt);
    let out = std::process::Command::new("osascript")
        .args(["-e", &script])
        .output()
        .map_err(|e| err("SERVICE_START", e))?;
    if out.status.success() {
        return Ok(());
    }
    let msg = String::from_utf8_lossy(&out.stderr).trim().to_string();
    if msg.contains("-128") || msg.to_lowercase().contains("cancel") {
        return Err(SetupError::new(
            "ADMIN_CANCELLED",
            "The administrator password was not given.",
        ));
    }
    Err(SetupError::new("SERVICE_START", msg))
}

/// Registers and starts `lefi-helperd main`. `at_boot` (default): a LaunchDaemon that starts
/// when the Mac starts, through the macOS administrator dialog; otherwise a LaunchAgent that
/// starts at login (no administrator rights). Only on an activated PC.
#[tauri::command]
pub fn fleet_start_service(at_boot: bool, activation: State<'_, Activation>) -> Result<Value> {
    if activation.status()?.licence.is_none() {
        return Err(SetupError::new(
            "ACTIVATION_REQUIRED",
            "Activate this PC before starting the Lefi Crop Helper service.",
        ));
    }
    let dir = data_dir(&activation)?;
    let bin = helperd_bin()?;
    // The installer files sent to satellites: the app's payload (the checkout in development).
    let root = crate::installer::Layout::locate().ok().map(|l| l.root);
    if at_boot {
        use lefi_helperd::service::sh_quote;
        let user = current_user();
        // Only one copy may run: drop a login-time agent registered before.
        let _ = lefi_helperd::service::uninstall("main", false);
        let mut cmd = format!(
            "{} install-service main --data {} --scope boot --user {}",
            sh_quote(&bin.display().to_string()),
            sh_quote(&dir.display().to_string()),
            sh_quote(&user)
        );
        if let Some(r) = &root {
            cmd.push_str(&format!(
                " --payload-root {}",
                sh_quote(&r.display().to_string())
            ));
        }
        run_as_admin(
            &cmd,
            "Lefi Crop Helper wants to start its service whenever this Mac starts.",
        )?;
        return Ok(json!({ "scope": "boot" }));
    }
    let extra: Vec<String> = root
        .map(|r| vec!["--payload-root".into(), r.display().to_string()])
        .unwrap_or_default();
    lefi_helperd::service::install(
        "main",
        &bin,
        &dir,
        &extra,
        &lefi_helperd::service::Scope::Login,
    )
    .map_err(|e| err("SERVICE_START", e))?;
    Ok(json!({ "scope": "login" }))
}

#[tauri::command]
pub fn fleet_stop_service() -> Result<Value> {
    if lefi_helperd::service::registered("main") == "boot" {
        let bin = helperd_bin()?;
        let cmd = format!(
            "{} uninstall-service main --scope boot",
            lefi_helperd::service::sh_quote(&bin.display().to_string())
        );
        run_as_admin(&cmd, "Lefi Crop Helper wants to stop its service.")?;
    }
    lefi_helperd::service::uninstall("main", false).map_err(|e| err("SERVICE_STOP", e))?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub async fn fleet_create_code(
    expected_ip: Option<String>,
    activation: State<'_, Activation>,
) -> Result<Value> {
    let dir = data_dir(&activation)?;
    call(
        &dir,
        "POST",
        "/admin/codes",
        json!({ "expected_ip": expected_ip }),
    )
    .await
}

pub(crate) fn check_id(id: &str) -> Result<()> {
    if id.len() <= 32 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        Ok(())
    } else {
        Err(SetupError::new("BAD_REQUEST", "Not a PC id."))
    }
}

#[tauri::command]
pub async fn fleet_revoke(
    id: String,
    auth: Option<AdminAuth>,
    activation: State<'_, Activation>,
) -> Result<Value> {
    check_id(&id)?;
    console::require_admin(auth.as_ref()).await?;
    let dir = data_dir(&activation)?;
    call(
        &dir,
        "POST",
        &format!("/admin/nodes/{id}/revoke"),
        Value::Null,
    )
    .await
}

fn check_cmd(id: &str) -> Result<()> {
    if id.len() <= 40 && id.starts_with("cmd-") && id[4..].chars().all(|c| c.is_ascii_hexdigit()) {
        Ok(())
    } else {
        Err(SetupError::new("BAD_REQUEST", "Not a command id."))
    }
}

/// Install the PC's assigned components there, or only `roles` (or preview with `dry_run`).
#[tauri::command]
pub async fn fleet_install(
    id: String,
    dry_run: bool,
    roles: Option<Vec<String>>,
    activation: State<'_, Activation>,
) -> Result<Value> {
    check_id(&id)?;
    let dir = data_dir(&activation)?;
    call(
        &dir,
        "POST",
        &format!("/admin/nodes/{id}/install"),
        json!({ "dry_run": dry_run, "roles": roles }),
    )
    .await
}

/// The rest of what a PC can be asked to do (ADR-040): remove a component, start/stop/restart the
/// AI service, measure the AI. The service checks the allowlist; there is no remote shell.
#[tauri::command]
pub async fn fleet_run(
    id: String,
    kind: String,
    role: Option<String>,
    action: Option<String>,
    auth: Option<AdminAuth>,
    activation: State<'_, Activation>,
) -> Result<Value> {
    check_id(&id)?;
    // Taking something away always asks for the administrator (ADR-043).
    if kind == "remove" {
        console::require_admin(auth.as_ref()).await?;
    }
    let dir = data_dir(&activation)?;
    call(
        &dir,
        "POST",
        &format!("/admin/nodes/{id}/run"),
        json!({ "kind": kind, "role": role, "action": action }),
    )
    .await
}

/// Retry connecting the main PC's Brain to the AI on that PC (`lefi ai use`, ADR-033).
#[tauri::command]
pub async fn fleet_link_ai(id: String, activation: State<'_, Activation>) -> Result<Value> {
    check_id(&id)?;
    let dir = data_dir(&activation)?;
    call(
        &dir,
        "POST",
        &format!("/admin/nodes/{id}/link-ai"),
        Value::Null,
    )
    .await
}

/// Ask that PC's Lefi Crop Helper service to replace itself with the program this main PC shares
/// (ADR-062). The service checks the versions; the PC checks the SHA-256 and the new program.
#[tauri::command]
pub async fn fleet_update_service(id: String, activation: State<'_, Activation>) -> Result<Value> {
    check_id(&id)?;
    let dir = data_dir(&activation)?;
    call(
        &dir,
        "POST",
        &format!("/admin/nodes/{id}/update-service"),
        Value::Null,
    )
    .await
}

/// Undo the last install run on that PC (its own journal, ADR-032).
#[tauri::command]
pub async fn fleet_rollback(
    id: String,
    auth: Option<AdminAuth>,
    activation: State<'_, Activation>,
) -> Result<Value> {
    check_id(&id)?;
    console::require_admin(auth.as_ref()).await?;
    let dir = data_dir(&activation)?;
    call(
        &dir,
        "POST",
        &format!("/admin/nodes/{id}/rollback"),
        Value::Null,
    )
    .await
}

#[tauri::command]
pub async fn fleet_cancel(cmd: String, activation: State<'_, Activation>) -> Result<Value> {
    check_cmd(&cmd)?;
    let dir = data_dir(&activation)?;
    call(
        &dir,
        "POST",
        &format!("/admin/commands/{cmd}/cancel"),
        Value::Null,
    )
    .await
}

/// A command's record and every message the satellite sent (same shape as local installs).
#[tauri::command]
pub async fn fleet_command(cmd: String, activation: State<'_, Activation>) -> Result<Value> {
    check_cmd(&cmd)?;
    let dir = data_dir(&activation)?;
    call(&dir, "GET", &format!("/admin/commands/{cmd}"), Value::Null).await
}

#[tauri::command]
pub async fn fleet_assign(
    id: String,
    roles: Vec<String>,
    activation: State<'_, Activation>,
) -> Result<Value> {
    check_id(&id)?;
    let dir = data_dir(&activation)?;
    call(
        &dir,
        "POST",
        &format!("/admin/nodes/{id}/assign"),
        json!({ "roles": roles }),
    )
    .await
}
