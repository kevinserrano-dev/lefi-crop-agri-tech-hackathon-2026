//! "Erase Lefi Crop from every PC" (ADR-054): back to before Lefi Crop, for a fresh start.
//! 1. every other PC that can be reached runs the allowlisted `erase` command (its installer's
//!    uninstall, then its service deletes itself and its identity);
//! 2. this PC: the uninstall of ADR-043 (services, what the installations added, the database);
//! 3. on closing: this app's data (licence, root CA, registry), Lefi Desktop's data and keychain
//!    items, logs and caches, and the app itself, removed by a small process once the app exited.
//!
//! Unlike Uninstall, the licence goes too: the next installation needs a new activation code.

use std::path::{Path, PathBuf};

use serde_json::{json, Value};
use tauri::ipc::Channel;
use tauri::{AppHandle, State};

use crate::activation::Activation;
use crate::console::{self, AdminAuth, Paths};
use crate::error::{Result, SetupError};
use crate::installer::{InstallerMsg, RunResult, Runner};
use crate::session::Sessions;

/// What happens to one other PC.
fn plan_for(node: &Value) -> Value {
    let version = node["last_heartbeat"]["helperd_version"]
        .as_str()
        .unwrap_or("");
    let conn = node["connectivity"].as_str().unwrap_or("never");
    let (erasable, reason) = if node["revoked"] == true {
        (false, "removed")
    } else if !matches!(conn, "online" | "stale") {
        (false, "offline")
    } else if node["service_outdated"] == true
        || !lefi_helperd::jobs::version_at_least(version, lefi_helperd::jobs::ERASE_MIN_VERSION)
    {
        (false, "outdated")
    } else if node["active_command"].is_object() {
        (false, "busy")
    } else {
        (true, "")
    };
    json!({
        "id": node["id"], "name": node["name"], "hostname": node["hostname"], "ip": node["ip"],
        "erasable": erasable, "reason": reason,
    })
}

/// The other PCs of this installation and whether each one can be erased from here now.
#[tauri::command]
pub async fn erase_plan(activation: State<'_, Activation>) -> Result<Value> {
    let dir = PathBuf::from(activation.status()?.data_dir);
    match crate::fleet::admin_get(&dir, "/admin/status").await {
        Ok(st) => {
            let nodes: Vec<Value> = st["nodes"]
                .as_array()
                .map(|a| {
                    a.iter()
                        .filter(|n| n["revoked"] != true)
                        .map(plan_for)
                        .collect()
                })
                .unwrap_or_default();
            Ok(json!({
                "service_running": true,
                "update_command": st["update_command"],
                "nodes": nodes,
                "manual_command": lefi_helperd::traces::boot_service_cleanup_command("satellite"),
                "manual_script": lefi_helperd::traces::manual_erase_script(),
            }))
        }
        Err(e) if e.code == "SERVICE_STOPPED" => Ok(json!({
            "service_running": false,
            // Without the service the registry still says whether other PCs ever joined.
            "registered_nodes": registered_nodes(&dir),
            "nodes": [],
            "manual_command": lefi_helperd::traces::boot_service_cleanup_command("satellite"),
            "manual_script": lefi_helperd::traces::manual_erase_script(),
        })),
        Err(e) => Err(e),
    }
}

fn registered_nodes(dir: &Path) -> usize {
    std::fs::read(dir.join("fleet/registry.json"))
        .ok()
        .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
        .and_then(|v| {
            v["nodes"]
                .as_array()
                .map(|a| a.iter().filter(|n| n["revoked"] != true).count())
        })
        .unwrap_or(0)
}

/// Step 1: sends `erase` to every PC that can take it. The console follows each command with
/// `fleet_command`; the others are listed with the reason.
#[tauri::command]
pub async fn erase_nodes(
    auth: Option<AdminAuth>,
    activation: State<'_, Activation>,
) -> Result<Value> {
    console::require_admin(auth.as_ref()).await?;
    let plan = erase_plan(activation.clone()).await?;
    let dir = PathBuf::from(activation.status()?.data_dir);
    let mut out = vec![];
    for n in plan["nodes"].as_array().cloned().unwrap_or_default() {
        let mut r = n.clone();
        if n["erasable"] == true {
            let id = n["id"].as_str().unwrap_or("");
            crate::fleet::check_id(id)?;
            match crate::fleet::admin_post(
                &dir,
                &format!("/admin/nodes/{id}/run"),
                json!({ "kind": "erase" }),
            )
            .await
            {
                Ok(v) => r["command_id"] = v["command"]["command"]["id"].clone(),
                Err(e) => {
                    r["erasable"] = json!(false);
                    r["reason"] = json!("refused");
                    r["message"] = json!(e.message);
                }
            }
        }
        out.push(r);
    }
    Ok(json!({ "nodes": out }))
}

/// Step 2: this PC, as Uninstall (ADR-043): the services, what the installations added, the
/// database. The app's own data goes when it closes (step 3).
#[tauri::command]
pub async fn erase_this_pc(
    auth: Option<AdminAuth>,
    on_event: Channel<InstallerMsg>,
    runner: State<'_, Runner>,
    sessions: State<'_, Sessions>,
    activation: State<'_, Activation>,
) -> Result<RunResult> {
    console::uninstall_everything(auth, on_event, runner, sessions, activation).await
}

/// The app bundle this program runs from, when it is a packaged app (never a development build).
fn own_bundle() -> Option<PathBuf> {
    if cfg!(debug_assertions) {
        return None;
    }
    let exe = std::env::current_exe().ok()?;
    let bundle = exe.ancestors().nth(3)?.to_path_buf(); // X.app/Contents/MacOS/exe
    let name = bundle.file_name()?.to_str()?;
    (name.ends_with(".app") && exe.starts_with(bundle.join("Contents/MacOS"))).then_some(bundle)
}

/// Everything step 3 removes, checked: inside this user's home, or this app's own bundle.
pub fn final_paths(home: &Path, data_dir: &Path, bundle: Option<&Path>) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = lefi_helperd::traces::user_traces(home);
    v.push(data_dir.to_path_buf());
    v.push(home.join(".lefi-helper")); // a PC that was once a satellite
    v.retain(|p| lefi_helperd::traces::safe_to_delete(home, p));
    if let Some(b) = bundle {
        v.push(b.to_path_buf());
        let mut prev = b.as_os_str().to_owned();
        prev.push(".previous");
        v.push(PathBuf::from(prev));
    }
    v
}

/// Step 3: closes the app; a small process waits for it to exit, then removes what is left.
/// Refused until this PC was erased (step 2), so it can never run on a working installation.
#[tauri::command]
pub fn quit_and_remove_helper(app: AppHandle, activation: State<'_, Activation>) -> Result<Value> {
    let p = Paths::locate()?;
    if p.state.exists() {
        return Err(SetupError::new(
            "ERASE_NOT_DONE",
            "Lefi Crop is still installed on this PC: erase it first.",
        ));
    }
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| SetupError::new("NO_HOME", "HOME is not set."))?;
    let data = PathBuf::from(activation.status()?.data_dir);
    let bundle = own_bundle();
    let paths = final_paths(&home, &data, bundle.as_deref());
    lefi_helperd::traces::remove_keychain_items();
    spawn_remover(&paths)?;
    app.exit(0);
    Ok(json!({ "removing": paths, "app_removed": bundle.is_some() }))
}

fn spawn_remover(paths: &[PathBuf]) -> Result<()> {
    use std::os::unix::process::CommandExt;
    use std::process::{Command, Stdio};
    // Waits (at most a minute) for this app to exit, so nothing it still writes comes back.
    let script = r#"pid="$1"; shift; i=0
while kill -0 "$pid" 2>/dev/null && [ "$i" -lt 120 ]; do sleep 0.5; i=$((i + 1)); done
rm -rf -- "$@""#;
    Command::new("/bin/sh")
        .arg("-c")
        .arg(script)
        .arg("lefi-crop-erase")
        .arg(std::process::id().to_string())
        .args(paths)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .process_group(0) // not ended with the app
        .spawn()
        .map_err(|e| SetupError::new("ERASE_FAILED", e.to_string()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_pc_is_erased_from_here_only_when_it_answers_and_knows_how() {
        let node = |conn: &str, ver: &str| {
            json!({"id":"pc-1","name":"lefi-node-1","connectivity":conn,"revoked":false,
                   "service_outdated":false,"active_command":null,
                   "last_heartbeat":{"helperd_version":ver}})
        };
        assert_eq!(plan_for(&node("online", "0.5.0"))["erasable"], true);
        assert_eq!(plan_for(&node("offline", "0.5.0"))["reason"], "offline");
        assert_eq!(plan_for(&node("online", "0.4.3"))["reason"], "outdated");
        let mut busy = node("online", "0.5.0");
        busy["active_command"] = json!({"state":"running"});
        assert_eq!(plan_for(&busy)["reason"], "busy");
    }

    #[test]
    fn the_last_step_removes_only_lefi_crop_paths() {
        let home = Path::new("/Users/fake");
        let data = home.join("Library/Application Support/ai.leficrop.helper");
        let app = Path::new("/Applications/Lefi Crop Helper.app");
        let v = final_paths(home, &data, Some(app));
        assert!(v.contains(&data));
        assert!(v.contains(&home.join(".lefi-helper")));
        assert!(v.contains(&home.join("Library/Application Support/ai.leficrop.desktop")));
        assert!(v.contains(&PathBuf::from(
            "/Applications/Lefi Crop Helper.app.previous"
        )));
        assert!(!v
            .iter()
            .any(|p| p == home || p == Path::new("/Applications")));
        // A data folder outside the home (a test override) is left alone.
        let v = final_paths(home, Path::new("/tmp/elsewhere"), None);
        assert!(!v.iter().any(|p| p.starts_with("/tmp")));
        // A development build never removes itself (its "bundle" is the checkout).
        assert!(own_bundle().is_none());
    }
}
