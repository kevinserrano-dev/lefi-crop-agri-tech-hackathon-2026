//! Registers `lefi-helperd` with the OS so it runs without the Lefi Crop Helper window (macOS).
//! - **At boot** (default for customers, owner Q7): a LaunchDaemon in /Library/LaunchDaemons
//!   that runs as the given user (`UserName`), so it starts when the Mac powers on, before
//!   anyone logs in. Installing it needs administrator rights (sudo / the macOS password dialog).
//! - **At login** (fallback, no administrator rights): a user LaunchAgent.
//!
//! Linux (systemd) and Windows are tech debt (ADR-033).

use std::path::{Path, PathBuf};

use crate::error::{io, Error, Result};

pub fn label(mode: &str) -> String {
    format!("com.lefi-crop.helperd-{mode}")
}

/// Where the service is registered.
#[derive(Debug, Clone, PartialEq)]
pub enum Scope {
    /// LaunchDaemon, runs at boot as this user (needs root to install).
    Boot { user: String, home: PathBuf },
    /// LaunchAgent of the current user, runs at login.
    Login,
}

fn agent_path(mode: &str) -> Result<PathBuf> {
    let home = std::env::var_os("HOME").ok_or_else(|| Error::new("NO_HOME", "HOME is not set"))?;
    Ok(PathBuf::from(home)
        .join("Library/LaunchAgents")
        .join(format!("{}.plist", label(mode))))
}

pub const SESSION_LABEL: &str = "com.lefi-crop.helperd-session";

/// The agent inside the user's session that loads LaunchAgents for the boot service (ADR-040).
pub fn session_plist(exe: &Path, data: &Path) -> String {
    let log = data.join("logs").join("helperd-session.log");
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>{SESSION_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>{exe}</string>
    <string>session</string>
    <string>--data</string>
    <string>{data}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>{log}</string>
  <key>StandardErrorPath</key><string>{log}</string>
</dict>
</plist>
"#,
        exe = xml_escape(&exe.display().to_string()),
        data = xml_escape(&data.display().to_string()),
        log = xml_escape(&log.display().to_string()),
    )
}

/// As root, for the user the boot service runs as. If nobody is logged in now, macOS loads it at
/// that user's next login; until then services cannot be loaded and the installer says so.
fn install_session_agent(exe: &Path, data: &Path, user: &str, home: &Path) -> Result<()> {
    let dir = home.join("Library/LaunchAgents");
    std::fs::create_dir_all(&dir).map_err(io("SERVICE_WRITE"))?;
    let p = dir.join(format!("{SESSION_LABEL}.plist"));
    std::fs::write(&p, session_plist(exe, data)).map_err(io("SERVICE_WRITE"))?;
    let session = data.join("session");
    std::fs::create_dir_all(&session).map_err(io("SERVICE_WRITE"))?;
    for path in [&p, &session] {
        let _ = std::process::Command::new("chown")
            .arg(user)
            .arg(path)
            .status();
    }
    let uid = std::process::Command::new("id")
        .args(["-u", user])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .map_err(io("SERVICE_WRITE"))?;
    let _ = launchctl(&[
        "asuser",
        &uid,
        "launchctl",
        "bootout",
        &format!("gui/{uid}/{SESSION_LABEL}"),
    ]);
    let out = launchctl(&[
        "asuser",
        &uid,
        "launchctl",
        "bootstrap",
        &format!("gui/{uid}"),
        &p.display().to_string(),
    ]);
    if !out.status.success() {
        eprintln!(
            "session helper loads at the next login ({})",
            String::from_utf8_lossy(&out.stderr).trim()
        );
    }
    Ok(())
}

fn daemon_path(mode: &str) -> PathBuf {
    PathBuf::from("/Library/LaunchDaemons").join(format!("{}.plist", label(mode)))
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// The file whose presence keeps a satellite's service alive: its enrolment.
pub fn satellite_marker(data: &Path) -> PathBuf {
    data.join("node").join("config.json")
}

pub fn plist(mode: &str, exe: &Path, data: &Path, extra: &[String], scope: &Scope) -> String {
    let mut args = vec![
        exe.display().to_string(),
        mode.to_string(),
        "--data".into(),
        data.display().to_string(),
    ];
    args.extend(extra.iter().cloned());
    let args_xml: String = args
        .iter()
        .map(|a| format!("    <string>{}</string>\n", xml_escape(a)))
        .collect();
    let log = data.join("logs").join(format!("helperd-{mode}.log"));
    // A daemon has no login session: give it its user and that user's HOME and a usable PATH
    // (the installer it runs needs Homebrew and the user's folders).
    let identity = match scope {
        Scope::Boot { user, home } => format!(
            "  <key>UserName</key><string>{u}</string>\n  <key>EnvironmentVariables</key>\n  <dict>\n    <key>HOME</key><string>{h}</string>\n    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>\n  </dict>\n",
            u = xml_escape(user),
            h = xml_escape(&home.display().to_string()),
        ),
        Scope::Login => String::new(),
    };
    // A satellite runs while it belongs to an installation: once erased (ADR-054) its folder is
    // gone and launchd neither restarts it nor starts it at boot, although the root-owned file of
    // a boot service stays until an administrator removes it.
    let keep_alive = if mode == "satellite" {
        format!(
            "  <key>KeepAlive</key><dict><key>PathState</key><dict><key>{}</key><true/></dict></dict>\n",
            xml_escape(&satellite_marker(data).display().to_string())
        )
    } else {
        "  <key>RunAtLoad</key><true/>\n  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>\n"
            .to_string()
    };
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>{label}</string>
  <key>ProgramArguments</key>
  <array>
{args_xml}  </array>
{identity}{keep_alive}  <key>StandardOutPath</key><string>{log}</string>
  <key>StandardErrorPath</key><string>{log}</string>
</dict>
</plist>
"#,
        label = label(mode),
        log = xml_escape(&log.display().to_string()),
    )
}

fn uid() -> String {
    std::process::Command::new("id")
        .arg("-u")
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default()
}

fn is_root() -> bool {
    uid() == "0"
}

/// The home folder of `user` (Directory Service), for the daemon's environment.
pub fn home_of(user: &str) -> Result<PathBuf> {
    if !user
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.')
        || user.is_empty()
    {
        return Err(Error::new("USAGE", "Not a user name."));
    }
    let out = std::process::Command::new("dscl")
        .args([".", "-read", &format!("/Users/{user}"), "NFSHomeDirectory"])
        .output()
        .map_err(io("NO_HOME"))?;
    let s = String::from_utf8_lossy(&out.stdout);
    s.split_whitespace()
        .nth(1)
        .map(PathBuf::from)
        .ok_or_else(|| Error::new("NO_HOME", format!("No home folder for user {user}")))
}

fn launchctl(args: &[&str]) -> std::process::Output {
    std::process::Command::new("launchctl")
        .args(args)
        .output()
        .unwrap_or_else(|_| std::process::Output {
            status: std::os::unix::process::ExitStatusExt::from_raw(1),
            stdout: vec![],
            stderr: b"launchctl not found".to_vec(),
        })
}

pub fn install(
    mode: &str,
    exe: &Path,
    data: &Path,
    extra: &[String],
    scope: &Scope,
) -> Result<PathBuf> {
    if !cfg!(target_os = "macos") {
        return Err(Error::new(
            "UNSUPPORTED_OS",
            "Registering the service is macOS-only for now (tech debt, ADR-033).",
        ));
    }
    std::fs::create_dir_all(data.join("logs")).map_err(io("SERVICE_WRITE"))?;
    let (p, domain) = match scope {
        Scope::Boot { user, .. } => {
            if !is_root() {
                return Err(Error::new(
                    "NEEDS_ROOT",
                    "Starting at boot needs administrator rights (run with sudo).",
                ));
            }
            // The log folder belongs to the user the daemon runs as.
            let _ = std::process::Command::new("chown")
                .args(["-R", user])
                .arg(data.join("logs"))
                .status();
            (daemon_path(mode), "system".to_string())
        }
        Scope::Login => {
            let p = agent_path(mode)?;
            std::fs::create_dir_all(p.parent().expect("LaunchAgents folder"))
                .map_err(io("SERVICE_WRITE"))?;
            (p, format!("gui/{}", uid()))
        }
    };
    std::fs::write(&p, plist(mode, exe, data, extra, scope)).map_err(io("SERVICE_WRITE"))?;
    if matches!(scope, Scope::Boot { .. }) {
        let _ = std::process::Command::new("chown")
            .args(["root:wheel"])
            .arg(&p)
            .status();
        let _ = std::process::Command::new("chmod")
            .args(["644"])
            .arg(&p)
            .status();
    }
    let _ = launchctl(&["bootout", &format!("{domain}/{}", label(mode))]);
    let mut out = launchctl(&["bootstrap", &domain, &p.display().to_string()]);
    if !out.status.success() {
        // launchd may still be finishing the bootout.
        std::thread::sleep(std::time::Duration::from_secs(2));
        out = launchctl(&["bootstrap", &domain, &p.display().to_string()]);
    }
    if !out.status.success() {
        return Err(Error::new(
            "SERVICE_START",
            String::from_utf8_lossy(&out.stderr).trim().to_string(),
        ));
    }
    if let Scope::Boot { user, home } = scope {
        install_session_agent(exe, data, user, home)?;
    }
    Ok(p)
}

/// Removes the service in the given scope (the boot one needs root).
pub fn uninstall(mode: &str, scope_boot: bool) -> Result<()> {
    if scope_boot {
        if !is_root() {
            return Err(Error::new(
                "NEEDS_ROOT",
                "Removing the boot service needs administrator rights.",
            ));
        }
        let _ = launchctl(&["bootout", &format!("system/{}", label(mode))]);
        let p = daemon_path(mode);
        if p.exists() {
            std::fs::remove_file(&p).map_err(io("SERVICE_WRITE"))?;
        }
        return Ok(());
    }
    let p = agent_path(mode)?;
    let _ = launchctl(&["bootout", &format!("gui/{}/{}", uid(), label(mode))]);
    if p.exists() {
        std::fs::remove_file(&p).map_err(io("SERVICE_WRITE"))?;
    }
    // The session helper exists only for a boot service; none left on this PC, none needed.
    if !daemon_path("main").exists() && !daemon_path("satellite").exists() {
        let _ = launchctl(&["bootout", &format!("gui/{}/{SESSION_LABEL}", uid())]);
        if let Some(h) = std::env::var_os("HOME") {
            let _ = std::fs::remove_file(
                PathBuf::from(h)
                    .join("Library/LaunchAgents")
                    .join(format!("{SESSION_LABEL}.plist")),
            );
        }
    }
    Ok(())
}

/// boot · login · none
pub fn registered(mode: &str) -> &'static str {
    if daemon_path(mode).exists() {
        "boot"
    } else if agent_path(mode).map(|p| p.exists()).unwrap_or(false) {
        "login"
    } else {
        "none"
    }
}

pub fn is_loaded(mode: &str) -> bool {
    launchctl(&["print", &format!("system/{}", label(mode))])
        .status
        .success()
        || launchctl(&["print", &format!("gui/{}/{}", uid(), label(mode))])
            .status
            .success()
}

/// Quotes a word for `/bin/sh` (single quotes).
pub fn sh_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

/// The AppleScript that runs `command` through the macOS administrator password dialog.
pub fn admin_applescript(command: &str, prompt: &str) -> String {
    let esc = |s: &str| s.replace('\\', "\\\\").replace('"', "\\\"");
    format!(
        "do shell script \"{}\" with prompt \"{}\" with administrator privileges",
        esc(command),
        esc(prompt)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn login_plist_runs_the_given_mode_and_escapes_paths() {
        let x = plist(
            "satellite",
            Path::new("/opt/a&b/lefi-helperd"),
            Path::new("/tmp/d"),
            &[],
            &Scope::Login,
        );
        assert!(x.contains("<string>com.lefi-crop.helperd-satellite</string>"));
        assert!(x.contains("<string>/opt/a&amp;b/lefi-helperd</string>"));
        assert!(x.contains("<string>satellite</string>"));
        assert!(!x.contains("UserName"));
        // Kept alive only while it is enrolled: erased, it is neither restarted nor started at boot.
        assert!(x.contains("<key>PathState</key><dict><key>/tmp/d/node/config.json</key><true/>"));
        assert!(!x.contains("RunAtLoad") && !x.contains("SuccessfulExit"));
    }

    #[test]
    fn boot_plist_runs_as_the_user_with_its_home() {
        let scope = Scope::Boot {
            user: "fakeuser".into(),
            home: PathBuf::from("/Users/fakeuser"),
        };
        let x = plist(
            "main",
            Path::new("/Applications/Lefi Crop Helper.app/Contents/MacOS/lefi-helperd"),
            Path::new("/tmp/d"),
            &["--payload-root".into(), "/x".into()],
            &scope,
        );
        assert!(x.contains("<key>UserName</key><string>fakeuser</string>"));
        assert!(x.contains("<key>HOME</key><string>/Users/fakeuser</string>"));
        assert!(x.contains("<string>--payload-root</string>"));
        assert!(x.contains("/opt/homebrew/bin"));
        assert!(x.contains("<key>SuccessfulExit</key><false/>") && !x.contains("PathState"));
    }

    #[test]
    fn shell_and_applescript_quoting() {
        assert_eq!(sh_quote("/Users/a b/it's"), "'/Users/a b/it'\\''s'");
        let s = admin_applescript("echo \"x\" 'y'", "Lefi");
        assert!(s.starts_with("do shell script \"echo \\\"x\\\" 'y'\""));
        assert!(s.ends_with("with administrator privileges"));
        assert!(home_of("bad name;").is_err());
    }
}
