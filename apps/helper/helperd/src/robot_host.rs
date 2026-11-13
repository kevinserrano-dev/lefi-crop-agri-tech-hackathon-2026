//! The simulated robot as a component Lefi Brain asks for (ADR-090).
//!
//! Lefi Brain runs on the main PC; it reaches these routes on the console listener (loopback only)
//! with its own token, which allows nothing else: where the robot may go, install it there, turn it
//! on or off, remove it. The work is done by the bash installer (`install.sh --roles robot`,
//! `--remove-role robot`) and `lefi robot start|stop|status` — the only engine. The robot is never
//! placed on the PC of the AI node, and for now only on the main PC (other PCs would need an
//! encrypted link to Lefi Brain).

use std::path::{Path, PathBuf};
use std::sync::Arc;

use axum::extract::{Path as UrlPath, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, BufReader};

use crate::main_node::{now, Shared};
use crate::registry::{connectivity, Node};

pub const MAIN_ID: &str = "main";

/// One install or removal at a time, in memory (it ends with the installer's own events).
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct RobotJob {
    pub id: String,
    /// install · remove
    pub kind: String,
    pub node_id: String,
    pub backend: Option<String>,
    /// running · done · failed
    pub state: String,
    pub started_at: u64,
    pub finished_at: Option<u64>,
    pub steps_done: u64,
    pub steps_total: u64,
    pub title: Option<String>,
    pub message: Option<String>,
    pub error_code: Option<String>,
    /// The installer ended `failed` with no failed step: only its final check of the PC's
    /// components failed. Decided once it exits (is the robot installed?), never shown half-way.
    #[serde(skip)]
    pub checks_failed: bool,
}

impl RobotJob {
    pub fn new(id: String, kind: &str, node_id: &str, backend: Option<String>, at: u64) -> Self {
        Self {
            id,
            kind: kind.into(),
            node_id: node_id.into(),
            backend,
            state: "running".into(),
            started_at: at,
            finished_at: None,
            steps_done: 0,
            steps_total: 0,
            title: None,
            message: None,
            error_code: None,
            checks_failed: false,
        }
    }

    /// Folds one installer event (`--events ndjson`, INSTALLER.md §3.2) into the job.
    pub fn apply(&mut self, line: &str, at: u64) {
        let Ok(ev) = serde_json::from_str::<Value>(line) else {
            return;
        };
        let s = |k: &str| ev.get(k).and_then(Value::as_str).map(str::to_string);
        if let Some(t) = ev.get("steps_total").and_then(Value::as_u64) {
            self.steps_total = t;
        }
        if let Some(d) = ev.get("steps_done").and_then(Value::as_u64) {
            self.steps_done = self.steps_done.max(d);
        }
        match ev.get("event").and_then(Value::as_str) {
            Some("step.started") => self.title = s("title").filter(|t| !t.is_empty()),
            Some("step.log") | Some("step.warn") => self.message = s("message"),
            Some("step.failed") => {
                self.error_code = s("code");
                self.message = s("message");
            }
            Some("plan.done") => {
                if s("result").as_deref() == Some("ok") {
                    self.state = "done".into();
                    self.steps_done = self.steps_total;
                    self.finished_at = Some(at);
                } else if self.error_code.is_some() || self.kind != "install" {
                    self.state = "failed".into();
                    self.finished_at = Some(at);
                } else {
                    self.checks_failed = true; // still running until the robot is checked
                }
            }
            _ => {}
        }
    }

    /// Installed, although the installer's final check of the other components failed.
    pub fn accept_with_warning(&mut self, at: u64) {
        self.state = "done".into();
        self.finished_at = Some(at);
        self.steps_done = self.steps_total;
        self.message = Some(
            "Installed. The final check of this PC's other components reported problems: see the installer log."
                .into(),
        );
    }

    /// The installer ended: without its `plan.done`, its exit code decides.
    pub fn finish(&mut self, exit_ok: bool, at: u64) {
        if self.state == "running" {
            self.state = if exit_ok { "done" } else { "failed" }.into();
            self.finished_at = Some(at);
        }
    }
}

/// Where the robot may be installed, and why not elsewhere.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Place {
    pub node_id: String,
    pub name: String,
    pub is_main: bool,
    pub online: bool,
    pub eligible: bool,
    /// ai_node · other_pc · offline (null when eligible)
    pub reason: Option<String>,
    pub robot_installed: bool,
}

/// Pure: the main PC is eligible unless the AI node is there (its own AI service, or the AI that
/// Lefi Brain uses lives on it); the other PCs are listed with the reason they are not, yet.
pub fn places(
    main_name: &str,
    main_ai: bool,
    main_robot: bool,
    nodes: &[Node],
    at: u64,
) -> Vec<Place> {
    let mut out = vec![Place {
        node_id: MAIN_ID.into(),
        name: main_name.into(),
        is_main: true,
        online: true,
        eligible: !main_ai,
        reason: main_ai.then(|| "ai_node".into()),
        robot_installed: main_robot,
    }];
    for n in nodes.iter().filter(|n| !n.revoked) {
        let comps = n
            .last_heartbeat
            .as_ref()
            .and_then(|h| h.report.as_ref())
            .map(|r| r.components.clone())
            .unwrap_or_default();
        let has = |id: &str| comps.iter().any(|c| c.id == id && c.installed);
        let online = connectivity(n, at) == "online";
        let reason = if has("ai") || n.assigned.iter().any(|r| r == "ai") {
            "ai_node"
        } else if !online {
            "offline"
        } else {
            "other_pc"
        };
        out.push(Place {
            node_id: n.id.clone(),
            name: if n.name.is_empty() {
                n.hostname.clone()
            } else {
                n.name.clone()
            },
            is_main: false,
            online,
            eligible: false,
            reason: Some(reason.into()),
            robot_installed: has("robot"),
        });
    }
    out
}

/// Whether an AI address points at this PC (loopback or one of its LAN addresses).
pub fn url_is_here(url: &str, lan_ips: &[std::net::IpAddr]) -> bool {
    let host = url
        .split("://")
        .nth(1)
        .unwrap_or(url)
        .split(['/', ':'])
        .next()
        .unwrap_or("");
    if host == "localhost" {
        return true;
    }
    host.parse::<std::net::IpAddr>()
        .is_ok_and(|ip| ip.is_loopback() || lan_ips.contains(&ip))
}

/// The answers the installer gets: nothing is asked (ADR-030). On Linux the robot is a per-user
/// service (the installer refuses it in a system install, with its reason).
pub fn answers(backend: &str, cpu: bool) -> String {
    format!(
        "CONTINUE=yes\nROBOT_BACKEND={backend}\nROBOT_DOWNLOAD=yes\nROBOT_CPU={}\nINSTALL_CLI=no\n{}",
        if cpu { "yes" } else { "no" },
        if cfg!(target_os = "linux") { "SERVICE_MODE=user\n" } else { "" }
    )
}

// ------------------------------------------------------------------ token and link file

/// Lefi Brain's state folder on this PC (where its `.env` lives).
fn brain_state_dir(s: &Shared) -> Option<PathBuf> {
    s.cfg
        .cli_env
        .iter()
        .find(|(k, _)| k == "LEFI_STATE_DIR")
        .map(|(_, v)| PathBuf::from(v))
        .or_else(|| std::env::var_os("LEFI_STATE_DIR").map(PathBuf::from))
        .or_else(|| Some(PathBuf::from(std::env::var_os("HOME")?).join(".lefi-crop")))
}

fn write_private(path: &Path, text: &str) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
        opts.mode(0o600);
        let f = opts.open(path)?;
        f.set_permissions(std::fs::Permissions::from_mode(0o600))?;
        drop(f);
    }
    use std::io::Write;
    opts.open(path)?.write_all(text.as_bytes())
}

/// `<Lefi Brain state>/helper/link.json` (600): where Lefi Brain finds this service and its token.
pub fn write_brain_link(s: &Shared) {
    let Some(dir) = brain_state_dir(s) else {
        return;
    };
    let link = json!({
        "url": format!("http://127.0.0.1:{}", s.cfg.admin_port),
        "token": s.brain_token,
        "written_at": now(),
    });
    if let Err(e) = write_private(&dir.join("helper").join("link.json"), &link.to_string()) {
        eprintln!("robot: could not write Lefi Brain's link file: {e}");
    }
}

fn brain_authorised(s: &Shared, headers: &HeaderMap) -> bool {
    let want = format!("Bearer {}", s.brain_token);
    headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| {
            v.len() == want.len()
                && v.bytes()
                    .zip(want.bytes())
                    .fold(0u8, |a, (x, y)| a | (x ^ y))
                    == 0
        })
}

fn refuse(status: StatusCode, code: &str, message: &str) -> Response {
    (
        status,
        Json(json!({ "error": { "code": code, "message": message } })),
    )
        .into_response()
}

// ------------------------------------------------------------------ what is on the main PC

async fn main_status(s: &Shared) -> Value {
    let mut status = crate::main_node::lefi_json(s, &["robot", "status", "--json"])
        .await
        .unwrap_or(Value::Null);
    with_log_tail(&mut status);
    status
}

/// While the simulator is not answering, its log's last lines go with the status, so Lefi Desktop
/// can show what it is doing (building the scene) or why it stopped (ADR-104).
fn with_log_tail(status: &mut Value) {
    let installed = status.get("installed").and_then(Value::as_bool) == Some(true);
    let answering = status.get("answering").and_then(Value::as_bool) == Some(true);
    if !installed || answering {
        return;
    }
    let Some(log) = status.get("log").and_then(Value::as_str).map(PathBuf::from) else {
        return;
    };
    if let Some(text) = read_tail(&log, 16 * 1024) {
        let tail = crate::main_node::last_lines(&text, 12);
        if let Some(o) = status.as_object_mut() {
            o.insert("log_tail".into(), Value::String(tail));
        }
    }
}

/// The last `max` bytes of a file, as text (a log may be large; only its end matters).
fn read_tail(path: &Path, max: u64) -> Option<String> {
    use std::io::{Read, Seek, SeekFrom};
    let mut f = std::fs::File::open(path).ok()?;
    let len = f.metadata().ok()?.len();
    f.seek(SeekFrom::Start(len.saturating_sub(max))).ok()?;
    let mut buf = Vec::new();
    f.read_to_end(&mut buf).ok()?;
    Some(String::from_utf8_lossy(&buf).into_owned())
}

async fn main_ai(s: &Shared, status: &Value) -> bool {
    let ai_here = status
        .get("ai_here")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let brain_ai_here =
        crate::main_node::brain_ai_url(s).is_some_and(|u| url_is_here(&u, &s.cfg.lan_ips));
    ai_here || brain_ai_here
}

async fn current_places(s: &Shared) -> (Vec<Place>, Value) {
    let status = main_status(s).await;
    let ai = main_ai(s, &status).await;
    let installed = status
        .get("installed")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let nodes = s.registry.lock().expect("registry lock").nodes.clone();
    (
        places(crate::names::MAIN_NAME, ai, installed, &nodes, now()),
        status,
    )
}

// ------------------------------------------------------------------ routes

#[derive(Deserialize)]
struct InstallReq {
    node_id: String,
    backend: String,
    #[serde(default)]
    cpu: bool,
}

#[derive(Deserialize)]
struct NodeReq {
    node_id: String,
}

#[derive(Deserialize)]
struct PowerReq {
    node_id: String,
    on: bool,
}

async fn r_places(State(s): State<Arc<Shared>>, headers: HeaderMap) -> Response {
    if !brain_authorised(&s, &headers) {
        return refuse(StatusCode::UNAUTHORIZED, "UNAUTHENTICATED", "Wrong token.");
    }
    let (places, _) = current_places(&s).await;
    Json(json!({ "places": places })).into_response()
}

async fn r_status(State(s): State<Arc<Shared>>, headers: HeaderMap) -> Response {
    if !brain_authorised(&s, &headers) {
        return refuse(StatusCode::UNAUTHORIZED, "UNAUTHENTICATED", "Wrong token.");
    }
    let status = main_status(&s).await;
    let job = s.robot_job.lock().expect("robot job lock").clone();
    Json(json!({ "node_id": MAIN_ID, "robot": status, "job": job })).into_response()
}

async fn r_job(
    State(s): State<Arc<Shared>>,
    headers: HeaderMap,
    UrlPath(id): UrlPath<String>,
) -> Response {
    if !brain_authorised(&s, &headers) {
        return refuse(StatusCode::UNAUTHORIZED, "UNAUTHENTICATED", "Wrong token.");
    }
    match s.robot_job.lock().expect("robot job lock").clone() {
        Some(j) if j.id == id => Json(j).into_response(),
        _ => refuse(StatusCode::NOT_FOUND, "JOB_UNKNOWN", "No such robot job."),
    }
}

/// Checks a request names an eligible place; the reason otherwise.
async fn check_place(s: &Shared, node_id: &str, installing: bool) -> Result<(), Response> {
    let (places, _) = current_places(s).await;
    let Some(p) = places.iter().find(|p| p.node_id == node_id) else {
        return Err(refuse(
            StatusCode::NOT_FOUND,
            "NODE_UNKNOWN",
            "No such PC in this installation.",
        ));
    };
    if !p.is_main {
        return Err(refuse(
            StatusCode::CONFLICT,
            "ROBOT_PLACE",
            "For now the simulated robot runs only on the main PC.",
        ));
    }
    if installing && !p.eligible {
        return Err(refuse(
            StatusCode::CONFLICT,
            "ROBOT_ON_AI_NODE",
            "This PC runs the AI node: the simulated robot is not installed there.",
        ));
    }
    Ok(())
}

// The error is the HTTP answer itself, built once and returned as is.
#[allow(clippy::result_large_err)]
fn start_job(
    s: &Arc<Shared>,
    kind: &str,
    node_id: &str,
    backend: Option<String>,
    args: Vec<String>,
) -> Result<RobotJob, Response> {
    let Some(root) = s.cfg.payload_root.clone() else {
        return Err(refuse(
            StatusCode::SERVICE_UNAVAILABLE,
            "NO_INSTALLER",
            "This service has no installer to run.",
        ));
    };
    let installer = root.join("scripts/install.sh");
    if !installer.is_file() {
        return Err(refuse(
            StatusCode::SERVICE_UNAVAILABLE,
            "NO_INSTALLER",
            "The installer is missing.",
        ));
    }
    let mut slot = s.robot_job.lock().expect("robot job lock");
    if slot.as_ref().is_some_and(|j| j.state == "running") {
        return Err(refuse(
            StatusCode::CONFLICT,
            "ROBOT_BUSY",
            "The robot is already being installed or removed.",
        ));
    }
    let mut b = [0u8; 8];
    let _ = getrandom::getrandom(&mut b);
    let id: String = b.iter().map(|x| format!("{x:02x}")).collect();
    let job = RobotJob::new(id, kind, node_id, backend, now());
    *slot = Some(job.clone());
    drop(slot);
    let shared = s.clone();
    tokio::spawn(async move { run_installer(shared, installer, args).await });
    Ok(job)
}

async fn run_installer(s: Arc<Shared>, installer: PathBuf, args: Vec<String>) {
    let mut c = tokio::process::Command::new(&installer);
    c.args(&args)
        .env(
            "PATH",
            format!(
                "/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/local/sbin:/usr/bin:/bin:/usr/sbin:/sbin:{}",
                std::env::var("PATH").unwrap_or_default()
            ),
        )
        .env("NO_COLOR", "1")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null());
    for (k, v) in &s.cfg.cli_env {
        c.env(k, v);
    }
    let set = |f: &dyn Fn(&mut RobotJob)| {
        if let Some(j) = s.robot_job.lock().expect("robot job lock").as_mut() {
            f(j);
        }
    };
    let mut child = match c.spawn() {
        Ok(child) => child,
        Err(e) => {
            set(&|j| {
                j.message = Some(format!("Could not start the installer: {e}"));
                j.finish(false, now());
            });
            return;
        }
    };
    if let Some(out) = child.stdout.take() {
        let mut lines = BufReader::new(out).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            set(&|j| j.apply(&line, now()));
        }
    }
    let ok = child.wait().await.is_ok_and(|st| st.success());
    // No step failed, only the final check (it looks at every component of this PC): when the
    // robot really is installed, the install counts as done, with the reason kept.
    let check = s
        .robot_job
        .lock()
        .expect("robot job lock")
        .as_ref()
        .is_some_and(|j| j.state == "running" && j.checks_failed);
    if check {
        let installed = crate::main_node::lefi_json(&s, &["robot", "status", "--json"])
            .await
            .and_then(|v| v.get("installed").and_then(Value::as_bool))
            .unwrap_or(false);
        set(&|j| {
            if installed {
                j.accept_with_warning(now());
            } else {
                j.finish(false, now());
            }
        });
    } else {
        set(&|j| j.finish(ok, now()));
    }
}

async fn r_install(
    State(s): State<Arc<Shared>>,
    headers: HeaderMap,
    Json(req): Json<InstallReq>,
) -> Response {
    if !brain_authorised(&s, &headers) {
        return refuse(StatusCode::UNAUTHORIZED, "UNAUTHENTICATED", "Wrong token.");
    }
    if !matches!(req.backend.as_str(), "genesis" | "lite") {
        return refuse(
            StatusCode::BAD_REQUEST,
            "BAD_REQUEST",
            "backend must be genesis or lite.",
        );
    }
    if let Err(r) = check_place(&s, &req.node_id, true).await {
        return r;
    }
    let file = s.cfg.data_dir.join("fleet").join("robot-answers.env");
    if let Err(e) = write_private(&file, &answers(&req.backend, req.cpu)) {
        return refuse(
            StatusCode::INTERNAL_SERVER_ERROR,
            "ANSWERS_WRITE",
            &e.to_string(),
        );
    }
    let args = vec![
        "--roles".into(),
        "robot".into(),
        "--answers".into(),
        file.display().to_string(),
        "--events".into(),
        "ndjson".into(),
    ];
    match start_job(&s, "install", &req.node_id, Some(req.backend.clone()), args) {
        Ok(job) => (StatusCode::ACCEPTED, Json(job)).into_response(),
        Err(r) => r,
    }
}

async fn r_remove(
    State(s): State<Arc<Shared>>,
    headers: HeaderMap,
    Json(req): Json<NodeReq>,
) -> Response {
    if !brain_authorised(&s, &headers) {
        return refuse(StatusCode::UNAUTHORIZED, "UNAUTHENTICATED", "Wrong token.");
    }
    if let Err(r) = check_place(&s, &req.node_id, false).await {
        return r;
    }
    let args = vec![
        "--remove-role".into(),
        "robot".into(),
        "--events".into(),
        "ndjson".into(),
    ];
    match start_job(&s, "remove", &req.node_id, None, args) {
        Ok(job) => (StatusCode::ACCEPTED, Json(job)).into_response(),
        Err(r) => r,
    }
}

async fn r_power(
    State(s): State<Arc<Shared>>,
    headers: HeaderMap,
    Json(req): Json<PowerReq>,
) -> Response {
    if !brain_authorised(&s, &headers) {
        return refuse(StatusCode::UNAUTHORIZED, "UNAUTHENTICATED", "Wrong token.");
    }
    if let Err(r) = check_place(&s, &req.node_id, false).await {
        return r;
    }
    if s.robot_job
        .lock()
        .expect("robot job lock")
        .as_ref()
        .is_some_and(|j| j.state == "running")
    {
        return refuse(
            StatusCode::CONFLICT,
            "ROBOT_BUSY",
            "The robot is being installed or removed.",
        );
    }
    let verb = if req.on { "start" } else { "stop" };
    if let Err(why) = crate::main_node::lefi_run(&s, &["robot", verb]).await {
        let why = why.trim();
        return refuse(
            StatusCode::CONFLICT,
            "ROBOT_POWER",
            &if why.is_empty() {
                format!("lefi robot {verb} failed with no message")
            } else {
                format!("lefi robot {verb} failed: {why}")
            },
        );
    }
    Json(json!({ "node_id": req.node_id, "robot": main_status(&s).await })).into_response()
}

pub fn router(shared: Arc<Shared>) -> Router {
    Router::new()
        .route("/brain/robot/places", get(r_places))
        .route("/brain/robot/status", get(r_status))
        .route("/brain/robot/jobs/{id}", get(r_job))
        .route("/brain/robot/install", post(r_install))
        .route("/brain/robot/remove", post(r_remove))
        .route("/brain/robot/power", post(r_power))
        .with_state(shared)
}

#[cfg(test)]
mod tests {

    #[test]
    fn a_robot_that_is_not_answering_carries_its_logs_last_lines() {
        let d = tempfile::tempdir().unwrap();
        let log = d.path().join("robot-sim.log");
        let body: String = (1..=30).map(|i| format!("line {i}\n\n")).collect();
        std::fs::write(&log, body).unwrap();
        let mut st = json!({"installed": true, "running": false, "answering": false,
                            "log": log.display().to_string()});
        with_log_tail(&mut st);
        let tail = st["log_tail"].as_str().unwrap();
        assert_eq!(tail.lines().count(), 12);
        assert!(tail.starts_with("line 19") && tail.ends_with("line 30"));
        let mut on =
            json!({"installed": true, "answering": true, "log": log.display().to_string()});
        with_log_tail(&mut on);
        assert!(
            on.get("log_tail").is_none(),
            "an answering robot needs no log"
        );
    }

    use super::*;

    #[test]
    fn a_job_follows_the_installers_events() {
        let mut j = RobotJob::new("j1".into(), "install", MAIN_ID, Some("lite".into()), 1);
        j.apply(r#"{"event":"plan.started","steps_total":4}"#, 2);
        j.apply(
            r#"{"event":"step.started","step":"robot.install","steps_done":2,"steps_total":4,"title":"Robot simulator"}"#,
            3,
        );
        j.apply(
            r#"{"event":"step.log","level":"info","message":"Preparing Python"}"#,
            4,
        );
        assert_eq!(
            (
                j.steps_done,
                j.steps_total,
                j.title.as_deref(),
                j.message.as_deref()
            ),
            (2, 4, Some("Robot simulator"), Some("Preparing Python"))
        );
        j.apply(r#"{"event":"plan.done","result":"ok"}"#, 5);
        assert_eq!(
            (j.state.as_str(), j.steps_done, j.finished_at),
            ("done", 4, Some(5))
        );
        j.finish(false, 6); // the exit code no longer changes a finished job
        assert_eq!(j.state, "done");
    }

    #[test]
    fn only_the_final_check_failing_is_decided_after_the_installer_exits() {
        let mut j = RobotJob::new("j3".into(), "install", MAIN_ID, None, 1);
        j.apply(r#"{"event":"plan.started","steps_total":5}"#, 2);
        j.apply(r#"{"event":"plan.done","result":"failed"}"#, 3);
        assert_eq!((j.state.as_str(), j.checks_failed), ("running", true));
        j.accept_with_warning(4);
        assert_eq!(
            (j.state.as_str(), j.steps_done, j.finished_at),
            ("done", 5, Some(4))
        );
        assert!(j.message.as_deref().unwrap().starts_with("Installed."));
    }

    #[test]
    fn a_failed_step_keeps_its_code_and_message() {
        let mut j = RobotJob::new("j2".into(), "install", MAIN_ID, None, 1);
        j.apply(
            r#"{"event":"step.failed","code":"ROBOT_ON_AI_NODE","message":"This PC runs the AI node"}"#,
            2,
        );
        j.apply("not json", 3);
        j.finish(false, 4);
        assert_eq!(
            (
                j.state.as_str(),
                j.error_code.as_deref(),
                j.message.as_deref()
            ),
            (
                "failed",
                Some("ROBOT_ON_AI_NODE"),
                Some("This PC runs the AI node")
            )
        );
    }

    fn node(id: &str, ai: bool, robot: bool, seen: Option<u64>) -> Node {
        let comp = |c: &str, on: bool| crate::protocol::ComponentState {
            id: c.into(),
            installed: on,
            state: if on { "installed" } else { "not_installed" }.into(),
            version: None,
            detail: None,
            path: None,
            paired: None,
        };
        let hb = crate::protocol::Heartbeat {
            report: Some(crate::protocol::NodeReport {
                components: vec![comp("ai", ai), comp("robot", robot)],
                ..Default::default()
            }),
            ..Default::default()
        };
        Node {
            id: id.into(),
            name: format!("lefi-{id}"),
            hostname: id.into(),
            ip: "192.0.2.5".into(),
            os: "macos".into(),
            arch: "arm64".into(),
            cert_fp: "x".into(),
            enrolled_at: 0,
            last_seen: seen,
            last_heartbeat: Some(hb),
            assigned: vec![],
            revoked: false,
            ai_link: None,
            desktop_pair_at: None,
            ai_bench: None,
        }
    }

    #[test]
    fn the_robot_never_goes_where_the_ai_node_is() {
        let nodes = [
            node("n1", true, false, Some(100)),
            node("n2", false, false, Some(100)),
            node("n3", false, false, Some(1)),
        ];
        let p = places("lefi-main", false, false, &nodes, 105);
        let summary: Vec<_> = p
            .iter()
            .map(|p| (p.node_id.as_str(), p.eligible, p.reason.as_deref()))
            .collect();
        assert_eq!(
            summary,
            [
                ("main", true, None),
                ("n1", false, Some("ai_node")),
                ("n2", false, Some("other_pc")),
                ("n3", false, Some("offline")),
            ]
        );
        let p = places("lefi-main", true, false, &[], 105);
        assert_eq!(
            (p[0].eligible, p[0].reason.as_deref()),
            (false, Some("ai_node"))
        );
    }

    #[test]
    fn an_ai_address_on_this_pc_is_recognised() {
        let lan = ["192.168.8.10".parse().unwrap()];
        assert!(url_is_here("http://127.0.0.1:11434", &lan));
        assert!(url_is_here("http://localhost:11434/", &lan));
        assert!(url_is_here("http://192.168.8.10:11434", &lan));
        assert!(!url_is_here("http://192.168.8.20:11434", &lan));
        assert!(!url_is_here("http://lefi-node-1.local:11434", &lan));
    }

    #[test]
    fn the_installer_is_never_asked_anything() {
        let a = answers("genesis", true);
        assert!(a.contains("ROBOT_BACKEND=genesis\n") && a.contains("ROBOT_CPU=yes\n"));
        assert!(a.contains("CONTINUE=yes\n") && a.contains("ROBOT_DOWNLOAD=yes\n"));
    }
}
