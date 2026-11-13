//! `lefi-license` — staff tool that issues LEFI CROP activation codes (INSTALLER.md §9.5).
//!
//!   lefi-license keygen [--dir DIR]
//!   lefi-license issue --installation ID --customer NAME --max-pcs N --support-until YYYY-MM-DD
//!                      [--edition standard] [--dir DIR] [--dev]
//!   lefi-license verify CODE --installation ID [--dir DIR] [--dev]
//!
//! DIR defaults to ~/.lefi-license: signing.key (600, NEVER in git), signing.pub, register.ndjson.
//! `--dev` uses the development key in this repository; Lefi Crop Helper release builds reject it.

use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::process::ExitCode;

use lefi_license::issue::{
    encode_signing_key, generate_key, parse_signing_key, random_licence_id, sign, today_utc,
};
use lefi_license::{
    encode_public_key, is_date, key_id, normalize_installation_id, parse_public_key, verify,
    Licence,
};

const DEV_SEED: &str = include_str!("../dev-key/dev-signing.seed");
const DEV_RELEASE_SEED: &str = include_str!("../dev-key/dev-release.seed");

const USAGE: &str = "usage:
  lefi-license keygen [--dir DIR]
  lefi-license issue --installation ID --customer NAME --max-pcs N --support-until YYYY-MM-DD [--edition E] [--dir DIR] [--dev]
  lefi-license verify CODE --installation ID [--dir DIR] [--dev]
  lefi-license release-keygen [--dir DIR]                       (default ~/.lefi-release)
  lefi-license release-pack --app APP --out DIR [--notes TEXT] [--security yes] [--dir DIR] [--dev]
  lefi-license release-verify FILE [--dev]";

fn main() -> ExitCode {
    match run(std::env::args().skip(1).collect()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("error: {e}");
            ExitCode::FAILURE
        }
    }
}

fn parse_flags(args: &[String]) -> Result<(Vec<String>, HashMap<String, String>), String> {
    let (mut pos, mut flags) = (Vec::new(), HashMap::new());
    let mut it = args.iter();
    while let Some(a) = it.next() {
        if let Some(name) = a.strip_prefix("--") {
            if name == "dev" {
                flags.insert("dev".into(), "1".into());
            } else {
                let v = it.next().ok_or(format!("--{name} needs a value"))?;
                flags.insert(name.to_string(), v.clone());
            }
        } else {
            pos.push(a.clone());
        }
    }
    Ok((pos, flags))
}

fn key_dir(flags: &HashMap<String, String>) -> Result<PathBuf, String> {
    if let Some(d) = flags.get("dir") {
        return Ok(PathBuf::from(d));
    }
    let home = std::env::var_os("HOME").ok_or("HOME is not set; pass --dir")?;
    Ok(PathBuf::from(home).join(".lefi-license"))
}

fn write_private(path: &PathBuf, content: &str) -> Result<(), String> {
    let mut opts = OpenOptions::new();
    opts.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let mut f = opts
        .open(path)
        .map_err(|e| format!("{}: {e}", path.display()))?;
    f.write_all(content.as_bytes()).map_err(|e| e.to_string())
}

fn signing_key(flags: &HashMap<String, String>) -> Result<ed25519_dalek::SigningKey, String> {
    if flags.contains_key("dev") {
        return parse_signing_key(DEV_SEED);
    }
    let path = key_dir(flags)?.join("signing.key");
    let text = fs::read_to_string(&path)
        .map_err(|e| format!("{}: {e} (run `lefi-license keygen` first)", path.display()))?;
    parse_signing_key(&text)
}

fn run(args: Vec<String>) -> Result<(), String> {
    let (cmd, rest) = args.split_first().ok_or(USAGE)?;
    let (pos, flags) = parse_flags(rest)?;
    match cmd.as_str() {
        "keygen" => {
            let dir = key_dir(&flags)?;
            let key_path = dir.join("signing.key");
            if key_path.exists() {
                return Err(format!(
                    "{} already exists; refusing to replace a signing key",
                    key_path.display()
                ));
            }
            fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&dir, fs::Permissions::from_mode(0o700))
                    .map_err(|e| e.to_string())?;
            }
            let key = generate_key().map_err(|e| e.to_string())?;
            write_private(&key_path, &encode_signing_key(&key))?;
            let public = encode_public_key(&key.verifying_key());
            fs::write(dir.join("signing.pub"), format!("{public}\n")).map_err(|e| e.to_string())?;
            println!(
                "Private key: {} (mode 600). Back it up in a password manager; NEVER commit it.",
                key_path.display()
            );
            println!("Key id:      {}", key_id(&key.verifying_key()));
            println!("Public key:  {public}");
            println!("Put the public key in apps/helper/src-tauri/keys/production.pub so release builds trust it.");
            Ok(())
        }
        "issue" => {
            let get = |k: &str| {
                flags
                    .get(k)
                    .cloned()
                    .ok_or(format!("--{k} is required\n{USAGE}"))
            };
            let support_until = get("support-until")?;
            if !is_date(&support_until) {
                return Err("--support-until must be YYYY-MM-DD".into());
            }
            let max_pcs: u32 = get("max-pcs")?
                .parse()
                .map_err(|_| "--max-pcs must be a positive number")?;
            if max_pcs == 0 {
                return Err("--max-pcs must be at least 1".into());
            }
            let installation = normalize_installation_id(&get("installation")?);
            if installation.len() != 19 {
                return Err("--installation must be the 16-character id Lefi Crop Helper shows (XXXX-XXXX-XXXX-XXXX)".into());
            }
            let key = signing_key(&flags)?;
            let licence = Licence {
                v: 1,
                licence_id: random_licence_id().map_err(|e| e.to_string())?,
                customer: get("customer")?,
                installation_id: installation,
                max_pcs,
                edition: flags
                    .get("edition")
                    .cloned()
                    .unwrap_or_else(|| "standard".into()),
                issued_at: today_utc(),
                support_until,
                key_id: String::new(),
            };
            let code = sign(licence.clone(), &key);
            if flags.contains_key("dev") {
                eprintln!("DEVELOPMENT code: only development builds of Lefi Crop Helper accept it. Not recorded in the register.");
            } else {
                let mut entry = serde_json::to_value(&licence).map_err(|e| e.to_string())?;
                entry["key_id"] = key_id(&key.verifying_key()).into();
                entry["issued_by"] = std::env::var("USER").unwrap_or_default().into();
                let reg = key_dir(&flags)?.join("register.ndjson");
                let mut f = OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&reg)
                    .map_err(|e| format!("{}: {e}", reg.display()))?;
                writeln!(f, "{entry}").map_err(|e| e.to_string())?;
                eprintln!("Recorded in {}", reg.display());
            }
            println!("{code}");
            Ok(())
        }
        "release-keygen" => {
            let dir = flags.get("dir").map(PathBuf::from).unwrap_or(
                PathBuf::from(std::env::var_os("HOME").ok_or("HOME is not set")?)
                    .join(".lefi-release"),
            );
            let key_path = dir.join("release.key");
            if key_path.exists() {
                return Err(format!(
                    "{} already exists; refusing to replace a release key",
                    key_path.display()
                ));
            }
            fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&dir, fs::Permissions::from_mode(0o700))
                    .map_err(|e| e.to_string())?;
            }
            let key = generate_key().map_err(|e| e.to_string())?;
            write_private(&key_path, &encode_signing_key(&key))?;
            let public = encode_public_key(&key.verifying_key());
            fs::write(dir.join("release.pub"), format!("{public}\n")).map_err(|e| e.to_string())?;
            println!(
                "Release private key: {} (mode 600). Back it up; NEVER commit it.",
                key_path.display()
            );
            println!("Public key: {public}");
            println!("Put it in apps/helper/src-tauri/keys/release.pub so Lefi Crop Helper trusts updates signed with it.");
            Ok(())
        }
        "release-pack" => release_pack(&flags),
        "release-verify" => {
            let file = pos
                .first()
                .ok_or("usage: lefi-license release-verify FILE [--dev]")?;
            let get = |m: &str| -> Result<Vec<u8>, String> {
                let o = std::process::Command::new("tar")
                    .arg("-xOf")
                    .arg(file)
                    .arg(m)
                    .output()
                    .map_err(|e| e.to_string())?;
                if o.status.success() {
                    Ok(o.stdout)
                } else {
                    Err(format!("{file}: no {m} (not a .lefiupdate)"))
                }
            };
            let mut keys = vec![];
            if flags.contains_key("dev") {
                keys.push(parse_signing_key(DEV_RELEASE_SEED)?.verifying_key());
            } else {
                let p = PathBuf::from(std::env::var_os("HOME").ok_or("HOME is not set")?)
                    .join(".lefi-release/release.pub");
                keys.push(
                    parse_public_key(
                        &fs::read_to_string(&p).map_err(|e| format!("{}: {e}", p.display()))?,
                    )
                    .map_err(|e| e.to_string())?,
                );
            }
            let m = lefi_license::release::verify_manifest(
                &get("manifest.json")?,
                &String::from_utf8_lossy(&get("manifest.sig")?),
                &keys,
            )
            .map_err(|e| e.to_string())?;
            if sha256_hex(&get("app.tar.gz")?) != m.app_sha256 {
                return Err("app.tar.gz does not match the signed checksum".into());
            }
            println!(
                "{}",
                serde_json::to_string_pretty(&m).map_err(|e| e.to_string())?
            );
            Ok(())
        }
        "verify" => {
            let code = pos.first().ok_or(USAGE)?;
            let installation = flags
                .get("installation")
                .ok_or("--installation is required")?;
            let public = if flags.contains_key("dev") {
                signing_key(&flags)?.verifying_key()
            } else {
                let p = key_dir(&flags)?.join("signing.pub");
                parse_public_key(
                    &fs::read_to_string(&p).map_err(|e| format!("{}: {e}", p.display()))?,
                )
                .map_err(|e| e.to_string())?
            };
            let licence = verify(code, &[public], installation).map_err(|e| e.to_string())?;
            println!(
                "{}",
                serde_json::to_string_pretty(&licence).map_err(|e| e.to_string())?
            );
            Ok(())
        }
        _ => Err(USAGE.into()),
    }
}

/// `CFBundleShortVersionString` of an app bundle (plain XML Info.plist, as Tauri writes it).
fn bundle_version(app: &std::path::Path) -> Option<String> {
    let x = fs::read_to_string(app.join("Contents/Info.plist")).ok()?;
    let after = x.split("<key>CFBundleShortVersionString</key>").nth(1)?;
    let v = after.split("<string>").nth(1)?.split("</string>").next()?;
    Some(v.trim().to_string())
}

fn pyproject_version(p: &std::path::Path) -> Option<String> {
    fs::read_to_string(p).ok()?.lines().find_map(|l| {
        let l = l.trim();
        l.strip_prefix("version = \"")
            .and_then(|r| r.strip_suffix('"'))
            .map(str::to_string)
    })
}

fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// Packs a built `Lefi Crop Helper.app` into a signed `LefiCrop-<release>.lefiupdate` (ADR-035).
fn release_pack(flags: &HashMap<String, String>) -> Result<(), String> {
    use lefi_license::release::{parse_version, sign::sign_manifest, Components, ReleaseManifest};
    let app = PathBuf::from(flags.get("app").ok_or("--app is required")?);
    let out = PathBuf::from(flags.get("out").ok_or("--out is required")?);
    let payload = app.join("Contents/Resources/payload");
    let release = fs::read_to_string(payload.join("VERSION")).map_err(|_| {
        "The app has no payload/VERSION (build it with pnpm --filter @lefi/helper bundle)"
    })?;
    let release = release.trim().to_string();
    parse_version(&release).ok_or("payload/VERSION must be MAJOR.MINOR.PATCH")?;
    let helperd = std::process::Command::new(app.join("Contents/MacOS/lefi-helperd"))
        .arg("version")
        .output()
        .map_err(|e| format!("lefi-helperd: {e}"))?;
    let components = Components {
        helper: bundle_version(&app).ok_or("Cannot read the app version")?,
        helperd: String::from_utf8_lossy(&helperd.stdout).trim().to_string(),
        brain: pyproject_version(&payload.join("services/brain/pyproject.toml"))
            .ok_or("Cannot read the Brain version")?,
        desktop: bundle_version(&payload.join("desktop/Lefi Crop.app")),
        installer: release.clone(),
    };
    let key = if flags.contains_key("dev") {
        parse_signing_key(DEV_RELEASE_SEED)?
    } else {
        let p = flags
            .get("dir")
            .map(PathBuf::from)
            .unwrap_or(
                PathBuf::from(std::env::var_os("HOME").ok_or("HOME is not set")?)
                    .join(".lefi-release"),
            )
            .join("release.key");
        parse_signing_key(
            &fs::read_to_string(&p)
                .map_err(|e| format!("{}: {e} (run release-keygen first)", p.display()))?,
        )?
    };
    let work = std::env::temp_dir().join(format!("lefi-release-{}", std::process::id()));
    let _ = fs::remove_dir_all(&work);
    fs::create_dir_all(&work).map_err(|e| e.to_string())?;
    let parent = app.parent().ok_or("bad --app")?;
    let name = app.file_name().ok_or("bad --app")?;
    let st = std::process::Command::new("tar")
        .arg("-czf")
        .arg(work.join("app.tar.gz"))
        .arg("-C")
        .arg(parent)
        .arg(name)
        .env("COPYFILE_DISABLE", "1")
        .status()
        .map_err(|e| e.to_string())?;
    if !st.success() {
        return Err("tar failed".into());
    }
    let app_bytes = fs::read(work.join("app.tar.gz")).map_err(|e| e.to_string())?;
    let manifest = ReleaseManifest {
        v: 1,
        release: release.clone(),
        released_at: today_utc(),
        security: flags.get("security").map(|v| v == "yes").unwrap_or(false),
        notes: flags.get("notes").cloned().unwrap_or_default(),
        components,
        app_sha256: sha256_hex(&app_bytes),
        app_size: app_bytes.len() as u64,
        key_id: String::new(),
    };
    let (bytes, sig) = sign_manifest(manifest, &key);
    fs::write(work.join("manifest.json"), &bytes).map_err(|e| e.to_string())?;
    fs::write(work.join("manifest.sig"), format!("{sig}\n")).map_err(|e| e.to_string())?;
    fs::create_dir_all(&out).map_err(|e| e.to_string())?;
    let file = out.join(format!("LefiCrop-{release}.lefiupdate"));
    let st = std::process::Command::new("tar")
        .arg("-cf")
        .arg(&file)
        .arg("-C")
        .arg(&work)
        .args(["manifest.json", "manifest.sig", "app.tar.gz"])
        .env("COPYFILE_DISABLE", "1")
        .status()
        .map_err(|e| e.to_string())?;
    let _ = fs::remove_dir_all(&work);
    if !st.success() {
        return Err("tar failed".into());
    }
    if flags.contains_key("dev") {
        eprintln!("DEVELOPMENT update: only development builds of Lefi Crop Helper accept it.");
    }
    println!("{}", file.display());
    Ok(())
}
