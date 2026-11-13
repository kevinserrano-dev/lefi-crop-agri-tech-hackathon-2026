//! Runs a command from the main PC on a satellite (ADR-033, slice 2): validate it, fetch and
//! check the installer payload, run `install.sh`, stream its events back, relay Cancel.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::Value;
use tokio::io::{AsyncBufReadExt, BufReader};

use crate::ca::fingerprint;
use crate::error::{io, Error, Result};
use crate::protocol::{Command, CommandEvents, CommandEventsResponse, CommandFinished};
use crate::satellite::{client_for, SatelliteConfig};

/// Extra environment for the installer (tests point the state folder somewhere temporary).
#[derive(Clone, Default)]
pub struct ExecOptions {
    pub env: Vec<(String, String)>,
    /// The AI's port on this PC (tests: a fake server). Default: Ollama's.
    pub ai_port: Option<u16>,
    /// The home folder inspected for components (tests: a temporary one). Default: `$HOME`.
    pub home: Option<PathBuf>,
    /// Announce this PC's Lefi name on the network (tests: no).
    pub publish_name: bool,
    /// The service program `update_service` replaces (tests: a copy). Default: this program,
    /// which must be `<data>/bin/lefi-helperd`, where the join script put it.
    pub service_exe: Option<PathBuf>,
    /// End this process after a successful `update_service`, so launchd starts the new program
    /// (the real service only: a test must not exit).
    pub exit_after_service_update: bool,
}

/// How much of the installer's log a failed command sends to the main PC.
const LOG_TAIL_LINES: usize = 200;

fn seen_file(data: &Path) -> PathBuf {
    data.join("node").join("commands-seen.txt")
}

/// Target, expiry, kind and replay checks. Records the id before anything runs, so a command
/// can never run twice, even after a crash.
pub fn accept(data: &Path, cfg: &SatelliteConfig, cmd: &Command, now: u64) -> Result<()> {
    if cmd.node_id != cfg.node_id {
        return Err(Error::new(
            "COMMAND_REJECTED",
            "This command is for another PC.",
        ));
    }
    if cmd.expires_at <= now {
        return Err(Error::new("COMMAND_REJECTED", "This command has expired."));
    }
    if !matches!(
        cmd.kind.as_str(),
        "install"
            | "rollback"
            | "remove"
            | "service"
            | "ai_bench"
            | "desktop_pair"
            | "erase"
            | "update_service"
    ) {
        return Err(Error::new("COMMAND_REJECTED", "Unknown command."));
    }
    if cmd.kind == "remove" && !matches!(cmd.roles.as_slice(), [r] if r == "ai" || r == "desktop") {
        return Err(Error::new("COMMAND_REJECTED", "Unknown component."));
    }
    if cmd.kind == "service"
        && (cmd.roles != ["ai"]
            || !matches!(
                cmd.action.as_deref(),
                Some("start" | "stop" | "restart" | "off" | "on")
            ))
    {
        return Err(Error::new("COMMAND_REJECTED", "Unknown service action."));
    }
    if cmd.kind == "desktop_pair" && !cmd.pairing.as_ref().is_some_and(|o| o.valid()) {
        return Err(Error::new("COMMAND_REJECTED", "Invalid pairing offer."));
    }
    if cmd.kind == "update_service"
        && !cmd.service_update.as_ref().is_some_and(|u| {
            u.valid() && u.platform == crate::main_node::platform_key() && cmd.roles.is_empty()
        })
    {
        return Err(Error::new(
            "COMMAND_REJECTED",
            "Invalid service update for this PC.",
        ));
    }
    if !cmd.id.starts_with("cmd-") || !cmd.id[4..].chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(Error::new("COMMAND_REJECTED", "Bad command id."));
    }
    let seen = std::fs::read_to_string(seen_file(data)).unwrap_or_default();
    if seen.lines().any(|l| l == cmd.id) {
        return Err(Error::new(
            "COMMAND_REJECTED",
            "This command already ran here.",
        ));
    }
    use std::io::Write;
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(seen_file(data))
        .map_err(io("NODE_WRITE"))?;
    writeln!(f, "{}", cmd.id).map_err(io("NODE_WRITE"))
}

/// Downloads the installer payload over mTLS, checks its SHA-256 and unpacks it once.
async fn payload(data: &Path, cfg: &SatelliteConfig, sha: &str) -> Result<PathBuf> {
    if sha.len() != 64 || !sha.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(Error::new(
            "PAYLOAD_INVALID",
            "Bad payload checksum in the command.",
        ));
    }
    let dir = data.join("payload").join(sha);
    if dir.join("scripts/install.sh").is_file() {
        return Ok(dir);
    }
    let client = client_for(data)?;
    let resp = client
        .get(format!("https://{}:{}/v1/payload", cfg.main, cfg.tls_port))
        .send()
        .await
        .map_err(|e| Error::new("MAIN_UNREACHABLE", e.to_string()))?;
    if !resp.status().is_success() {
        return Err(Error::new(
            "PAYLOAD_INVALID",
            format!(
                "The main PC did not send the installer (HTTP {}).",
                resp.status()
            ),
        ));
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| Error::new("MAIN_UNREACHABLE", e.to_string()))?;
    if fingerprint(&bytes) != sha {
        return Err(Error::new(
            "PAYLOAD_INVALID",
            "The installer files are damaged (checksum mismatch).",
        ));
    }
    let tmp = data.join("payload").join(format!("{sha}.partial"));
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp).map_err(io("PAYLOAD_WRITE"))?;
    let tgz = data.join("payload").join(format!("{sha}.tgz"));
    std::fs::write(&tgz, &bytes).map_err(io("PAYLOAD_WRITE"))?;
    let st = std::process::Command::new("tar")
        .arg("-xzf")
        .arg(&tgz)
        .arg("-C")
        .arg(&tmp)
        .status()
        .map_err(io("PAYLOAD_WRITE"))?;
    let _ = std::fs::remove_file(&tgz);
    if !st.success() || !tmp.join("scripts/install.sh").is_file() {
        let _ = std::fs::remove_dir_all(&tmp);
        return Err(Error::new(
            "PAYLOAD_INVALID",
            "The installer files could not be unpacked.",
        ));
    }
    std::fs::rename(&tmp, &dir).map_err(io("PAYLOAD_WRITE"))?;
    Ok(dir)
}

async fn post(cfg: &SatelliteConfig, data: &Path, id: &str, batch: &CommandEvents) -> Option<bool> {
    let client = client_for(data).ok()?;
    let resp = client
        .post(format!(
            "https://{}:{}/v1/commands/{id}/events",
            cfg.main, cfg.tls_port
        ))
        .json(batch)
        .send()
        .await
        .ok()?;
    resp.json::<CommandEventsResponse>()
        .await
        .ok()
        .map(|r| r.cancel)
}

fn child_path() -> String {
    let mut p = String::from("/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/local/sbin:/usr/bin:/bin:/usr/sbin:/sbin");
    if let Ok(cur) = std::env::var("PATH") {
        p.push(':');
        p.push_str(&cur);
    }
    p
}

/// The command in progress, kept on disk so it survives a restart of this PC (ADR-033).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct Current {
    command: Command,
    /// The installer process, to wait for it if it outlived the service.
    pid: Option<u32>,
    resumed: u32,
}

fn current_path(data: &Path) -> PathBuf {
    data.join("node").join("current.json")
}

fn save_current(data: &Path, c: &Current) {
    let _ = std::fs::write(
        current_path(data),
        serde_json::to_vec_pretty(c).unwrap_or_default(),
    );
}

fn load_current(data: &Path) -> Option<Current> {
    serde_json::from_slice(&std::fs::read(current_path(data)).ok()?).ok()
}

fn journals_path(data: &Path) -> PathBuf {
    data.join("node").join("journals.json")
}

/// Install journals written for each command (one per installer run).
fn journals_for(data: &Path, cmd_id: &str) -> Vec<String> {
    let map: std::collections::BTreeMap<String, Vec<String>> = std::fs::read(journals_path(data))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default();
    map.get(cmd_id).cloned().unwrap_or_default()
}

fn add_journal(data: &Path, cmd_id: &str, journal: &str) {
    let mut map: std::collections::BTreeMap<String, Vec<String>> =
        std::fs::read(journals_path(data))
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default();
    let e = map.entry(cmd_id.to_string()).or_default();
    if !e.iter().any(|j| j == journal) {
        e.push(journal.to_string());
    }
    let _ = std::fs::write(
        journals_path(data),
        serde_json::to_vec_pretty(&map).unwrap_or_default(),
    );
}

fn pid_alive(pid: u32) -> bool {
    std::process::Command::new("kill")
        .args(["-0", &pid.to_string()])
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// What the installer is asked to do.
enum Mode {
    Install,
    /// Undo exactly these journals (empty: the newest run not undone yet).
    Rollback(Vec<String>),
    /// `install.sh --remove-role`.
    Remove(String),
    /// `lefi <action> ai`, or `lefi ai off|on`.
    Service(String),
    /// `install.sh --uninstall-everything` (ADR-054).
    Erase,
}

/// The tags of `config/supported-models.tsv` in the payload.
fn supported_models(root: &Path) -> Vec<String> {
    std::fs::read_to_string(root.join("config/supported-models.tsv"))
        .unwrap_or_default()
        .lines()
        .filter(|l| !l.starts_with('#') && !l.trim().is_empty())
        .filter_map(|l| l.split('\t').next().map(str::to_string))
        .collect()
}

async fn run_bench(
    data: &Path,
    cfg: &SatelliteConfig,
    cmd: &Command,
    opts: &ExecOptions,
) -> Result<Option<i32>> {
    let root = payload(data, cfg, &cmd.payload_sha256).await?;
    let started = CommandEvents {
        output: vec!["Running one short generation on this PC's AI…".into()],
        ..Default::default()
    };
    post(cfg, data, &cmd.id, &started).await;
    let event = crate::report::ai_bench(opts, &supported_models(&root)).await?;
    let batch = CommandEvents {
        events: vec![event],
        ..Default::default()
    };
    post(cfg, data, &cmd.id, &batch).await;
    Ok(Some(0))
}

/// Leaves the main PC's pairing offer for this PC's Lefi Desktop (ADR-050), mode 600 in its data
/// folder. Lefi Desktop uses it once, keeps the pairing only if the gateway CA in Lefi Brain's
/// answer has that fingerprint, and deletes it. Nothing runs here but this write.
async fn offer_to_desktop(
    data: &Path,
    cfg: &SatelliteConfig,
    cmd: &Command,
    opts: &ExecOptions,
) -> Result<Option<i32>> {
    let offer = cmd
        .pairing
        .as_ref()
        .filter(|o| o.valid())
        .ok_or_else(|| Error::new("COMMAND_REJECTED", "Invalid pairing offer."))?;
    let home = opts
        .home
        .clone()
        .or_else(|| std::env::var_os("HOME").map(PathBuf::from))
        .ok_or_else(|| Error::new("NO_HOME", "HOME is not set."))?;
    // The main PC's address as this PC knows it: used when the name does not resolve (ADR-055).
    let alternates: Vec<String> = offer
        .url
        .rsplit_once(':')
        .map(|(_, port)| vec![format!("https://{}:{port}", cfg.main)])
        .unwrap_or_default();
    write_offer_with(&crate::report::desktop_data_dir(&home), offer, &alternates)?;
    let batch = CommandEvents {
        output: vec![
            "Lefi Desktop on this PC pairs with Lefi Brain by itself when it opens.".into(),
        ],
        ..Default::default()
    };
    post(cfg, data, &cmd.id, &batch).await;
    Ok(Some(0))
}

pub fn write_offer(dir: &Path, offer: &crate::protocol::PairingOffer) -> Result<PathBuf> {
    write_offer_with(dir, offer, &[])
}

/// The offer plus other addresses of the same gateway, tried in order when the first does not
/// answer. Only https origins are kept.
pub fn write_offer_with(
    dir: &Path,
    offer: &crate::protocol::PairingOffer,
    alternates: &[String],
) -> Result<PathBuf> {
    use std::io::Write;
    std::fs::create_dir_all(dir).map_err(|e| Error::new("OFFER_WRITE", e.to_string()))?;
    let path = dir.join("pairing-offer.json");
    let tmp = dir.join("pairing-offer.json.tmp");
    let _ = std::fs::remove_file(&tmp);
    let mut o = std::fs::OpenOptions::new();
    o.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        o.mode(0o600);
    }
    let mut f = o
        .open(&tmp)
        .map_err(|e| Error::new("OFFER_WRITE", e.to_string()))?;
    let mut v =
        serde_json::to_value(offer).map_err(|e| Error::new("OFFER_WRITE", e.to_string()))?;
    let alts: Vec<&String> = alternates
        .iter()
        .filter(|a| a.starts_with("https://") && a.len() < 200 && **a != offer.url)
        .collect();
    if !alts.is_empty() {
        v["alternates"] = serde_json::json!(alts);
    }
    let body = serde_json::to_vec(&v).map_err(|e| Error::new("OFFER_WRITE", e.to_string()))?;
    f.write_all(&body)
        .map_err(|e| Error::new("OFFER_WRITE", e.to_string()))?;
    std::fs::rename(&tmp, &path).map_err(|e| Error::new("OFFER_WRITE", e.to_string()))?;
    Ok(path)
}

/// What stays after an erase, said before this PC's identity is deleted: the boot service file is
/// owned by root, which this service is not (ADR-054).
fn erase_notice(data: &Path) -> CommandEvents {
    let mut b = CommandEvents {
        output: vec!["Lefi Crop Helper now removes itself and its identity from this PC.".into()],
        ..Default::default()
    };
    if crate::service::registered("satellite") == "boot" {
        let command = crate::traces::boot_service_cleanup_command("satellite");
        b.output.push(format!(
            "One file stays, owned by the administrator of this Mac: an administrator removes it with: {command}"
        ));
        b.events.push(serde_json::json!({
            "event": "erase.leftover",
            "path": "/Library/LaunchDaemons/com.lefi-crop.helperd-satellite.plist",
            "command": command,
            "data": data.display().to_string(),
        }));
    }
    b
}

/// Deletes what Lefi Crop left in this user's home and the service's own folder (its program,
/// certificate, payloads, logs). The running process ends right after: its loop sees it is no
/// longer enrolled, and launchd does not start it again (`service::plist`, PathState).
pub fn wipe(data: &Path, home: &Path, keychain: bool) -> Vec<PathBuf> {
    let mut gone = crate::traces::remove(home, &crate::traces::user_traces(home));
    if crate::traces::safe_to_delete(home, data) {
        gone.extend(crate::traces::remove(home, &[data.to_path_buf()]));
    }
    if keychain {
        crate::traces::remove_keychain_items();
    }
    gone
}

/// Replaces this PC's service program with the main PC's (ADR-062): downloaded over mTLS, checked
/// against the SHA-256 in the command, and run once to see that it answers the expected version.
/// The previous program stays as `lefi-helperd.prev`. Nothing else is touched: no password is
/// needed because the program lives in this user's folder and launchd keeps the service alive.
async fn update_service(
    data: &Path,
    cfg: &SatelliteConfig,
    cmd: &Command,
    opts: &ExecOptions,
) -> Result<Option<i32>> {
    let up = cmd
        .service_update
        .as_ref()
        .filter(|u| u.valid())
        .ok_or_else(|| Error::new("COMMAND_REJECTED", "Invalid service update."))?;
    let exe = match &opts.service_exe {
        Some(p) => p.clone(),
        None => {
            let me = std::env::current_exe().map_err(io("SERVICE_UPDATE"))?;
            let own = data.join("bin").join("lefi-helperd");
            let same = match (me.canonicalize(), own.canonicalize()) {
                (Ok(a), Ok(b)) => a == b,
                _ => false,
            };
            if !same {
                return Err(Error::new(
                    "SERVICE_UPDATE",
                    "This service does not run from its own folder, so it cannot replace itself. Update it on this PC with the command on its page.",
                ));
            }
            own
        }
    };
    let say = |line: String| CommandEvents {
        output: vec![line],
        ..Default::default()
    };
    post(
        cfg,
        data,
        &cmd.id,
        &say(format!(
            "Downloading the Lefi Crop Helper service {} from the main PC…",
            up.version
        )),
    )
    .await;
    let client = client_for(data)?;
    let resp = client
        .get(format!("https://{}:{}/v1/helperd", cfg.main, cfg.tls_port))
        .send()
        .await
        .map_err(|e| Error::new("MAIN_UNREACHABLE", e.to_string()))?;
    if !resp.status().is_success() {
        return Err(Error::new(
            "SERVICE_UPDATE",
            format!(
                "The main PC did not send the service (HTTP {}).",
                resp.status()
            ),
        ));
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| Error::new("MAIN_UNREACHABLE", e.to_string()))?;
    if fingerprint(&bytes) != up.sha256.to_ascii_lowercase() {
        return Err(Error::new(
            "SERVICE_UPDATE",
            "The downloaded service is damaged (checksum mismatch). Nothing was changed.",
        ));
    }
    let new = exe.with_file_name("lefi-helperd.new");
    let prev = exe.with_file_name("lefi-helperd.prev");
    let _ = std::fs::remove_file(&new);
    std::fs::write(&new, &bytes).map_err(io("SERVICE_UPDATE"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&new, std::fs::Permissions::from_mode(0o755))
            .map_err(io("SERVICE_UPDATE"))?;
    }
    // The new program must start and say the version the main PC announced.
    let answer = tokio::time::timeout(
        Duration::from_secs(20),
        tokio::process::Command::new(&new)
            .arg("version")
            .stdin(Stdio::null())
            .output(),
    )
    .await;
    let says = match answer {
        Ok(Ok(o)) if o.status.success() => String::from_utf8_lossy(&o.stdout).trim().to_string(),
        _ => String::new(),
    };
    if says != up.version {
        let _ = std::fs::remove_file(&new);
        return Err(Error::new(
            "SERVICE_UPDATE",
            format!(
                "The new service did not start correctly (it answered {:?}, expected {}). Nothing was changed.",
                says, up.version
            ),
        ));
    }
    std::fs::copy(&exe, &prev).map_err(io("SERVICE_UPDATE"))?;
    std::fs::rename(&new, &exe).map_err(io("SERVICE_UPDATE"))?;
    post(
        cfg,
        data,
        &cmd.id,
        &say(format!(
            "Lefi Crop Helper service {} installed (the previous one is kept as lefi-helperd.prev); it restarts now.",
            up.version
        )),
    )
    .await;
    Ok(Some(0))
}

/// Runs the command to completion, reporting to the main PC as it goes.
pub async fn execute(data: PathBuf, cfg: SatelliteConfig, cmd: Command, opts: ExecOptions) {
    execute_job(data, cfg, cmd, opts, 0).await;
}

async fn execute_job(
    data: PathBuf,
    cfg: SatelliteConfig,
    cmd: Command,
    opts: ExecOptions,
    resumed: u32,
) {
    let id = cmd.id.clone();
    let mut cur = Current {
        command: cmd.clone(),
        pid: None,
        resumed,
    };
    save_current(&data, &cur);
    let result = if cmd.kind == "update_service" {
        let r = update_service(&data, &cfg, &cmd, &opts).await;
        let restart = matches!(r, Ok(Some(0))) && opts.exit_after_service_update;
        finish(&data, &cfg, &id, r).await;
        if restart {
            // launchd starts the service again while this PC is joined (`service::plist`,
            // PathState), now with the new program.
            eprintln!("service updated: exiting so launchd starts the new program");
            std::process::exit(0);
        }
        return;
    } else if cmd.kind == "desktop_pair" {
        offer_to_desktop(&data, &cfg, &cmd, &opts).await
    } else if cmd.kind == "ai_bench" {
        run_bench(&data, &cfg, &cmd, &opts).await
    } else if cmd.kind == "remove" {
        let role = cmd.roles.first().cloned().unwrap_or_default();
        run_installer(&data, &cfg, &cmd, &opts, Mode::Remove(role), &mut cur).await
    } else if cmd.kind == "erase" {
        let r = run_installer(&data, &cfg, &cmd, &opts, Mode::Erase, &mut cur).await;
        if matches!(r, Ok(Some(0))) {
            // Told to the main PC while this PC can still prove who it is.
            post(&cfg, &data, &id, &erase_notice(&data)).await;
            finish(&data, &cfg, &id, r).await;
            let home = opts
                .home
                .clone()
                .or_else(|| std::env::var_os("HOME").map(PathBuf::from));
            if let Some(h) = home {
                wipe(&data, &h, opts.home.is_none());
            }
        } else {
            finish(&data, &cfg, &id, r).await;
        }
        return;
    } else if cmd.kind == "service" {
        let action = cmd.action.clone().unwrap_or_default();
        run_installer(&data, &cfg, &cmd, &opts, Mode::Service(action), &mut cur).await
    } else if cmd.kind == "install" {
        let r = run_installer(&data, &cfg, &cmd, &opts, Mode::Install, &mut cur).await;
        // Cancelled after a restart: the installer undid its own run; the run interrupted by
        // the restart is undone here too, so Cancel always leaves the PC as it was.
        if resumed > 0 && matches!(r, Ok(Some(130))) {
            let js = journals_for(&data, &id);
            let _ = run_installer(&data, &cfg, &cmd, &opts, Mode::Rollback(js), &mut cur).await;
        }
        r
    } else {
        let js = cmd
            .target_command
            .as_deref()
            .map(|t| journals_for(&data, t))
            .unwrap_or_default();
        run_installer(&data, &cfg, &cmd, &opts, Mode::Rollback(js), &mut cur).await
    };
    finish(&data, &cfg, &id, result).await;
}

async fn finish(data: &Path, cfg: &SatelliteConfig, id: &str, result: Result<Option<i32>>) {
    let finished = match result {
        Ok(code) => CommandFinished {
            exit_code: code,
            error: None,
        },
        Err(e) => {
            eprintln!("command {id} failed before the installer ran: {e}");
            CommandFinished {
                exit_code: None,
                error: Some(e.to_string()),
            }
        }
    };
    // The last batch is retried: the main PC must learn how the command ended.
    let last = CommandEvents {
        events: vec![],
        output: vec![],
        finished: Some(finished),
    };
    for _ in 0..30 {
        if post(cfg, data, id, &last).await.is_some() {
            break;
        }
        tokio::time::sleep(Duration::from_secs(5)).await;
    }
    let _ = std::fs::remove_file(current_path(data));
}

/// After a restart of this PC (or of the service): continue the command that was running.
/// Returns false when there was nothing to resume.
pub async fn resume(data: PathBuf, cfg: SatelliteConfig, opts: ExecOptions) -> bool {
    let Some(cur) = load_current(&data) else {
        return false;
    };
    let cmd = cur.command.clone();
    eprintln!("command {}: resuming after a restart", cmd.id);
    let notice = CommandEvents {
        events: vec![],
        output: vec!["This PC restarted during the work; Lefi Crop Helper is resuming it.".into()],
        finished: None,
    };
    let mut cancel = post(&cfg, &data, &cmd.id, &notice).await == Some(true);
    // An installer that outlived the service (the service restarted, not the PC): let it end —
    // stopping it in the middle of a package manager could break that package manager.
    if let Some(pid) = cur.pid {
        while pid_alive(pid) {
            tokio::time::sleep(Duration::from_secs(2)).await;
        }
    }
    if cmd.kind == "install" && !cancel {
        cancel = post(&cfg, &data, &cmd.id, &CommandEvents::default()).await == Some(true);
    }
    if cmd.kind == "install" && cancel {
        // Cancelled while this PC was down: undo every run of this command, report "cancelled".
        let mut c2 = cur.clone();
        let js = journals_for(&data, &cmd.id);
        let r = run_installer(&data, &cfg, &cmd, &opts, Mode::Rollback(js), &mut c2).await;
        finish(&data, &cfg, &cmd.id, r.map(|_| Some(130))).await;
        return true;
    }
    // The installer is idempotent: running it again finishes what is missing.
    execute_job(data, cfg, cmd, opts, cur.resumed + 1).await;
    true
}

async fn run_installer(
    data: &Path,
    cfg: &SatelliteConfig,
    cmd: &Command,
    opts: &ExecOptions,
    mode: Mode,
    cur: &mut Current,
) -> Result<Option<i32>> {
    let root = payload(data, cfg, &cmd.payload_sha256).await?;
    let work = data.join("commands").join(&cmd.id);
    std::fs::create_dir_all(&work).map_err(io("NODE_WRITE"))?;
    let cancel_file = work.join("cancel");
    let mut args: Vec<String> = Vec::new();
    match &mode {
        Mode::Install => {
            let answers = work.join("answers.txt");
            {
                use std::io::Write;
                let mut o = std::fs::OpenOptions::new();
                o.write(true).create(true).truncate(true);
                #[cfg(unix)]
                {
                    use std::os::unix::fs::OpenOptionsExt;
                    o.mode(0o600);
                }
                o.open(&answers)
                    .and_then(|mut f| f.write_all(cmd.answers.as_bytes()))
                    .map_err(io("NODE_WRITE"))?;
            }
            let _ = std::fs::remove_file(&cancel_file);
            args.extend(["--answers".into(), answers.display().to_string()]);
            args.extend(["--cancel-file".into(), cancel_file.display().to_string()]);
            if cmd.dry_run {
                args.push("--dry-run".into());
            }
        }
        Mode::Rollback(journals) => {
            args.push("--rollback".into());
            for j in journals {
                args.extend(["--journal".into(), j.clone()]);
            }
        }
        Mode::Remove(role) => {
            args.extend(["--remove-role".into(), role.clone()]);
        }
        Mode::Erase => args.push("--uninstall-everything".into()),
        Mode::Service(action) => {
            // off / on: the AI kill switch, which stays across restarts (ADR-021).
            if action == "off" || action == "on" {
                args.extend(["ai".into(), action.clone()]);
            } else {
                args.extend([action.clone(), "ai".into()]);
            }
        }
    }
    let program = if matches!(mode, Mode::Service(_)) {
        root.join("bin/lefi")
    } else {
        args.extend(["--events".into(), "ndjson".into()]);
        root.join("scripts/install.sh")
    };

    let mut c = tokio::process::Command::new(program);
    c.args(&args)
        .current_dir(&root)
        .env("PATH", child_path())
        .env("NO_COLOR", "1")
        .env("TERM", "dumb")
        // Configuration outside the payload folder, launchd through the session helper (ADR-040).
        .env("LEFI_FORCE_PACKAGED", "1")
        .env("LEFI_SESSION_DIR", data.join("session"))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for (k, v) in &opts.env {
        c.env(k, v);
    }
    let mut child = c.spawn().map_err(io("INSTALLER_START"))?;
    cur.pid = child.id();
    save_current(data, cur);

    let buf: Arc<Mutex<CommandEvents>> = Arc::new(Mutex::new(CommandEvents::default()));
    let out = child.stdout.take().expect("piped");
    let err = child.stderr.take().expect("piped");
    let b1 = buf.clone();
    let (jdata, jid) = (data.to_path_buf(), cmd.id.clone());
    let record_journal = matches!(mode, Mode::Install) && !cmd.dry_run;
    let log_file: Arc<Mutex<Option<PathBuf>>> = Arc::new(Mutex::new(None));
    let log_seen = log_file.clone();
    let t1 = tokio::spawn(async move {
        let mut lines = BufReader::new(out).lines();
        while let Ok(Some(l)) = lines.next_line().await {
            let parsed = serde_json::from_str::<Value>(&l)
                .ok()
                .filter(|v| v.get("event").is_some());
            if let Some(v) = &parsed {
                // Remember every journal this command writes, before anything else happens.
                if record_journal && v["event"] == "plan.started" {
                    if let Some(j) = v.get("journal").and_then(Value::as_str) {
                        add_journal(&jdata, &jid, j);
                    }
                }
                if v["event"] == "plan.done" {
                    if let Some(p) = v.get("log").and_then(Value::as_str) {
                        *log_seen.lock().expect("log path") = Some(PathBuf::from(p));
                    }
                }
            }
            let mut b = b1.lock().expect("buffer");
            match parsed {
                Some(v) => b.events.push(v),
                None => b.output.push(l),
            }
        }
    });
    let b2 = buf.clone();
    let t2 = tokio::spawn(async move {
        let mut lines = BufReader::new(err).lines();
        while let Ok(Some(l)) = lines.next_line().await {
            b2.lock().expect("buffer").output.push(l);
        }
    });

    let flush = |buf: &Arc<Mutex<CommandEvents>>| {
        let mut b = buf.lock().expect("buffer");
        std::mem::take(&mut *b)
    };
    let status = loop {
        tokio::select! {
            st = child.wait() => break st.map_err(io("INSTALLER_WAIT"))?,
            _ = tokio::time::sleep(Duration::from_secs(1)) => {
                let batch = flush(&buf);
                if post(cfg, data, &cmd.id, &batch).await == Some(true)
                    && matches!(mode, Mode::Install)
                    && !cancel_file.exists()
                {
                    eprintln!("command {}: cancel requested by the main PC", cmd.id);
                    let _ = std::fs::write(&cancel_file, b"cancel\n");
                }
            }
        }
    };
    let _ = t1.await;
    let _ = t2.await;
    let mut rest = flush(&buf);
    // A failure: the installer's own log says more than its summary (a tool's exact error).
    if !status.success() {
        let path = log_file.lock().expect("log path").clone();
        if let Some(text) = path.as_ref().and_then(|p| std::fs::read_to_string(p).ok()) {
            let lines: Vec<&str> = text.lines().collect();
            let from = lines.len().saturating_sub(LOG_TAIL_LINES);
            rest.output.push(format!(
                "--- Last lines of {} on this PC ---",
                path.as_ref().expect("read above").display()
            ));
            rest.output
                .extend(lines[from..].iter().map(|l| l.to_string()));
        }
    }
    if !rest.events.is_empty() || !rest.output.is_empty() {
        post(cfg, data, &cmd.id, &rest).await;
    }
    cur.pid = None;
    save_current(data, cur);
    Ok(status.code())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg() -> SatelliteConfig {
        SatelliteConfig {
            main: "127.0.0.1".into(),
            node_id: "pc-aaaaaa".into(),
            http_port: 1,
            tls_port: 2,
        }
    }
    fn cmd(id: &str, node: &str, exp: u64) -> Command {
        Command {
            id: id.into(),
            node_id: node.into(),
            kind: "install".into(),
            roles: vec!["ai".into()],
            dry_run: true,
            answers: String::new(),
            payload_sha256: "0".repeat(64),
            issued_at: 0,
            expires_at: exp,
            target_command: None,
            action: None,
            pairing: None,
            service_update: None,
        }
    }

    #[test]
    fn a_service_update_must_name_a_valid_program_for_this_platform() {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(d.path().join("node")).unwrap();
        let good = crate::protocol::ServiceUpdate {
            version: "0.6.0".into(),
            platform: crate::main_node::platform_key(),
            sha256: "b".repeat(64),
        };
        let mut c = cmd("cmd-01", "pc-aaaaaa", 100);
        c.kind = "update_service".into();
        c.roles = vec![];
        c.service_update = Some(good.clone());
        assert!(accept(d.path(), &cfg(), &c, 1).is_ok());
        for (i, bad) in [
            None,
            Some(crate::protocol::ServiceUpdate {
                platform: "windows-x86".into(),
                ..good.clone()
            }),
            Some(crate::protocol::ServiceUpdate {
                sha256: "zz".into(),
                ..good.clone()
            }),
            Some(crate::protocol::ServiceUpdate {
                version: "0.6.0; rm -rf".into(),
                ..good.clone()
            }),
        ]
        .into_iter()
        .enumerate()
        {
            let mut c2 = c.clone();
            c2.id = format!("cmd-1{i}");
            c2.service_update = bad;
            assert!(accept(d.path(), &cfg(), &c2, 1).is_err(), "case {i}");
        }
        // Roles never travel with it.
        let mut c3 = c.clone();
        c3.id = "cmd-20".into();
        c3.roles = vec!["ai".into()];
        assert!(accept(d.path(), &cfg(), &c3, 1).is_err());
    }

    fn offer() -> crate::protocol::PairingOffer {
        crate::protocol::PairingOffer {
            url: "https://lefi-main.local:8443".into(),
            code: "ABCD-EFGH-JKMN".into(),
            gateway_ca_fingerprint: "ab".repeat(32),
        }
    }

    #[test]
    fn a_pairing_offer_is_accepted_only_when_valid_and_written_private() {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(d.path().join("node")).unwrap();
        let c = cfg();
        let mut good = cmd("cmd-0a", "pc-aaaaaa", 100);
        good.kind = "desktop_pair".into();
        good.pairing = Some(offer());
        assert!(accept(d.path(), &c, &good, 1).is_ok());
        for bad in [
            None,
            Some(crate::protocol::PairingOffer {
                url: "http://evil.example".into(),
                ..offer()
            }),
            Some(crate::protocol::PairingOffer {
                url: "https://x/../y".into(),
                ..offer()
            }),
            Some(crate::protocol::PairingOffer {
                gateway_ca_fingerprint: "zz".into(),
                ..offer()
            }),
        ] {
            let mut c2 = cmd("cmd-0b", "pc-aaaaaa", 100);
            c2.kind = "desktop_pair".into();
            c2.pairing = bad;
            assert!(accept(d.path(), &c, &c2, 1).is_err());
        }
        let dir = d.path().join("desktop");
        let path = write_offer(&dir, &offer()).unwrap();
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        let back: crate::protocol::PairingOffer =
            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(back, offer());
    }

    #[test]
    fn an_older_satellite_still_reads_commands_without_an_offer() {
        // `pairing` is not sent when empty: the fields an older satellite knows stay the same.
        let text = serde_json::to_string(&cmd("cmd-0c", "pc-aaaaaa", 100)).unwrap();
        assert!(!text.contains("pairing"));
    }

    #[test]
    fn rejects_other_pc_expired_and_replayed_commands() {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(d.path().join("node")).unwrap();
        let c = cfg();
        assert!(accept(d.path(), &c, &cmd("cmd-01", "pc-bbbbbb", 100), 10).is_err());
        assert!(accept(d.path(), &c, &cmd("cmd-02", "pc-aaaaaa", 10), 10).is_err());
        assert!(accept(d.path(), &c, &cmd("cmd-../x", "pc-aaaaaa", 100), 10).is_err());
        assert!(accept(d.path(), &c, &cmd("cmd-03", "pc-aaaaaa", 100), 10).is_ok());
        assert_eq!(
            accept(d.path(), &c, &cmd("cmd-03", "pc-aaaaaa", 100), 11)
                .unwrap_err()
                .code,
            "COMMAND_REJECTED"
        );
    }
}
