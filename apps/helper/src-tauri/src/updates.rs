//! Updates (ADR-035): Lefi Crop Helper is the only updater. A signed `.lefiupdate` file (USB stick or
//! the Downloads folder) carries a newer Lefi Crop Helper.app, which carries every component. This
//! module finds and verifies such files, compares versions, and replaces the app.

use std::path::{Path, PathBuf};

use lefi_license::release::{newer, verify_manifest, ReleaseManifest};
use lefi_license::{parse_public_key, VerifyingKey};
use serde::Serialize;
use serde_json::{json, Value};
use tauri::State;

use crate::activation::Activation;
use crate::error::{Result, SetupError};
use crate::installer::Layout;

const RELEASE_PUB: &str = include_str!("../keys/release.pub");
const DEV_RELEASE_PUB: &str =
    include_str!("../../../../tools/lefi-license/dev-key/dev-release.pub");

fn err(code: &'static str, e: impl std::fmt::Display) -> SetupError {
    SetupError::new(code, e.to_string())
}

pub fn trusted_release_keys() -> Vec<VerifyingKey> {
    let mut k: Vec<_> = parse_public_key(RELEASE_PUB).into_iter().collect();
    if cfg!(debug_assertions) {
        k.extend(parse_public_key(DEV_RELEASE_PUB));
    }
    k
}

/// `CFBundleShortVersionString` of an app bundle.
pub fn bundle_version(app: &Path) -> Option<String> {
    let x = std::fs::read_to_string(app.join("Contents/Info.plist")).ok()?;
    let after = x.split("<key>CFBundleShortVersionString</key>").nth(1)?;
    Some(
        after
            .split("<string>")
            .nth(1)?
            .split("</string>")
            .next()?
            .trim()
            .to_string(),
    )
}

fn pyproject_version(p: &Path) -> Option<String> {
    std::fs::read_to_string(p).ok()?.lines().find_map(|l| {
        l.trim()
            .strip_prefix("version = \"")
            .and_then(|r| r.strip_suffix('"'))
            .map(str::to_string)
    })
}

/// The app bundle this process runs from (`…/Lefi Crop Helper.app`), when packaged.
pub fn current_app() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    exe.ancestors()
        .find(|p| p.extension().is_some_and(|e| e == "app"))
        .map(Path::to_path_buf)
}

/// Why this copy of the app must not install: services would point inside a disk image that goes
/// away, or a temporary copy macOS made of a quarantined app.
pub fn location_problem() -> Option<String> {
    let path = current_app()?.display().to_string();
    (path.starts_with("/Volumes/") || path.contains("/AppTranslocation/")).then(|| {
        "Lefi Crop Helper is not running from your Applications folder. Drag it to Applications, \
         open it from there and try again."
            .to_string()
    })
}

/// The user approved this app by opening it: what it carries (service, installer scripts, Lefi
/// Desktop) must not be stopped one by one by the quarantine mark of the download.
pub fn clear_quarantine() {
    if let Some(app) = current_app() {
        std::thread::spawn(move || {
            let _ = std::process::Command::new("xattr")
                .args(["-dr", "com.apple.quarantine"])
                .arg(app)
                .status();
        });
    }
}

fn installed_desktop() -> Option<(PathBuf, String)> {
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_default();
    [
        PathBuf::from("/Applications/Lefi Crop.app"),
        home.join("Applications/Lefi Crop.app"),
    ]
    .into_iter()
    .find_map(|p| bundle_version(&p).map(|v| (p, v)))
}

/// The running Brain's version (its health endpoint on this PC), if it answers.
async fn brain_version() -> Option<String> {
    let c = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(2))
        .build()
        .ok()?;
    let v: Value = c
        .get("http://127.0.0.1:8000/api/v1/health")
        .send()
        .await
        .ok()?
        .json()
        .await
        .ok()?;
    v["version"].as_str().map(str::to_string)
}

#[derive(Debug, Serialize)]
pub struct UpdateFile {
    pub path: String,
    pub manifest: Option<ReleaseManifest>,
    /// Why it cannot be installed (bad signature, older, licence…); None = installable.
    pub problem: Option<String>,
    pub problem_code: Option<String>,
}

fn tar_member(file: &Path, member: &str) -> Option<Vec<u8>> {
    let out = std::process::Command::new("tar")
        .arg("-xOf")
        .arg(file)
        .arg(member)
        .output()
        .ok()?;
    out.status.success().then_some(out.stdout)
}

/// Verifies a `.lefiupdate`: signature with the release keys, newer than this release, and
/// covered by the licence's support date (ADR-027 rule 2: only updates stop, never operation).
fn check_file(path: &Path, current_release: &str, support_until: Option<&str>) -> UpdateFile {
    let mut f = UpdateFile {
        path: path.display().to_string(),
        manifest: None,
        problem: None,
        problem_code: None,
    };
    let (Some(m), Some(sig)) = (
        tar_member(path, "manifest.json"),
        tar_member(path, "manifest.sig"),
    ) else {
        f.problem = Some("This file is not a Lefi Crop update.".into());
        f.problem_code = Some("UPDATE_MALFORMED".into());
        return f;
    };
    match verify_manifest(&m, &String::from_utf8_lossy(&sig), &trusted_release_keys()) {
        Err(e) => {
            f.problem = Some(e.to_string());
            f.problem_code = Some(e.code().into());
        }
        Ok(man) => {
            if !newer(&man.release, current_release) {
                f.problem = Some(format!(
                    "Release {} is not newer than the installed {current_release}.",
                    man.release
                ));
                f.problem_code = Some("UPDATE_NOT_NEWER".into());
            } else if let Some(s) = support_until {
                if man.released_at.as_str() > s {
                    f.problem = Some(format!(
                        "Your support ended on {s}; this release is from {}. Lefi Crop keeps working; contact Lefi to renew updates.",
                        man.released_at
                    ));
                    f.problem_code = Some("UPDATE_NOT_COVERED".into());
                }
            }
            f.manifest = Some(man);
        }
    }
    f
}

/// Candidate files: the Downloads folder and the top of every mounted volume (USB sticks).
fn candidates() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = vec![];
    if let Some(h) = std::env::var_os("HOME") {
        dirs.push(PathBuf::from(h).join("Downloads"));
    }
    if let Ok(rd) = std::fs::read_dir("/Volumes") {
        dirs.extend(rd.flatten().map(|e| e.path()));
    }
    let mut out = vec![];
    for d in dirs {
        if let Ok(rd) = std::fs::read_dir(&d) {
            for e in rd.flatten() {
                let p = e.path();
                if p.extension().is_some_and(|x| x == "lefiupdate") && p.is_file() {
                    out.push(p);
                }
            }
        }
    }
    out.sort();
    out
}

#[tauri::command]
pub async fn updates_status(activation: State<'_, Activation>) -> Result<Value> {
    let layout = Layout::locate()?;
    let release = std::fs::read_to_string(layout.root.join("VERSION"))
        .unwrap_or_default()
        .trim()
        .to_string();
    let bundled_brain = pyproject_version(&layout.root.join("services/brain/pyproject.toml"));
    let bundled_desktop =
        bundle_version(&layout.root.join("desktop/Lefi Crop.app")).or_else(|| {
            bundle_version(
                &layout
                    .root
                    .join("apps/desktop/src-tauri/target/release/bundle/macos/Lefi Crop.app"),
            )
        });
    let desktop = installed_desktop();
    let brain = brain_version().await;
    let support = activation.status()?.licence.map(|l| l.support_until);
    let files: Vec<UpdateFile> = candidates()
        .iter()
        .map(|p| check_file(p, &release, support.as_deref()))
        .collect();
    let mut components = vec![];
    if let (Some((_, have)), Some(avail)) = (&desktop, &bundled_desktop) {
        components.push(json!({ "component": "desktop", "installed": have, "available": avail, "outdated": newer(avail, have) }));
    }
    if let (Some(have), Some(avail)) = (&brain, &bundled_brain) {
        components.push(json!({ "component": "brain", "installed": have, "available": avail, "outdated": newer(avail, have) }));
    }
    Ok(json!({
        "release": release,
        "helper": env!("CARGO_PKG_VERSION"),
        "packaged": current_app().is_some(),
        "support_until": support,
        "installed": { "brain": brain, "desktop": desktop.map(|(p, v)| json!({"path": p, "version": v})) },
        "bundled": { "brain": bundled_brain, "desktop": bundled_desktop },
        "components": components,
        "files": files,
        "release_key_embedded": parse_public_key(RELEASE_PUB).is_ok(),
    }))
}

/// Replaces this Lefi Crop Helper.app with the one inside a verified `.lefiupdate`, keeps the old one
/// next to it (`Lefi Crop Helper.app.previous`), then opens the new version and quits.
#[tauri::command]
pub async fn apply_helper_update(
    path: String,
    app: tauri::AppHandle,
    activation: State<'_, Activation>,
) -> Result<Value> {
    let current = current_app().ok_or_else(|| {
        SetupError::new(
            "ONLY_PACKAGED",
            "Updates install only into the packaged Lefi Crop Helper app, not a development build.",
        )
    })?;
    let layout = Layout::locate()?;
    let release = std::fs::read_to_string(layout.root.join("VERSION"))
        .unwrap_or_default()
        .trim()
        .to_string();
    let support = activation.status()?.licence.map(|l| l.support_until);
    let installed = install_app_update(Path::new(&path), &current, &release, support.as_deref())?;
    let _ = std::process::Command::new("open")
        .arg("-n")
        .arg(&current)
        .spawn();
    app.exit(0);
    Ok(json!({ "release": installed }))
}

/// Verifies `file` again, checks the app against its signed checksum and swaps it into
/// `current` (an `.app` folder), keeping the old one as `<name>.app.previous`; on any failure the
/// running version is put back. Returns the installed release.
pub fn install_app_update(
    file: &Path,
    current: &Path,
    release: &str,
    support: Option<&str>,
) -> Result<String> {
    let checked = check_file(file, release, support);
    if let Some(p) = checked.problem {
        let code: &'static str = match checked.problem_code.as_deref() {
            Some("UPDATE_NOT_NEWER") => "UPDATE_NOT_NEWER",
            Some("UPDATE_NOT_COVERED") => "UPDATE_NOT_COVERED",
            Some("UPDATE_BAD_SIGNATURE") => "UPDATE_BAD_SIGNATURE",
            Some("UPDATE_UNKNOWN_KEY") => "UPDATE_UNKNOWN_KEY",
            _ => "UPDATE_MALFORMED",
        };
        return Err(SetupError::new(code, p));
    }
    let man = checked.manifest.expect("verified");
    let n = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let tmp = std::env::temp_dir().join(format!("lefi-update-{}-{n}", std::process::id()));
    std::fs::create_dir_all(&tmp).map_err(|e| err("UPDATE_EXTRACT", e))?;
    let result = (|| {
        let tgz = tar_member(file, "app.tar.gz")
            .ok_or_else(|| SetupError::new("UPDATE_MALFORMED", "No app inside the update."))?;
        if lefi_helperd::ca::fingerprint(&tgz) != man.app_sha256 {
            return Err(SetupError::new(
                "UPDATE_BAD_SIGNATURE",
                "The app inside the update does not match its signed checksum.",
            ));
        }
        std::fs::write(tmp.join("app.tar.gz"), &tgz).map_err(|e| err("UPDATE_EXTRACT", e))?;
        let st = std::process::Command::new("tar")
            .arg("-xzf")
            .arg(tmp.join("app.tar.gz"))
            .arg("-C")
            .arg(&tmp)
            .status()
            .map_err(|e| err("UPDATE_EXTRACT", e))?;
        let new_app = tmp.join("Lefi Crop Helper.app");
        if !st.success() || !new_app.join("Contents/MacOS/lefi-helper").is_file() {
            return Err(SetupError::new(
                "UPDATE_MALFORMED",
                "The update does not contain Lefi Crop Helper.",
            ));
        }
        // macOS marks files from the internet; this one was verified with the release key.
        let _ = std::process::Command::new("xattr")
            .args(["-dr", "com.apple.quarantine"])
            .arg(&new_app)
            .status();
        let previous = current.with_extension("app.previous");
        let _ = std::fs::remove_dir_all(&previous);
        std::fs::rename(current, &previous).map_err(|e| {
            SetupError::new(
                "UPDATE_NEEDS_ADMIN",
                format!("Cannot replace {}: {e}", current.display()),
            )
            .with_hint(
                "Move Lefi Crop Helper to /Applications (or a folder you can write) and try again.",
            )
        })?;
        let copied = std::process::Command::new("ditto")
            .arg(&new_app)
            .arg(current)
            .status()
            .map(|s| s.success());
        if !matches!(copied, Ok(true)) {
            let _ = std::fs::remove_dir_all(current);
            let _ = std::fs::rename(&previous, current); // put the running version back
            return Err(SetupError::new(
                "UPDATE_EXTRACT",
                "Could not copy the new Lefi Crop Helper; the current version was kept.",
            ));
        }
        Ok(man.release.clone())
    })();
    let _ = std::fs::remove_dir_all(&tmp);
    result
}

/// Update preferences (`<data>/updates.json`). Default: manual approval (owner, 2026-11-06).
#[derive(Debug, Clone, Default, Serialize, serde::Deserialize)]
pub struct UpdateSettings {
    /// Apply component updates (Lefi Desktop) without asking. Replacing Lefi Crop Helper itself and
    /// updating the Brain always ask in this version.
    pub auto_components: bool,
}

fn settings_path(a: &Activation) -> Result<PathBuf> {
    Ok(PathBuf::from(a.status()?.data_dir).join("updates.json"))
}

#[tauri::command]
pub fn update_settings(activation: State<'_, Activation>) -> Result<UpdateSettings> {
    let p = settings_path(&activation)?;
    Ok(std::fs::read(p)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default())
}

#[tauri::command]
pub fn set_update_settings(
    settings: UpdateSettings,
    activation: State<'_, Activation>,
) -> Result<UpdateSettings> {
    let p = settings_path(&activation)?;
    std::fs::write(&p, serde_json::to_vec_pretty(&settings).unwrap_or_default())
        .map_err(|e| err("SETTINGS_WRITE", e))?;
    Ok(settings)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The app aborted right after activation: the first HTTP client had no TLS provider. This
    /// runs what `run()` does at startup, then builds that client (no Brain needed: None is fine).
    #[tokio::test]
    async fn the_http_client_can_be_built_after_startup() {
        lefi_helperd::init_crypto();
        let _ = brain_version().await;
    }

    #[test]
    fn reads_versions_from_bundles_and_pyproject() {
        let d = tempfile_dir();
        std::fs::create_dir_all(d.join("A.app/Contents")).unwrap();
        std::fs::write(
            d.join("A.app/Contents/Info.plist"),
            "<dict><key>CFBundleShortVersionString</key>\n  <string>1.2.3</string></dict>",
        )
        .unwrap();
        assert_eq!(bundle_version(&d.join("A.app")).as_deref(), Some("1.2.3"));
        std::fs::write(
            d.join("pyproject.toml"),
            "[project]\nname = \"x\"\nversion = \"0.4.0\"\n",
        )
        .unwrap();
        assert_eq!(
            pyproject_version(&d.join("pyproject.toml")).as_deref(),
            Some("0.4.0")
        );
        assert!(check_file(&d.join("nope.lefiupdate"), "0.1.0", None)
            .problem
            .is_some());
        let _ = std::fs::remove_dir_all(d);
    }

    fn tempfile_dir() -> PathBuf {
        let n = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let d = std::env::temp_dir().join(format!("lefi-upd-test-{n}"));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    /// A FAKE "Lefi Crop Helper.app" whose executable is a text marker.
    fn fake_app(dir: &Path, marker: &str) -> PathBuf {
        let app = dir.join("Lefi Crop Helper.app");
        std::fs::create_dir_all(app.join("Contents/MacOS")).unwrap();
        std::fs::write(app.join("Contents/MacOS/lefi-helper"), marker).unwrap();
        app
    }

    /// Packs `app` like `lefi-license release-pack`, signed with `key`; `tamper` changes the app
    /// after signing.
    fn pack(
        dir: &Path,
        app: &Path,
        release: &str,
        key: &lefi_license::issue::SigningKey,
        tamper: bool,
    ) -> PathBuf {
        use lefi_license::release::{sign::sign_manifest, Components, ReleaseManifest};
        let w = dir.join(format!("w-{release}-{tamper}"));
        std::fs::create_dir_all(&w).unwrap();
        let ok = std::process::Command::new("tar")
            .arg("-czf")
            .arg(w.join("app.tar.gz"))
            .arg("-C")
            .arg(app.parent().unwrap())
            .arg("Lefi Crop Helper.app")
            .env("COPYFILE_DISABLE", "1")
            .status()
            .unwrap()
            .success();
        assert!(ok);
        let bytes = std::fs::read(w.join("app.tar.gz")).unwrap();
        let m = ReleaseManifest {
            v: 1,
            release: release.into(),
            released_at: "2026-11-06".into(),
            security: false,
            notes: "fake test release".into(),
            components: Components::default(),
            app_sha256: lefi_helperd::ca::fingerprint(&bytes),
            app_size: bytes.len() as u64,
            key_id: String::new(),
        };
        let (mb, sig) = sign_manifest(m, key);
        std::fs::write(w.join("manifest.json"), mb).unwrap();
        std::fs::write(w.join("manifest.sig"), sig).unwrap();
        if tamper {
            std::fs::write(w.join("app.tar.gz"), b"not the signed app").unwrap();
        }
        let out = dir.join(format!("LefiCrop-{release}-{tamper}.lefiupdate"));
        assert!(std::process::Command::new("tar")
            .arg("-cf")
            .arg(&out)
            .arg("-C")
            .arg(&w)
            .args(["manifest.json", "manifest.sig", "app.tar.gz"])
            .status()
            .unwrap()
            .success());
        out
    }

    #[test]
    fn a_signed_newer_update_replaces_the_app_and_keeps_the_previous_one() {
        let dev = lefi_license::issue::parse_signing_key(include_str!(
            "../../../../tools/lefi-license/dev-key/dev-release.seed"
        ))
        .unwrap();
        let other = lefi_license::issue::generate_key().unwrap();
        let root = tempfile_dir();
        let new_src = fake_app(&root.join("new"), "NEW");
        let installed = fake_app(&root.join("Applications"), "OLD");
        let marker =
            |p: &Path| std::fs::read_to_string(p.join("Contents/MacOS/lefi-helper")).unwrap();

        let same = pack(&root, &new_src, "0.2.0", &dev, false);
        assert_eq!(
            install_app_update(&same, &installed, "0.2.0", None)
                .unwrap_err()
                .code,
            "UPDATE_NOT_NEWER"
        );
        let good = pack(&root, &new_src, "0.3.0", &dev, false);
        assert_eq!(
            install_app_update(&good, &installed, "0.2.0", Some("2026-01-01"))
                .unwrap_err()
                .code,
            "UPDATE_NOT_COVERED"
        );
        let bad = pack(&root, &new_src, "0.3.0", &dev, true);
        assert_eq!(
            install_app_update(&bad, &installed, "0.2.0", None)
                .unwrap_err()
                .code,
            "UPDATE_BAD_SIGNATURE"
        );
        let foreign = pack(&root, &new_src, "0.4.0", &other, false);
        assert_eq!(
            install_app_update(&foreign, &installed, "0.2.0", None)
                .unwrap_err()
                .code,
            "UPDATE_UNKNOWN_KEY"
        );
        assert_eq!(
            marker(&installed),
            "OLD",
            "refused updates leave the app untouched"
        );

        assert_eq!(
            install_app_update(&good, &installed, "0.2.0", Some("2027-12-31")).unwrap(),
            "0.3.0"
        );
        assert_eq!(marker(&installed), "NEW");
        assert_eq!(
            marker(&installed.with_extension("app.previous")),
            "OLD",
            "the previous version is kept"
        );
        let _ = std::fs::remove_dir_all(root);
    }
}
