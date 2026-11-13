//! Backups on an external disk and restore by parts (ADR-098). The bash engine
//! (`bin/lefi backup …`, `scripts/cli/backup.sh`) does the work; this file runs it, checks the
//! administrator for everything that changes something, and stops Lefi Crop Helper's own service
//! while its data is restored (it would otherwise write its registry back over the restored one).

use std::path::{Path, PathBuf};

use serde_json::{json, Value};
use tauri::State;

use crate::activation::Activation;
use crate::console::{require_admin, AdminAuth};
use crate::error::{Result, SetupError};
use crate::installer::Layout;

pub const PARTS: [&str; 6] = [
    "database", "files", "settings", "security", "helper", "desktop",
];
const INTERVALS: [&str; 5] = ["6", "12", "24", "on", "off"];

/// The last JSON object a `lefi … --json` command printed.
pub fn last_json(stdout: &str) -> Option<Value> {
    stdout
        .lines()
        .rev()
        .find_map(|l| serde_json::from_str::<Value>(l.trim()).ok())
}

/// The codes `scripts/cli/backup.sh` answers with (anything else is reported as BACKUP_FAILED).
pub const ENGINE_CODES: [&str; 13] = [
    "NOT_CONFIGURED",
    "BUSY",
    "DISK_NOT_CONNECTED",
    "DISK_WRITE",
    "DISK_FULL",
    "WRITE_FAILED",
    "NOT_FOUND",
    "DAMAGED",
    "USAGE",
    "DESKTOP_RUNNING",
    "HELPER_RUNNING",
    "SAFETY_COPY_FAILED",
    "RESTORE_UNDONE",
];

fn engine_code(code: &str) -> &'static str {
    ENGINE_CODES
        .iter()
        .find(|c| **c == code)
        .copied()
        .unwrap_or("BACKUP_FAILED")
}

/// The engine's answer: `{"ok":false,"code","message"}` becomes the error people read.
pub fn answer(code: Option<i32>, stdout: &str, stderr: &str) -> Result<Value> {
    let v = last_json(stdout);
    match (code, v) {
        (_, Some(v)) if v["ok"] == false => Err(SetupError::new(
            engine_code(v["code"].as_str().unwrap_or("")),
            v["message"]
                .as_str()
                .unwrap_or("The backup command failed."),
        )),
        (Some(0), Some(v)) => Ok(v),
        _ => {
            let last = stderr
                .lines()
                .rev()
                .find(|l| !l.trim().is_empty())
                .unwrap_or("")
                .trim()
                .trim_start_matches('✖')
                .trim();
            Err(SetupError::new(
                "BACKUP_FAILED",
                if last.is_empty() {
                    "The backup command failed without saying why."
                } else {
                    last
                },
            ))
        }
    }
}

async fn lefi(data_dir: &Path, args: &[&str], extra: &[(&str, &str)]) -> Result<Value> {
    let root = Layout::locate()?.root;
    let mut c = tokio::process::Command::new(root.join("bin/lefi"));
    c.args(args)
        .env(
            "PATH",
            format!(
                "/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/local/sbin:/usr/bin:/bin:/usr/sbin:/sbin:{}",
                std::env::var("PATH").unwrap_or_default()
            ),
        )
        .env("NO_COLOR", "1")
        .env("LEFI_HELPER_DATA", data_dir)
        .env("LEFI_HELPER_VERSION", lefi_helperd::VERSION)
        .stdin(std::process::Stdio::null());
    for (k, v) in extra {
        c.env(k, v);
    }
    let o = c
        .output()
        .await
        .map_err(|e| SetupError::new("BACKUP_FAILED", e.to_string()))?;
    answer(
        o.status.code(),
        &String::from_utf8_lossy(&o.stdout),
        &String::from_utf8_lossy(&o.stderr),
    )
}

fn data_dir(a: &Activation) -> Result<PathBuf> {
    Ok(PathBuf::from(a.status()?.data_dir))
}

pub fn check_backup_id(id: &str) -> Result<()> {
    let ok = id.len() >= 15
        && id.len() <= 17
        && id.chars().all(|c| c.is_ascii_digit() || c == '-')
        && id.as_bytes()[8] == b'-';
    if ok {
        Ok(())
    } else {
        Err(SetupError::new("BAD_REQUEST", "Not a backup id."))
    }
}

pub fn check_parts(parts: &[String]) -> Result<String> {
    if parts.is_empty() {
        return Err(SetupError::new(
            "BAD_REQUEST",
            "Choose at least one part to restore.",
        ));
    }
    if let Some(p) = parts.iter().find(|p| !PARTS.contains(&p.as_str())) {
        return Err(SetupError::new("BAD_REQUEST", format!("Unknown part: {p}")));
    }
    Ok(parts.join(","))
}

fn check_uuid(uuid: &str) -> Result<()> {
    if !uuid.is_empty()
        && uuid.len() <= 64
        && uuid.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
    {
        Ok(())
    } else {
        Err(SetupError::new("BAD_REQUEST", "Not a disk id."))
    }
}

#[tauri::command]
pub async fn backup_status(activation: State<'_, Activation>) -> Result<Value> {
    lefi(
        &data_dir(&activation)?,
        &["backup", "status", "--json"],
        &[],
    )
    .await
}

/// External disks only: the engine never lists internal disks or disk images.
#[tauri::command]
pub async fn backup_disks(activation: State<'_, Activation>) -> Result<Value> {
    let dir = data_dir(&activation)?;
    let root = Layout::locate()?.root;
    let o = tokio::process::Command::new(root.join("bin/lefi"))
        .args(["backup", "disks", "--json"])
        .env("NO_COLOR", "1")
        .env("LEFI_HELPER_DATA", &dir)
        .output()
        .await
        .map_err(|e| SetupError::new("BACKUP_FAILED", e.to_string()))?;
    let text = String::from_utf8_lossy(&o.stdout);
    match text
        .lines()
        .rev()
        .find_map(|l| serde_json::from_str::<Value>(l).ok())
    {
        Some(v) if v.is_array() => Ok(v),
        _ => answer(o.status.code(), &text, &String::from_utf8_lossy(&o.stderr)),
    }
}

#[tauri::command]
pub async fn backup_list(activation: State<'_, Activation>) -> Result<Value> {
    lefi(&data_dir(&activation)?, &["backup", "list", "--json"], &[]).await
}

/// Backups go to this disk from now on (it holds Lefi Brain's keys: the administrator decides).
#[tauri::command]
pub async fn backup_set_disk(
    uuid: String,
    auth: Option<AdminAuth>,
    activation: State<'_, Activation>,
) -> Result<Value> {
    check_uuid(&uuid)?;
    require_admin(auth.as_ref()).await?;
    let installation = activation.installation_id()?;
    lefi(
        &data_dir(&activation)?,
        &[
            "backup",
            "set-disk",
            &uuid,
            "--installation",
            &installation,
            "--json",
        ],
        &[],
    )
    .await
}

#[tauri::command]
pub async fn backup_schedule(
    every: String,
    auth: Option<AdminAuth>,
    activation: State<'_, Activation>,
) -> Result<Value> {
    if !INTERVALS.contains(&every.as_str()) {
        return Err(SetupError::new(
            "BAD_REQUEST",
            "Every 6, 12 or 24 hours, on or off.",
        ));
    }
    require_admin(auth.as_ref()).await?;
    lefi(
        &data_dir(&activation)?,
        &["backup", "schedule", &every, "--json"],
        &[],
    )
    .await
}

#[tauri::command]
pub async fn backup_run_now(activation: State<'_, Activation>) -> Result<Value> {
    lefi(&data_dir(&activation)?, &["backup", "run", "--json"], &[]).await
}

// ------------------------------------------------------------------ Lefi Crop Helper's service

fn helperd_stop() -> Result<()> {
    let label = lefi_helperd::service::label("main");
    match lefi_helperd::service::registered("main") {
        "boot" => crate::fleet::run_as_admin(
            &format!("launchctl bootout system/{label}"),
            "Lefi Crop Helper stops its service to restore its own data.",
        ),
        "login" => {
            let _ = std::process::Command::new("launchctl")
                .args(["bootout", &format!("gui/{}/{label}", uid())])
                .output();
            Ok(())
        }
        _ => Ok(()),
    }
}

fn helperd_start() -> Result<()> {
    let label = lefi_helperd::service::label("main");
    match lefi_helperd::service::registered("main") {
        "boot" => crate::fleet::run_as_admin(
            &format!("launchctl bootstrap system /Library/LaunchDaemons/{label}.plist"),
            "Lefi Crop Helper starts its service again.",
        ),
        "login" => {
            let home = std::env::var("HOME").unwrap_or_default();
            let _ = std::process::Command::new("launchctl")
                .args([
                    "bootstrap",
                    &format!("gui/{}", uid()),
                    &format!("{home}/Library/LaunchAgents/{label}.plist"),
                ])
                .output();
            Ok(())
        }
        _ => Ok(()),
    }
}

fn uid() -> String {
    std::process::Command::new("id")
        .arg("-u")
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default()
}

/// Restores the chosen parts of one backup. The engine keeps a copy of what it replaces on this
/// PC first, and undoes everything when Lefi Brain does not come back.
#[tauri::command]
pub async fn backup_restore(
    id: String,
    parts: Vec<String>,
    auth: Option<AdminAuth>,
    activation: State<'_, Activation>,
) -> Result<Value> {
    check_backup_id(&id)?;
    let list = check_parts(&parts)?;
    require_admin(auth.as_ref()).await?;
    let dir = data_dir(&activation)?;
    let helper = parts.iter().any(|p| p == "helper");
    if helper {
        helperd_stop()?;
    }
    let res = lefi(
        &dir,
        &["backup", "restore", &id, "--parts", &list, "--json"],
        &[("LEFI_BACKUP_HELPER_STOPPED", if helper { "1" } else { "0" })],
    )
    .await;
    if helper {
        // Started again whatever happened: the service must never stay off after a restore.
        let started = helperd_start();
        if let (Ok(_), Err(e)) = (&res, started) {
            return Err(e.with_hint(
                "The data was restored, but the service did not start: press Start in Nodes.",
            ));
        }
    }
    res.map(|v| json!({ "ok": true, "result": v }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_engine_answer_becomes_a_value_or_its_own_error() {
        assert_eq!(
            answer(Some(0), "noise\n{\"ok\":true,\"id\":\"x\"}\n", "").unwrap()["id"],
            "x"
        );
        let e = answer(
            Some(1),
            "{\"ok\":false,\"code\":\"DISK_NOT_CONNECTED\",\"message\":\"Plug it in.\"}",
            "",
        )
        .unwrap_err();
        assert_eq!(
            (e.code, e.message.as_str()),
            ("DISK_NOT_CONNECTED", "Plug it in.")
        );
        let e = answer(
            Some(1),
            "",
            "  ✖ No usable external disk with UUID x is connected.\n",
        )
        .unwrap_err();
        assert_eq!(
            e.message,
            "No usable external disk with UUID x is connected."
        );
    }

    /// The codes people may see must be the ones the engine really answers with.
    #[test]
    fn every_engine_code_is_known_here() {
        let engine = include_str!("../../../../scripts/cli/backup.sh");
        for c in ENGINE_CODES {
            assert!(engine.contains(c), "{c} is not used by backup.sh");
        }
        let parts = format!("BACKUP_PARTS=\"{}\"", PARTS.join(" "));
        assert!(engine.contains(&parts), "the parts differ from backup.sh");
    }

    #[test]
    fn only_known_ids_and_parts_reach_the_engine() {
        assert!(check_backup_id("20261112-120000").is_ok());
        assert!(check_backup_id("20261112-120000-2").is_ok());
        for bad in [
            "../x",
            "20261112120000",
            "2026-11-12",
            "20261112-120000; rm",
        ] {
            assert!(check_backup_id(bad).is_err(), "{bad}");
        }
        assert_eq!(
            check_parts(&["database".into(), "settings".into()]).unwrap(),
            "database,settings"
        );
        assert!(check_parts(&[]).is_err());
        assert!(check_parts(&["database,ca".into()]).is_err());
        assert!(check_uuid("11111111-AAAA-4BBB-8CCC-000000000001").is_ok());
        assert!(check_uuid("x;y").is_err());
    }
}
