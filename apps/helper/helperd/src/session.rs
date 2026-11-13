//! `lefi-helperd session` (ADR-040): a small agent inside the user's GUI session. LaunchAgents can
//! only be loaded from that session, and the boot-time service runs outside it, so the installer
//! leaves requests in `<data>/session/` and this agent runs them. It has the same rights as the
//! user who owns that folder and accepts only `launchctl` on `com.lefi-crop.*` services of this
//! user's GUI domain; anything else is refused.

use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::error::{io, Result};

fn valid_label(l: &str) -> bool {
    match l.strip_prefix("com.lefi-crop.") {
        Some(rest) => {
            !rest.is_empty()
                && !rest.starts_with("helperd")
                && rest
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        }
        None => false,
    }
}

/// `gui/UID/label` → true when it names an allowed service of this user.
fn valid_target(t: &str, uid: &str) -> bool {
    t.strip_prefix(&format!("gui/{uid}/"))
        .is_some_and(valid_label)
}

/// The `launchctl` arguments a request may use. `None`: refused.
pub fn check_request(args: &[String], uid: &str, home: &Path) -> Option<Vec<String>> {
    let a: Vec<&str> = args.iter().map(String::as_str).collect();
    let ok = match a.as_slice() {
        ["bootstrap", d, plist] => {
            let name = Path::new(plist)
                .file_name()
                .and_then(|n| n.to_str())
                .and_then(|n| n.strip_suffix(".plist"))
                .unwrap_or("");
            *d == format!("gui/{uid}")
                && valid_label(name)
                && Path::new(plist)
                    == home
                        .join("Library/LaunchAgents")
                        .join(format!("{name}.plist"))
        }
        ["bootout" | "enable" | "disable" | "print", t] => valid_target(t, uid),
        ["kickstart", "-k", t] | ["kickstart", t] => valid_target(t, uid),
        _ => false,
    };
    ok.then(|| args.to_vec())
}

fn answer(dir: &Path, stem: &str, code: i32, text: &str) {
    let tmp = dir.join(format!("{stem}.restmp"));
    if std::fs::write(&tmp, format!("{code}\n{text}")).is_ok() {
        let _ = std::fs::rename(&tmp, dir.join(format!("{stem}.res")));
    }
}

fn handle(dir: &Path, req: &Path, uid: &str, home: &Path) {
    let stem = req
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("x")
        .to_string();
    let args: Vec<String> = std::fs::read_to_string(req)
        .unwrap_or_default()
        .lines()
        .map(str::to_string)
        .collect();
    let _ = std::fs::remove_file(req);
    let Some(ok) = check_request(&args, uid, home) else {
        eprintln!("session: refused {args:?}");
        answer(dir, &stem, 126, "refused by the Lefi Crop session helper\n");
        return;
    };
    match std::process::Command::new("launchctl").args(&ok).output() {
        Ok(o) => {
            let mut text = String::from_utf8_lossy(&o.stdout).to_string();
            text.push_str(&String::from_utf8_lossy(&o.stderr));
            answer(dir, &stem, o.status.code().unwrap_or(1), &text);
        }
        Err(e) => answer(dir, &stem, 127, &format!("{e}\n")),
    }
}

/// One pass over the folder: marks the agent alive and answers what is waiting.
pub fn tick(dir: &Path, uid: &str, home: &Path) {
    let _ = std::fs::write(dir.join("alive"), b"");
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let reqs: Vec<PathBuf> = entries
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|x| x == "req"))
        .collect();
    for r in reqs {
        handle(dir, &r, uid, home);
    }
}

/// Lefi Crop was erased from this PC (ADR-054): the agent removes its own LaunchAgent and asks
/// launchd to unload it (which ends this process), so nothing is restarted or left behind.
fn leave(uid: &str, home: &Path) {
    eprintln!("lefi-helperd session: Lefi Crop was erased from this PC; leaving");
    let _ = std::fs::remove_file(
        home.join("Library/LaunchAgents")
            .join(format!("{}.plist", crate::service::SESSION_LABEL)),
    );
    let _ = std::process::Command::new("launchctl")
        .args([
            "bootout",
            &format!("gui/{uid}/{}", crate::service::SESSION_LABEL),
        ])
        .status();
}

pub async fn run(data: &Path) -> Result<()> {
    let uid = std::process::Command::new("id")
        .arg("-u")
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .map_err(io("SESSION_DIR"))?;
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_default();
    if !data.is_dir() {
        leave(&uid, &home);
        return Ok(());
    }
    let dir = data.join("session");
    std::fs::create_dir_all(&dir).map_err(io("SESSION_DIR"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700));
    }
    eprintln!("lefi-helperd session: {}", dir.display());
    loop {
        if !data.is_dir() {
            leave(&uid, &home);
            return Ok(());
        }
        tick(&dir, &uid, &home);
        tokio::time::sleep(Duration::from_millis(300)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(a: &[&str]) -> Vec<String> {
        a.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn only_lefi_services_of_this_user_are_accepted() {
        let h = Path::new("/Users/fake");
        let plist = "/Users/fake/Library/LaunchAgents/com.lefi-crop.ollama.plist";
        assert!(check_request(&v(&["bootstrap", "gui/501", plist]), "501", h).is_some());
        assert!(check_request(&v(&["bootout", "gui/501/com.lefi-crop.brain"]), "501", h).is_some());
        assert!(check_request(
            &v(&["kickstart", "-k", "gui/501/com.lefi-crop.brain"]),
            "501",
            h
        )
        .is_some());
        for bad in [
            v(&["bootstrap", "gui/501", "/tmp/com.lefi-crop.ollama.plist"]),
            v(&["bootstrap", "gui/502", plist]),
            v(&["bootstrap", "system", plist]),
            v(&["bootout", "gui/501/com.apple.Finder"]),
            v(&["bootout", "gui/502/com.lefi-crop.brain"]),
            v(&["bootout", "gui/501/com.lefi-crop.helperd-satellite"]),
            v(&["bootout", "gui/501/com.lefi-crop.x/../y"]),
            v(&["remove", "com.lefi-crop.brain"]),
            v(&[]),
        ] {
            assert!(check_request(&bad, "501", h).is_none(), "{bad:?}");
        }
    }

    #[test]
    fn a_refused_request_is_answered_and_removed() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(
            d.path().join("a1.req"),
            "bootout\ngui/501/com.apple.Finder\n",
        )
        .unwrap();
        tick(d.path(), "501", Path::new("/Users/fake"));
        assert!(!d.path().join("a1.req").exists());
        let res = std::fs::read_to_string(d.path().join("a1.res")).unwrap();
        assert!(res.starts_with("126\n"), "{res}");
        assert!(d.path().join("alive").exists());
    }
}
