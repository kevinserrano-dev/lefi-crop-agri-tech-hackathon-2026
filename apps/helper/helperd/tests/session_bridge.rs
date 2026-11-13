//! The boot service cannot load LaunchAgents; `lefi-helperd session` does it for the installer
//! (ADR-040). Real agent binary, real bash function, FAKE launchctl and a temporary home.
#![cfg(target_os = "macos")]

use std::path::Path;
use std::process::{Command, Stdio};

fn repo() -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..")
}

#[test]
fn the_installer_loads_a_service_through_the_session_agent() {
    let d = tempfile::tempdir().unwrap();
    let home = d.path().join("home");
    let bin = d.path().join("bin");
    let data = d.path().join("data");
    std::fs::create_dir_all(home.join("Library/LaunchAgents")).unwrap();
    std::fs::create_dir_all(&bin).unwrap();
    // The service's folder exists while Lefi Crop is installed (without it the agent leaves).
    std::fs::create_dir_all(&data).unwrap();
    let calls = d.path().join("calls");
    let fake = bin.join("launchctl");
    // "Background" = the context of a boot service, outside the user's session.
    std::fs::write(
        &fake,
        format!(
            "#!/bin/sh\nif [ \"$1\" = managername ]; then echo Background; exit 0; fi\necho \"$*\" >>'{}'\necho fake-output\nexit 7\n",
            calls.display()
        ),
    )
    .unwrap();
    Command::new("chmod")
        .arg("755")
        .arg(&fake)
        .status()
        .unwrap();
    let path = format!("{}:/usr/bin:/bin", bin.display());
    let mut agent = Command::new(env!("CARGO_BIN_EXE_lefi-helperd"))
        .args(["session", "--data"])
        .arg(&data)
        .env("HOME", &home)
        .env("PATH", &path)
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    for _ in 0..50 {
        if data.join("session/alive").exists() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    let uid = String::from_utf8(Command::new("id").arg("-u").output().unwrap().stdout).unwrap();
    let uid = uid.trim();
    let plist = home.join("Library/LaunchAgents/com.lefi-crop.ollama.plist");
    let script = format!(
        r#". "$LEFI_ROOT/scripts/lib/common.sh"
lefi_launchd_ready && echo READY
lefi_launchctl bootstrap gui/{uid} "{p}"; echo "rc=$?"
lefi_launchctl bootout gui/{uid}/com.apple.Finder; echo "rc=$?"
"#,
        p = plist.display()
    );
    let out = Command::new("/bin/bash")
        .args(["-c", &script])
        .env("HOME", &home)
        .env("PATH", &path)
        .env("LEFI_ROOT", repo())
        .env("LEFI_SERVICE_MODE", "launchd")
        .env("LEFI_STATE_DIR", d.path().join("state"))
        .env("LEFI_SESSION_DIR", data.join("session"))
        .output()
        .unwrap();
    let _ = agent.kill();
    let _ = agent.wait();
    let text = String::from_utf8_lossy(&out.stdout);
    assert!(text.contains("READY"), "{text}");
    assert!(
        text.contains("fake-output") && text.contains("rc=7"),
        "exit code and output come back: {text}"
    );
    assert!(
        text.contains("rc=126"),
        "another service is refused: {text}"
    );
    let seen = std::fs::read_to_string(&calls).unwrap();
    assert!(seen.contains("bootstrap"), "{seen}");
    assert!(!seen.contains("Finder"), "{seen}");
}

#[test]
fn without_the_agent_nothing_is_ready() {
    let d = tempfile::tempdir().unwrap();
    let bin = d.path().join("bin");
    std::fs::create_dir_all(&bin).unwrap();
    let fake = bin.join("launchctl");
    std::fs::write(
        &fake,
        "#!/bin/sh\n[ \"$1\" = managername ] && echo Background\nexit 0\n",
    )
    .unwrap();
    Command::new("chmod")
        .arg("755")
        .arg(&fake)
        .status()
        .unwrap();
    let out = Command::new("/bin/bash")
        .args(["-c", r#". "$LEFI_ROOT/scripts/lib/common.sh"; lefi_launchd_ready; echo "ready=$?"; lefi_launchctl bootout gui/1/com.lefi-crop.x 2>/dev/null; echo "rc=$?""#])
        .env("HOME", d.path())
        .env("PATH", format!("{}:/usr/bin:/bin", bin.display()))
        .env("LEFI_ROOT", repo())
        .env("LEFI_SERVICE_MODE", "launchd")
        .env("LEFI_STATE_DIR", d.path().join("state"))
        .env("LEFI_SESSION_DIR", d.path().join("no-session"))
        .output()
        .unwrap();
    let text = String::from_utf8_lossy(&out.stdout);
    assert!(text.contains("ready=1") && text.contains("rc=5"), "{text}");
}

/// ADR-054: once Lefi Crop is erased, the agent removes its own LaunchAgent and unloads itself
/// (FAKE launchctl records the call) instead of recreating its folder.
#[test]
fn the_session_agent_leaves_when_lefi_crop_was_erased() {
    let d = tempfile::tempdir().unwrap();
    let home = d.path().join("home");
    let bin = d.path().join("bin");
    std::fs::create_dir_all(home.join("Library/LaunchAgents")).unwrap();
    std::fs::create_dir_all(&bin).unwrap();
    let own = home.join("Library/LaunchAgents/com.lefi-crop.helperd-session.plist");
    std::fs::write(&own, b"x").unwrap();
    let calls = d.path().join("calls");
    let fake = bin.join("launchctl");
    std::fs::write(
        &fake,
        format!("#!/bin/sh\necho \"$*\" >>'{}'\n", calls.display()),
    )
    .unwrap();
    Command::new("chmod")
        .arg("755")
        .arg(&fake)
        .status()
        .unwrap();
    let data = d.path().join("erased");
    let st = Command::new(env!("CARGO_BIN_EXE_lefi-helperd"))
        .args(["session", "--data"])
        .arg(&data)
        .env("HOME", &home)
        .env("PATH", format!("{}:/usr/bin:/bin", bin.display()))
        .stderr(Stdio::null())
        .status()
        .unwrap();
    assert!(st.success());
    assert!(!data.exists(), "its folder is not recreated");
    assert!(!own.exists(), "its LaunchAgent is removed");
    let seen = std::fs::read_to_string(&calls).unwrap();
    assert!(
        seen.contains("bootout gui/") && seen.contains("com.lefi-crop.helperd-session"),
        "{seen}"
    );
}
