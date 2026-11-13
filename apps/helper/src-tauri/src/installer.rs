//! Runs the bash installer (`scripts/install.sh`, `bin/lefi`) and relays what it reports.
//! The installer does the work and decides; this module never interprets or fakes progress.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};

use serde::Serialize;
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};
use tokio::process::Command;
use tokio::sync::mpsc;

use crate::error::{Result, SetupError};

/// Where the installer payload lives. Until release packaging (milestone S3) that is a checkout
/// of this repository: `LEFI_ROOT`, or — debug builds only — the checkout this app was built from.
#[derive(Debug, Clone)]
pub struct Layout {
    pub root: PathBuf,
}

impl Layout {
    pub fn locate() -> Result<Self> {
        if let Some(root) = std::env::var_os("LEFI_ROOT") {
            return Self::at(PathBuf::from(root));
        }
        // Packaged app (ADR-034): Contents/MacOS/<exe> → Contents/Resources/payload.
        if let Some(p) = std::env::current_exe()
            .ok()
            .and_then(|e| e.parent().map(|d| d.join("../Resources/payload")))
            .filter(|p| p.join("scripts/install.sh").is_file())
        {
            return Self::at(p);
        }
        if cfg!(debug_assertions) {
            let dev = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
            return Self::at(dev);
        }
        Err(SetupError::new(
            "PAYLOAD_MISSING",
            "This app does not contain the installer files.",
        )
        .with_hint("Build it with: pnpm --filter @lefi/helper bundle"))
    }

    fn at(root: PathBuf) -> Result<Self> {
        let root = root.canonicalize().map_err(|_| {
            SetupError::new(
                "PAYLOAD_MISSING",
                format!("Installer folder not found: {}", root.display()),
            )
        })?;
        let layout = Self { root };
        for p in [layout.install_sh(), layout.lefi_cli(), layout.models_tsv()] {
            if !p.is_file() {
                return Err(SetupError::new(
                    "PAYLOAD_MISSING",
                    format!("Missing installer file: {}", p.display()),
                ));
            }
        }
        Ok(layout)
    }

    pub fn install_sh(&self) -> PathBuf {
        self.root.join("scripts/install.sh")
    }
    pub fn lefi_cli(&self) -> PathBuf {
        self.root.join("bin/lefi")
    }
    pub fn models_tsv(&self) -> PathBuf {
        self.root.join("config/supported-models.tsv")
    }
}

/// One message to the UI: a parsed installer event, or a line of human output.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum InstallerMsg {
    Event { event: Value },
    Output { line: String },
}

#[derive(Debug, Clone, Serialize)]
pub struct RunResult {
    /// `None` when the process was killed by a signal.
    pub exit_code: Option<i32>,
}

/// At most one installer process at a time; the window refuses to close while it runs
/// (closing would break its output pipe in the middle of a step).
#[derive(Default)]
pub struct Runner {
    running: AtomicBool,
    /// The `--cancel-file` of the run in progress (ADR-032): creating it asks the installer to
    /// stop at its next safe point and roll back.
    cancel_file: std::sync::Mutex<Option<PathBuf>>,
}

pub struct RunGuard<'a>(&'a AtomicBool);

impl Drop for RunGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

impl Runner {
    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }

    /// A fresh cancel path for a new run (the file itself is created only to cancel).
    pub fn arm_cancel(&self) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let path =
            std::env::temp_dir().join(format!("lefi-helper-{}-{nanos}.cancel", std::process::id()));
        if let Ok(mut c) = self.cancel_file.lock() {
            *c = Some(path.clone());
        }
        path
    }

    pub fn disarm_cancel(&self) {
        if let Ok(mut c) = self.cancel_file.lock() {
            if let Some(p) = c.take() {
                let _ = std::fs::remove_file(p);
            }
        }
    }

    /// Asks the running installer to stop and roll back. False when nothing can be cancelled.
    pub fn request_cancel(&self) -> Result<bool> {
        let path = match self.cancel_file.lock() {
            Ok(c) => c.clone(),
            Err(_) => None,
        };
        let Some(path) = path else { return Ok(false) };
        if !self.is_running() {
            return Ok(false);
        }
        std::fs::write(&path, b"cancel\n").map_err(|e| {
            SetupError::new(
                "CANCEL_FAILED",
                format!("Could not request the cancel: {e}"),
            )
        })?;
        Ok(true)
    }

    pub fn acquire(&self) -> Result<RunGuard<'_>> {
        self.running
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map_err(|_| SetupError::new("BUSY", "The installer is already running."))?;
        Ok(RunGuard(&self.running))
    }
}

pub fn is_linux() -> bool {
    cfg!(target_os = "linux")
}

#[cfg(unix)]
pub fn is_root() -> bool {
    // SAFETY: geteuid has no preconditions and cannot fail.
    unsafe { libc::geteuid() == 0 }
}
#[cfg(not(unix))]
pub fn is_root() -> bool {
    false
}

fn find_in_path(name: &str) -> Option<PathBuf> {
    std::env::var_os("PATH").and_then(|paths| {
        std::env::split_paths(&paths)
            .map(|d| d.join(name))
            .find(|p| p.is_file())
    })
}

/// A Linux system install writes /etc, /opt and systemd units: it needs root. The GUI asks
/// for it through polkit (`pkexec`), which shows the system's own password dialog.
pub fn elevation_tool(system_install: bool) -> Option<PathBuf> {
    if is_linux() && system_install && !is_root() {
        find_in_path("pkexec")
    } else {
        None
    }
}

/// GUI apps start with a minimal PATH (macOS Finder): add the usual package-manager locations.
fn child_path() -> std::ffi::OsString {
    let mut dirs: Vec<PathBuf> = [
        "/opt/homebrew/bin",
        "/opt/homebrew/sbin",
        "/usr/local/bin",
        "/usr/local/sbin",
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
    ]
    .iter()
    .map(PathBuf::from)
    .collect();
    if let Some(p) = std::env::var_os("PATH") {
        for d in std::env::split_paths(&p) {
            if !dirs.contains(&d) {
                dirs.push(d);
            }
        }
    }
    std::env::join_paths(dirs).unwrap_or_default()
}

pub fn unsupported_os() -> Result<()> {
    if cfg!(unix) {
        Ok(())
    } else {
        Err(SetupError::new(
            "UNSUPPORTED_OS",
            "Lefi Crop Helper runs on macOS and Linux for now; Windows is milestone S6.",
        ))
    }
}

/// `program args…`, elevated with `pkexec` when `elevate` is set.
pub fn command(program: &Path, args: &[&str], elevate: Option<&Path>) -> Command {
    let mut cmd = match elevate {
        Some(pk) => {
            let mut c = Command::new(pk);
            c.arg(program);
            c
        }
        None => Command::new(program),
    };
    cmd.args(args)
        .env("PATH", child_path())
        .env("NO_COLOR", "1")
        .env("TERM", "dumb")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(false);
    cmd
}

fn spawn_lines<R: AsyncRead + Unpin + Send + 'static>(
    reader: R,
    json: bool,
    tx: mpsc::UnboundedSender<InstallerMsg>,
) {
    tokio::spawn(async move {
        let mut lines = BufReader::new(reader).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let msg = parse_line(&line, json);
            if tx.send(msg).is_err() {
                break;
            }
        }
    });
}

/// stdout carries NDJSON events (`--events ndjson`); anything else is shown as output.
pub fn parse_line(line: &str, json: bool) -> InstallerMsg {
    if json {
        if let Ok(v @ Value::Object(_)) = serde_json::from_str::<Value>(line) {
            if v.get("event").and_then(Value::as_str).is_some() {
                return InstallerMsg::Event { event: v };
            }
        }
    }
    InstallerMsg::Output {
        line: strip_ansi(line),
    }
}

fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            if chars.peek() == Some(&'[') {
                chars.next();
                for n in chars.by_ref() {
                    if n.is_ascii_alphabetic() {
                        break;
                    }
                }
            }
        } else if c != '\r' {
            out.push(c);
        }
    }
    out
}

/// Runs the command to completion; every message goes to `sink` as it arrives.
pub async fn run(cmd: Command, sink: impl FnMut(InstallerMsg)) -> Result<RunResult> {
    run_tracked(cmd, |_| {}, sink).await
}

/// Like `run`, and reports the process id as soon as it started.
pub async fn run_tracked(
    mut cmd: Command,
    on_start: impl FnOnce(Option<u32>),
    mut sink: impl FnMut(InstallerMsg),
) -> Result<RunResult> {
    let mut child = cmd.spawn().map_err(|e| {
        SetupError::new(
            "SPAWN_FAILED",
            format!("Could not start the installer: {e}"),
        )
    })?;
    on_start(child.id());
    let (tx, mut rx) = mpsc::unbounded_channel();
    if let Some(out) = child.stdout.take() {
        spawn_lines(out, true, tx.clone());
    }
    if let Some(err) = child.stderr.take() {
        spawn_lines(err, false, tx.clone());
    }
    drop(tx);
    while let Some(msg) = rx.recv().await {
        sink(msg);
    }
    let status = child.wait().await.map_err(|e| {
        SetupError::new(
            "SPAWN_FAILED",
            format!("Installer did not finish cleanly: {e}"),
        )
    })?;
    Ok(RunResult {
        exit_code: status.code(),
    })
}

/// A private temporary answers file (mode 600), removed when dropped.
pub struct AnswersFile(PathBuf);

impl AnswersFile {
    pub fn write(content: &str) -> Result<Self> {
        use std::io::Write;
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let path = std::env::temp_dir().join(format!(
            "lefi-helper-{}-{nanos}.answers",
            std::process::id()
        ));
        let mut opts = std::fs::OpenOptions::new();
        opts.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o600);
        }
        let mut f = opts.open(&path).map_err(|e| {
            SetupError::new(
                "ANSWERS_WRITE",
                format!("Could not write the answers file: {e}"),
            )
        })?;
        f.write_all(content.as_bytes()).map_err(|e| {
            SetupError::new(
                "ANSWERS_WRITE",
                format!("Could not write the answers file: {e}"),
            )
        })?;
        Ok(Self(path))
    }

    pub fn path(&self) -> &str {
        self.0.to_str().unwrap_or_default()
    }
}

impl Drop for AnswersFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn events_and_output_are_told_apart() {
        let e = parse_line(r#"{"event":"step.ok","seq":3,"step":"scan"}"#, true);
        assert!(matches!(e, InstallerMsg::Event { .. }));
        assert_eq!(
            parse_line(r#"{"no":"event"}"#, true),
            InstallerMsg::Output {
                line: r#"{"no":"event"}"#.into()
            }
        );
        assert_eq!(
            parse_line("\u{1b}[32mPASS\u{1b}[0m ok\r", false),
            InstallerMsg::Output {
                line: "PASS ok".into()
            }
        );
    }

    #[test]
    fn cancel_is_only_possible_during_a_run() {
        let r = Runner::default();
        assert!(!r.request_cancel().unwrap(), "no run: nothing to cancel");
        let g = r.acquire().unwrap();
        let path = r.arm_cancel();
        assert!(!path.exists());
        assert!(r.request_cancel().unwrap());
        assert!(path.exists(), "the installer sees the request as this file");
        r.disarm_cancel();
        assert!(!path.exists());
        drop(g);
        assert!(!r.request_cancel().unwrap());
    }

    #[test]
    fn only_one_run_at_a_time() {
        let r = Runner::default();
        let g = r.acquire().unwrap();
        assert!(r.is_running());
        assert_eq!(r.acquire().err().unwrap().code, "BUSY");
        drop(g);
        assert!(!r.is_running());
    }

    #[test]
    fn answers_file_is_private_and_removed() {
        let f = AnswersFile::write("ROLES=ai\n").unwrap();
        let p = PathBuf::from(f.path());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(&p).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        drop(f);
        assert!(!p.exists());
    }

    #[tokio::test]
    async fn streams_stdout_events_and_stderr_lines() {
        let script = r#"echo '{"event":"plan.started","seq":1}'; echo human >&2; exit 3"#;
        let cmd = command(Path::new("/bin/sh"), &["-c", script], None);
        let mut got = Vec::new();
        let res = run(cmd, |m| got.push(m)).await.unwrap();
        assert_eq!(res.exit_code, Some(3));
        assert!(got.iter().any(|m| matches!(m, InstallerMsg::Event { .. })));
        assert!(got.contains(&InstallerMsg::Output {
            line: "human".into()
        }));
    }

    #[test]
    fn dev_layout_finds_the_repository() {
        let l = Layout::locate().unwrap();
        assert!(l.install_sh().is_file());
    }
}
