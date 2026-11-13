//! Scheduled backups of the main PC on its external disk (ADR-098).
//!
//! This service only knocks: every 10 minutes it runs `lefi backup run --scheduled --json`, and the
//! bash engine (`scripts/cli/backup.sh`) decides whether a backup is due (every 12 h by default),
//! whether the chosen disk is connected, and writes it. The service runs whether or not the Lefi
//! Crop Helper window is open, at boot, so backups do not depend on anyone being signed in.

use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use serde_json::Value;

use crate::main_node::{lefi_command_output, Shared};

/// How often the engine is asked. A backup is never more frequent than its interval (6/12/24 h).
pub const CHECK_EVERY: Duration = Duration::from_secs(600);
/// First check after the service starts: leaves time for Lefi Brain to start with it at boot.
pub const FIRST_CHECK_AFTER: Duration = Duration::from_secs(120);

pub const ARGS: [&str; 4] = ["backup", "run", "--scheduled", "--json"];

/// What the engine needs to know about this service: where Lefi Crop Helper's own data is (it is
/// one of the parts) and which version wrote the backup.
pub fn extra_env(data_dir: &Path) -> Vec<(String, String)> {
    vec![
        ("LEFI_HELPER_DATA".into(), data_dir.display().to_string()),
        ("LEFI_HELPER_VERSION".into(), crate::VERSION.into()),
    ]
}

/// One knock. `None`: no installer here, or the engine failed without an answer.
pub async fn tick(root: &Path, cli_env: &[(String, String)], data_dir: &Path) -> Option<Value> {
    let out = lefi_command_output(root, cli_env, &ARGS, &extra_env(data_dir)).await;
    // A failed backup exits 1 with its JSON answer on stdout; `lefi_command_output` keeps only
    // successful runs, so failures are read back from the engine's own record (last.json).
    let text = out?;
    text.lines()
        .rev()
        .find_map(|l| serde_json::from_str::<Value>(l).ok())
}

/// A backup is being written: the service does not restart for an update meanwhile (ADR-104).
pub static RUNNING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

pub async fn run(s: Arc<Shared>) {
    let Some(root) = s.cfg.payload_root.clone() else {
        return;
    };
    tokio::time::sleep(FIRST_CHECK_AFTER).await;
    loop {
        RUNNING.store(true, std::sync::atomic::Ordering::SeqCst);
        let done = tick(&root, &s.cfg.cli_env, &s.cfg.data_dir).await;
        RUNNING.store(false, std::sync::atomic::Ordering::SeqCst);
        if let Some(v) = done {
            if v["ran"] == true {
                eprintln!(
                    "backup {} saved ({} bytes)",
                    v["id"].as_str().unwrap_or("?"),
                    v["bytes"]
                );
            }
        }
        tokio::time::sleep(CHECK_EVERY).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("lefi-backup-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join("bin")).unwrap();
        d
    }

    /// A FAKE `bin/lefi` that records how it was called: the real engine is tested in
    /// scripts/tests/backup.inc.sh.
    #[tokio::test]
    async fn the_engine_is_asked_with_the_helper_data_and_its_answer_is_read() {
        let root = temp("tick");
        let lefi = root.join("bin/lefi");
        std::fs::write(
            &lefi,
            "#!/bin/sh\necho \"$* | $LEFI_HELPER_DATA | $LEFI_HELPER_VERSION | $X\" >\"$(dirname \"$0\")/called\"\n\
             echo noise\necho '{\"ok\":true,\"ran\":true,\"id\":\"20261112-120000\",\"bytes\":10}'\n",
        )
        .unwrap();
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&lefi, std::fs::Permissions::from_mode(0o755)).unwrap();
        let data = root.join("helper data");
        let v = tick(&root, &[("X".into(), "cli".into())], &data)
            .await
            .unwrap();
        assert_eq!(v["id"], "20261112-120000");
        let called = std::fs::read_to_string(root.join("bin/called")).unwrap();
        assert_eq!(
            called.trim(),
            format!(
                "backup run --scheduled --json | {} | {} | cli",
                data.display(),
                crate::VERSION
            )
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn no_installer_means_no_backup_and_no_panic() {
        let root = temp("none");
        assert!(tick(&root, &[], &root).await.is_none());
        let _ = std::fs::remove_dir_all(&root);
    }
}
