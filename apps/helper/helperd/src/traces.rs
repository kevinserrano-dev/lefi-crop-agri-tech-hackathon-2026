//! What Lefi Crop leaves in a user's home outside the installer's state folder (ADR-054): the data,
//! caches and preferences macOS keeps per app, the session helper's LaunchAgent, the Helper's logs.
//! Used by "Erase Lefi Crop from every PC" on the main PC and by the `erase` command on the others.
//! Everything here belongs to the user; nothing outside their home is touched.

use std::path::{Path, PathBuf};

pub const DESKTOP_ID: &str = "ai.leficrop.desktop";
pub const HELPER_ID: &str = "ai.leficrop.helper";
/// Keychain service Lefi Desktop used for its secrets (and, before ADR-053, its device key).
pub const DESKTOP_KEYCHAIN_SERVICE: &str = "ai.leficrop.desktop";

/// The per-app folders and files macOS (and the WebView) keep for `bundle_id`.
pub fn app_traces(home: &Path, bundle_id: &str) -> Vec<PathBuf> {
    let lib = home.join("Library");
    vec![
        lib.join("Application Support").join(bundle_id),
        lib.join("Caches").join(bundle_id),
        lib.join("WebKit").join(bundle_id),
        lib.join("HTTPStorages").join(bundle_id),
        lib.join("HTTPStorages")
            .join(format!("{bundle_id}.binarycookies")),
        lib.join("Preferences").join(format!("{bundle_id}.plist")),
        lib.join("Saved Application State")
            .join(format!("{bundle_id}.savedState")),
        lib.join("Logs").join(bundle_id),
    ]
}

/// The Helper's own LaunchAgents in this home (the boot daemons in /Library need root).
pub fn launch_agents(home: &Path) -> Vec<PathBuf> {
    ["helperd-main", "helperd-satellite", "helperd-session"]
        .iter()
        .map(|l| {
            home.join("Library/LaunchAgents")
                .join(format!("com.lefi-crop.{l}.plist"))
        })
        .collect()
}

/// Lefi Desktop's traces on any PC, plus the Helper's where it ran.
pub fn user_traces(home: &Path) -> Vec<PathBuf> {
    let mut v = app_traces(home, DESKTOP_ID);
    v.extend(app_traces(home, HELPER_ID));
    v.push(home.join("Library/Logs/Lefi Crop Helper"));
    v.extend(launch_agents(home));
    v
}

/// A folder this module may delete: strictly inside `home`, never `home` itself.
pub fn safe_to_delete(home: &Path, p: &Path) -> bool {
    let home_ok = home.is_absolute() && home.components().count() >= 3; // /Users/<name>
    home_ok
        && p.is_absolute()
        && p != home
        && p.starts_with(home)
        && !p
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
}

/// Deletes what exists of `paths`; returns what was removed. Unsafe paths are skipped.
pub fn remove(home: &Path, paths: &[PathBuf]) -> Vec<PathBuf> {
    let mut gone = vec![];
    for p in paths {
        if !safe_to_delete(home, p) {
            continue;
        }
        let Ok(meta) = std::fs::symlink_metadata(p) else {
            continue;
        };
        let r = if meta.is_dir() {
            std::fs::remove_dir_all(p)
        } else {
            std::fs::remove_file(p)
        };
        if r.is_ok() {
            gone.push(p.clone());
        }
    }
    gone
}

/// Removes Lefi Desktop's keychain items (at most a few). Returns how many went.
pub fn remove_keychain_items() -> usize {
    if !cfg!(target_os = "macos") {
        return 0;
    }
    let mut n = 0;
    for _ in 0..20 {
        let ok = std::process::Command::new("security")
            .args(["delete-generic-password", "-s", DESKTOP_KEYCHAIN_SERVICE])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .is_ok_and(|s| s.success());
        if !ok {
            break;
        }
        n += 1;
    }
    n
}

/// The one-line command an administrator of that Mac runs to remove a boot service file this
/// user cannot remove (it is owned by root).
pub fn boot_service_cleanup_command(mode: &str) -> String {
    let label = crate::service::label(mode);
    format!(
        "sudo launchctl bootout system/{label}; sudo rm -f /Library/LaunchDaemons/{label}.plist"
    )
}

/// For a joined PC the main PC could not reach: what its user pastes in Terminal on that Mac. The
/// installer it already has undoes its installations (journals), then the rest is removed.
pub fn manual_erase_script() -> String {
    let home = Path::new("$HOME");
    let mut rm: Vec<String> = vec![
        "\"$HOME/.lefi-helper\"".into(),
        "\"$HOME/.lefi-crop\"".into(),
        "\"/Applications/Lefi Crop.app\"".into(),
        "\"$HOME/Applications/Lefi Crop.app\"".into(),
    ];
    rm.extend(
        user_traces(home)
            .iter()
            .map(|p| format!("\"{}\"", p.display())),
    );
    rm.push("\"$HOME\"/Library/LaunchAgents/com.lefi-crop.*.plist".into());
    let sat = crate::service::label("satellite");
    [
        "I=$(ls -d \"$HOME\"/.lefi-helper/payload/*/scripts/install.sh 2>/dev/null | head -n 1)".to_string(),
        "[ -n \"$I\" ] && LEFI_FORCE_PACKAGED=1 bash \"$I\" --uninstall-everything".into(),
        format!("sudo launchctl bootout system/{sat} 2>/dev/null; sudo rm -f /Library/LaunchDaemons/{sat}.plist"),
        format!("launchctl bootout gui/$(id -u)/{SESSION} 2>/dev/null", SESSION = crate::service::SESSION_LABEL),
        format!("rm -rf {}", rm.join(" ")),
    ]
    .join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_manual_script_quotes_every_path_and_uses_the_installer_first() {
        let s = manual_erase_script();
        let lines: Vec<&str> = s.lines().collect();
        assert!(lines[1].contains("--uninstall-everything"));
        assert!(lines[4].starts_with("rm -rf \"$HOME/.lefi-helper\""));
        assert!(s.contains("\"$HOME/Library/Application Support/ai.leficrop.desktop\""));
        assert!(!s.contains("rm -rf \"$HOME\" ") && !s.contains("rm -rf /"));
    }

    #[test]
    fn only_folders_inside_the_home_are_deleted() {
        let home = Path::new("/Users/fake");
        assert!(safe_to_delete(
            home,
            Path::new("/Users/fake/Library/Caches/ai.leficrop.desktop")
        ));
        for bad in [
            "/Users/fake",
            "/Users/fake/",
            "/Users/other/x",
            "/Library/LaunchDaemons/x.plist",
            "relative/x",
            "/Users/fake/../other",
        ] {
            assert!(!safe_to_delete(home, Path::new(bad)), "{bad}");
        }
        assert!(!safe_to_delete(Path::new("/"), Path::new("/x")));
        assert!(!safe_to_delete(Path::new("/Users"), Path::new("/Users/x")));
    }

    #[test]
    fn removes_the_traces_and_nothing_else() {
        let d = tempfile::tempdir().unwrap();
        let home = d.path().join("Users/fake");
        let traces = user_traces(&home);
        for p in &traces {
            if p.extension()
                .is_some_and(|x| x == "plist" || x == "binarycookies")
            {
                std::fs::create_dir_all(p.parent().unwrap()).unwrap();
                std::fs::write(p, b"x").unwrap();
            } else {
                std::fs::create_dir_all(p.join("inner")).unwrap();
            }
        }
        let keep = home.join("Library/Application Support/com.example.other");
        std::fs::create_dir_all(&keep).unwrap();
        let other_agent = home.join("Library/LaunchAgents/com.example.agent.plist");
        std::fs::write(&other_agent, b"x").unwrap();
        let gone = remove(&home, &traces);
        assert_eq!(gone.len(), traces.len());
        assert!(traces.iter().all(|p| !p.exists()));
        assert!(keep.exists() && other_agent.exists());
        assert!(
            remove(&home, &traces).is_empty(),
            "a second pass finds nothing"
        );
    }

    #[test]
    fn the_cleanup_command_names_the_boot_service() {
        assert_eq!(
            boot_service_cleanup_command("satellite"),
            "sudo launchctl bootout system/com.lefi-crop.helperd-satellite; sudo rm -f /Library/LaunchDaemons/com.lefi-crop.helperd-satellite.plist"
        );
    }
}
