//! Tauri commands. Each one runs the real installer or reads a real file; nothing is simulated.

use serde::Serialize;
use serde_json::Value;
use tauri::ipc::Channel;
use tauri::State;

use crate::activation::{Activation, ActivationStatus};
use crate::answers::{ServiceMode, SetupAnswers, Target};
use crate::error::{Result, SetupError};
use crate::installer::{self, AnswersFile, InstallerMsg, Layout, RunResult, Runner};
use crate::models::{self, SupportedModel};
use crate::session::{SessionView, Sessions};

#[derive(Debug, Serialize)]
pub struct SetupContext {
    pub os: &'static str,
    pub arch: &'static str,
    pub payload_root: String,
    pub debug_build: bool,
    /// Packaged for the hackathon's judges: activation needs no code (`--features hackathon`).
    pub hackathon_build: bool,
    /// Why this OS cannot install at all (activation is reported by `activation_status`).
    pub install_blocked_reason: Option<String>,
    /// Linux system install from a non-root session: the OS password dialog will appear.
    pub needs_elevation: bool,
    pub supported_models: Vec<SupportedModel>,
}

fn os_id() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "other"
    }
}

fn load_models(layout: &Layout) -> Result<Vec<SupportedModel>> {
    let tsv = std::fs::read_to_string(layout.models_tsv()).map_err(|e| {
        SetupError::new(
            "PAYLOAD_MISSING",
            format!("Cannot read supported-models.tsv: {e}"),
        )
    })?;
    let list = models::parse(&tsv);
    if list.is_empty() {
        return Err(SetupError::new(
            "PAYLOAD_MISSING",
            "config/supported-models.tsv lists no model",
        ));
    }
    Ok(list)
}

fn os_gate() -> Option<String> {
    if cfg!(unix) {
        crate::updates::location_problem()
    } else {
        Some("Windows is not supported yet (milestone S6).".into())
    }
}

#[tauri::command]
pub fn setup_context() -> Result<SetupContext> {
    let layout = Layout::locate()?;
    let reason = os_gate();
    Ok(SetupContext {
        os: os_id(),
        arch: std::env::consts::ARCH,
        payload_root: layout.root.display().to_string(),
        debug_build: cfg!(debug_assertions),
        hackathon_build: crate::activation::HACKATHON_BUILD,
        install_blocked_reason: reason,
        needs_elevation: installer::is_linux() && !installer::is_root(),
        supported_models: load_models(&layout)?,
    })
}

/// Installation id (creates the LEFI root CA on first call) and the stored licence, if any.
#[tauri::command]
pub fn activation_status(activation: State<'_, Activation>) -> Result<ActivationStatus> {
    activation.status()
}

/// Verifies an activation code offline (Ed25519, embedded public key) and stores it.
#[tauri::command]
pub fn activate(code: String, activation: State<'_, Activation>) -> Result<ActivationStatus> {
    if code.len() > 4096 {
        return Err(SetupError::new(
            "CODE_MALFORMED",
            "This is not a valid activation code (too long).",
        ));
    }
    activation.activate(&code)
}

/// Continue without an activation code: activates the hackathon build, or skips activation for
/// this session in a development build. Refused in release builds.
#[tauri::command]
pub fn skip_activation(activation: State<'_, Activation>) -> Result<ActivationStatus> {
    activation.continue_without_code()
}

/// `lefi hw --json` — the measured hardware report (schema `lefi.hw.v1`).
#[tauri::command]
pub async fn scan_hardware() -> Result<Value> {
    installer::unsupported_os()?;
    let layout = Layout::locate()?;
    let cmd = installer::command(&layout.lefi_cli(), &["hw", "--json"], None);
    let mut stdout = String::new();
    let mut stderr = Vec::new();
    let res = installer::run(cmd, |m| match m {
        InstallerMsg::Event { event } => stdout.push_str(&event.to_string()),
        InstallerMsg::Output { line } => {
            if line.trim_start().starts_with('{') {
                stdout.push_str(&line);
            } else {
                stderr.push(line);
            }
        }
    })
    .await?;
    let report: Value = serde_json::from_str(&stdout).map_err(|_| {
        SetupError::new("SCAN_FAILED", "The hardware scan did not return a report.")
            .with_hint(stderr.last().cloned().unwrap_or_default())
    })?;
    // `lefi hw` exits with the AI verdict: 0 fits, 1 unknown, 2 cannot (scripts/cli/hw.sh).
    if !matches!(res.exit_code, Some(0..=2))
        || report.get("schema").and_then(Value::as_str) != Some("lefi.hw.v1")
    {
        return Err(SetupError::new(
            "SCAN_FAILED",
            "The hardware scan returned an unexpected report.",
        ));
    }
    Ok(report)
}

#[derive(Debug, Serialize)]
pub struct PlanPreview {
    pub events: Vec<Value>,
    pub output: Vec<String>,
    pub exit_code: Option<i32>,
    pub answers: String,
}

fn render_answers(answers: &SetupAnswers, layout: &Layout) -> Result<String> {
    let models = load_models(layout)?;
    answers.render(&Target {
        linux: installer::is_linux(),
        debug_build: cfg!(debug_assertions),
        models: &models,
    })
}

fn system_install(answers: &SetupAnswers) -> bool {
    installer::is_linux()
        && answers.service_mode.unwrap_or(ServiceMode::Systemd) == ServiceMode::Systemd
}

/// `install.sh --dry-run`: the installer's real plan for these answers; nothing changes.
#[tauri::command]
pub async fn preview_plan(answers: SetupAnswers) -> Result<PlanPreview> {
    installer::unsupported_os()?;
    let layout = Layout::locate()?;
    let text = render_answers(&answers, &layout)?;
    let file = AnswersFile::write(&text)?;
    let args = ["--dry-run", "--answers", file.path(), "--events", "ndjson"];
    let cmd = installer::command(&layout.install_sh(), &args, None);
    let (mut events, mut output) = (Vec::new(), Vec::new());
    let res = installer::run(cmd, |m| match m {
        InstallerMsg::Event { event } => events.push(event),
        InstallerMsg::Output { line } => output.push(line),
    })
    .await?;
    Ok(PlanPreview {
        events,
        output,
        exit_code: res.exit_code,
        answers: text,
    })
}

/// The real installation. Events stream to the UI through `on_event` as they happen.
#[tauri::command]
pub async fn run_install(
    answers: SetupAnswers,
    on_event: Channel<InstallerMsg>,
    runner: State<'_, Runner>,
    activation: State<'_, Activation>,
    sessions: State<'_, Sessions>,
) -> Result<RunResult> {
    if let Some(reason) = os_gate() {
        return Err(SetupError::new("INSTALL_NOT_ALLOWED", reason));
    }
    // Nothing is installed before activation (ADR-027); checked here, not only in the UI.
    if !activation.install_allowed()? {
        return Err(SetupError::new(
            "ACTIVATION_REQUIRED",
            "Enter the activation code from Lefi before installing.",
        ));
    }
    let layout = Layout::locate()?;
    let text = render_answers(&answers, &layout)?;
    let _guard = runner.acquire()?;
    let elevate = installer::elevation_tool(system_install(&answers));
    if system_install(&answers) && !installer::is_root() && elevate.is_none() {
        return Err(SetupError::new(
            "NEEDS_ROOT",
            "The Linux system install needs administrator rights and pkexec is not installed.",
        )
        .with_hint("Install polkit (pkexec), or run: sudo ./scripts/install.sh"));
    }
    let file = AnswersFile::write(&text)?;
    let cancel = runner.arm_cancel();
    let cancel_arg = cancel.to_string_lossy().to_string();
    let args = [
        "--answers",
        file.path(),
        "--events",
        "ndjson",
        "--cancel-file",
        cancel_arg.as_str(),
    ];
    let cmd = installer::command(&layout.install_sh(), &args, elevate.as_deref());
    sessions.begin(&answers);
    let res = installer::run_tracked(
        cmd,
        |pid| sessions.started(pid),
        |m| {
            if let InstallerMsg::Event { event } = &m {
                if event["event"] == "plan.started" {
                    if let Some(j) = event["journal"].as_str() {
                        sessions.journal(j);
                    }
                }
            }
            let _ = on_event.send(m);
        },
    )
    .await;
    runner.disarm_cancel();
    sessions.finish(res.as_ref().ok().and_then(|r| r.exit_code));
    res
}

#[derive(Debug, Serialize)]
pub struct AiNodeCheck {
    /// The address as the installer will use it (`http://host:port`).
    pub url: String,
    pub reachable: bool,
    /// Models that node serves and `config/supported-models.tsv` lists.
    pub models: Vec<String>,
}

/// Reads what an AI node serves (`GET /api/tags`). Nothing is loaded or changed there: the real
/// generation with the whole model on its GPU stays the installer's check (ADR-028).
#[tauri::command]
pub async fn check_ai_node(url: String) -> Result<AiNodeCheck> {
    let layout = Layout::locate()?;
    let supported = load_models(&layout)?;
    probe_ai_node(&url, &supported).await
}

async fn probe_ai_node(raw: &str, supported: &[SupportedModel]) -> Result<AiNodeCheck> {
    let url = crate::answers::normalize_ai_url(raw)?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(4))
        .no_proxy()
        .build()
        .map_err(|e| SetupError::new("AI_CHECK", e.to_string()))?;
    let Ok(resp) = client.get(format!("{url}/api/tags")).send().await else {
        return Ok(AiNodeCheck {
            url,
            reachable: false,
            models: vec![],
        });
    };
    let tags: Value = resp.json().await.unwrap_or(Value::Null);
    let models = tags["models"]
        .as_array()
        .map(|list| {
            list.iter()
                .filter_map(|m| m["name"].as_str())
                .filter(|name| supported.iter().any(|s| s.tag == *name))
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    Ok(AiNodeCheck {
        url,
        reachable: true,
        models,
    })
}

/// The last installation on this PC, also after the app was closed or lost mid-run (ADR-039).
#[tauri::command]
pub fn install_session(sessions: State<'_, Sessions>) -> SessionView {
    sessions.view()
}

/// Cancel: the installer stops at its next safe point (between steps, or during the model
/// download) and undoes everything this run changed (ADR-032). Its events report the rollback.
#[tauri::command]
pub fn cancel_install(runner: State<'_, Runner>) -> Result<bool> {
    runner.request_cancel()
}

/// `install.sh --rollback`: undoes the newest install run from its journal (after a failure).
#[tauri::command]
pub async fn run_rollback(
    on_event: Channel<InstallerMsg>,
    runner: State<'_, Runner>,
    sessions: State<'_, Sessions>,
    activation: State<'_, Activation>,
) -> Result<RunResult> {
    installer::unsupported_os()?;
    if crate::console::Paths::locate()?.finished_for(&activation.status()?.data_dir) {
        return Err(SetupError::new(
            "ADMIN_REQUIRED",
            "After setup, changes are undone from Apps or Settings, with the administrator password.",
        ));
    }
    let layout = Layout::locate()?;
    let _guard = runner.acquire()?;
    // A Linux system install was made as root; undoing it needs root too.
    let system =
        installer::is_linux() && std::path::Path::new("/etc/lefi-crop/install.conf").exists();
    let elevate = installer::elevation_tool(system);
    // Every run of this installation when it was continued; otherwise the newest run.
    let journals = sessions.journals();
    let mut args = vec!["--rollback", "--events", "ndjson"];
    for j in &journals {
        args.extend(["--journal", j.as_str()]);
    }
    let cmd = installer::command(&layout.install_sh(), &args, elevate.as_deref());
    let res = installer::run(cmd, |m| {
        let _ = on_event.send(m);
    })
    .await;
    if matches!(&res, Ok(r) if r.exit_code == Some(0)) {
        sessions.clear();
    }
    res
}

/// `install.sh --update-brain` (ADR-036): the new Brain next to the running one, database backup,
/// migration, switch, health check — and back to the previous Brain on any failure.
#[tauri::command]
pub async fn run_brain_update(
    on_event: Channel<InstallerMsg>,
    runner: State<'_, Runner>,
    activation: State<'_, Activation>,
) -> Result<RunResult> {
    installer::unsupported_os()?;
    if activation.status()?.licence.is_none() {
        return Err(SetupError::new(
            "ACTIVATION_REQUIRED",
            "Activate this PC first.",
        ));
    }
    let layout = Layout::locate()?;
    let _guard = runner.acquire()?;
    let cmd = installer::command(
        &layout.install_sh(),
        &["--update-brain", "--events", "ndjson"],
        None,
    );
    installer::run(cmd, |m| {
        let _ = on_event.send(m);
    })
    .await
}

/// `install.sh --check`: verifies the roles recorded on this machine.
#[tauri::command]
pub async fn run_check(
    on_event: Channel<InstallerMsg>,
    runner: State<'_, Runner>,
) -> Result<RunResult> {
    installer::unsupported_os()?;
    let layout = Layout::locate()?;
    let _guard = runner.acquire()?;
    let cmd = installer::command(
        &layout.install_sh(),
        &["--check", "--events", "ndjson"],
        None,
    );
    installer::run(cmd, |m| {
        let _ = on_event.send(m);
    })
    .await
}

/// Real runs against this checkout's installer. Not part of the default suite: they need a
/// macOS/Linux machine and take a few seconds. `cargo test -- --ignored`.
#[cfg(test)]
mod ai_node_tests {
    use super::*;
    use std::io::{Read, Write};

    fn fake_model(tag: &str) -> SupportedModel {
        crate::models::parse(&format!("{tag}\tp\tFake\tdefault\t?\t?\t?\tfake\n")).remove(0)
    }

    /// A FAKE node on loopback that answers once with this body.
    fn fake_node(body: &'static str) -> String {
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        std::thread::spawn(move || {
            let (mut s, _) = l.accept().unwrap();
            let mut buf = [0u8; 1024];
            let _ = s.read(&mut buf);
            let _ = write!(
                s,
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
        });
        format!("http://127.0.0.1:{port}")
    }

    #[tokio::test]
    async fn lists_only_the_supported_models_it_serves() {
        lefi_helperd::init_crypto();
        let url = fake_node(r#"{"models":[{"name":"fake:other"},{"name":"fake:good"}]}"#);
        let c = probe_ai_node(&url, &[fake_model("fake:good")])
            .await
            .unwrap();
        assert!(c.reachable);
        assert_eq!(c.models, vec!["fake:good"]);
    }

    #[tokio::test]
    async fn something_else_answering_serves_no_model() {
        lefi_helperd::init_crypto();
        let url = fake_node("<html>a router page</html>");
        let c = probe_ai_node(&url, &[fake_model("fake:good")])
            .await
            .unwrap();
        assert!(c.reachable && c.models.is_empty());
    }

    #[tokio::test]
    async fn silence_is_not_reachable_and_a_bad_address_is_refused() {
        lefi_helperd::init_crypto();
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        drop(l);
        let c = probe_ai_node(&format!("http://127.0.0.1:{port}"), &[])
            .await
            .unwrap();
        assert!(!c.reachable);
        assert!(probe_ai_node("ftp://x", &[]).await.is_err());
    }
}

#[cfg(test)]
mod real_installer {
    use super::*;
    use crate::answers::Role;

    fn all_in_one() -> SetupAnswers {
        serde_json::from_value(serde_json::json!({
            "roles": ["ai", "core", "admin"],
            "model": "recommended",
            "stop_conflicting_services": true,
            "service_mode": if installer::is_linux() { Some("user") } else { None },
            "dev_allow_no_ai": installer::is_linux(),
        }))
        .unwrap()
    }

    #[tokio::test]
    #[ignore]
    async fn scan_returns_a_hw_v1_report() {
        let r = scan_hardware().await.unwrap();
        assert_eq!(r["schema"], "lefi.hw.v1");
        assert!(r["recommendation"]["verdict"].is_string());
    }

    #[tokio::test]
    #[ignore]
    async fn dry_run_plan_declares_every_step_and_succeeds() {
        let p = preview_plan(all_in_one()).await.unwrap();
        assert_eq!(p.exit_code, Some(0), "{}", p.output.join("\n"));
        let started = p
            .events
            .iter()
            .find(|e| e["event"] == "plan.started")
            .unwrap();
        assert_eq!(started["dry_run"], true);
        let total = started["steps_total"].as_u64().unwrap();
        let done = p.events.iter().find(|e| e["event"] == "plan.done").unwrap();
        assert_eq!(done["result"], "ok");
        assert_eq!(done["steps_done"].as_u64().unwrap(), total);
        assert!(p.answers.contains("ROLES=ai,core,admin"));
    }

    #[tokio::test]
    #[ignore]
    async fn invalid_answers_never_reach_the_installer() {
        let mut a = all_in_one();
        a.roles = vec![Role::Core];
        a.ai_url = Some("http://x/$(id)".into());
        assert_eq!(preview_plan(a).await.unwrap_err().code, "ANSWERS_INVALID");
    }
}
