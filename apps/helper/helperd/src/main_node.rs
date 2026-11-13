//! Main PC mode: the join page, enrolment and heartbeats from satellites, and the console API.
//!
//! - `:8790` HTTP, LAN, read-only: `/` (the asking PC's home once joined), `/setup` page, `/setup/ca.pem`, `/setup/join.sh`,
//!   `/setup/update.sh`, the satellite binary, `/setup/me` and `/setup/me/log/{id}` (status and logs
//!   of the asking PC only — nothing about other PCs).
//! - `:8791` TLS, LAN: `POST /v1/enroll` (one-time code) and `POST /v1/heartbeat` (requires the
//!   client certificate issued at enrolment).
//! - `127.0.0.1:8792` HTTP, loopback only, bearer token in `<data>/fleet/admin.token` (600): the
//!   console used by the Lefi Crop Helper window.

use std::collections::{HashMap, VecDeque};
use std::net::{IpAddr, SocketAddr};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use axum::extract::{ConnectInfo, Path as UrlPath, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{Html, IntoResponse, Redirect, Response};
use axum::routing::{get, post};
use axum::{Extension, Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::net::TcpListener;

use crate::ca::{fingerprint, RootCa};
use crate::error::{io, Error, Result};
use crate::protocol::{
    CommandEvents, CommandEventsResponse, EnrollRequest, EnrollResponse, Heartbeat,
    HeartbeatResponse, PairingOffer, HEARTBEAT_SECS,
};
use crate::registry::{connectivity, AiLink, Registry};

pub struct MainConfig {
    pub data_dir: PathBuf,
    pub lan_ips: Vec<IpAddr>,
    pub bind: IpAddr,
    pub http_port: u16,
    pub tls_port: u16,
    pub admin_port: u16,
    /// Port of Ollama on the satellites (11434; tests use a fake server's port).
    pub ai_port: u16,
    /// Extra environment for `lefi` run by this service (tests: temporary config).
    pub cli_env: Vec<(String, String)>,
    /// The satellite program served on the join page (this PC's own binary by default).
    pub satellite_bin: Option<PathBuf>,
    /// A Lefi Crop checkout (or installed payload) whose installer is sent to satellites.
    pub payload_root: Option<PathBuf>,
    /// Announce `lefi-main.local` on the network (tests: no).
    pub publish_name: bool,
    /// Pair the Lefi Desktop of every joined PC by itself (ADR-050). Tests: only with a fake `lefi`.
    pub auto_pair_desktops: bool,
    /// Also the Lefi Desktop of this PC (its real HOME). Tests: never.
    pub auto_pair_local: bool,
}

pub struct Shared {
    pub registry: Mutex<Registry>,
    pub ca: RootCa,
    pub installation_id: String,
    pub max_pcs: u32,
    pub admin_token: String,
    pub cfg: MainConfig,
    pub satellite_sha256: Option<String>,
    /// The version that program answers (`lefi-helperd version`), measured at start (ADR-062).
    pub satellite_version: Option<String>,
    /// The Lefi Desktop the installer payload carries (its `Info.plist`), measured at start.
    pub desktop_version: Option<String>,
    /// The installer payload sent to satellites: `<data>/fleet/payload.tgz` and its SHA-256.
    pub payload: Option<(PathBuf, String)>,
    /// Recent load of each PC from its heartbeats (node id → oldest first), for the charts of its
    /// home page. In memory only: measurements, not records, and they restart with the service.
    pub samples: Mutex<HashMap<String, VecDeque<Value>>>,
    /// Lefi Brain's own token for the robot routes only (ADR-090); never the console's.
    pub brain_token: String,
    /// The robot's install or removal in progress or last finished (ADR-090).
    pub robot_job: Mutex<Option<crate::robot_host::RobotJob>>,
}

/// One hour of heartbeats at 10 s.
const SAMPLES_MAX: usize = 360;

/// What a heartbeat measured, reduced to the figures the home page charts.
fn sample_of(hb: &Heartbeat, t: u64) -> Option<Value> {
    let r = hb.report.as_ref()?;
    let m = &r.metrics;
    let ai_gb = r.ai.as_ref().map(|a| {
        let gb: f64 = a.loaded.iter().map(|l| l.size_gb).sum();
        (gb * 10.0).round() / 10.0
    });
    Some(json!({
        "t": t,
        "load_1m": m.load_1m,
        "memory_used_gb": m.memory_used_gb,
        "gpu_utilization_pct": m.gpu_utilization_pct,
        "gpu_memory_in_use_gb": m.gpu_memory_in_use_gb,
        "ai_loaded_gb": ai_gb,
    }))
}

/// Packs the installer files a satellite needs (bash installer, CLI, config, templates).
fn build_payload(root: &Path, data_dir: &Path) -> Result<(PathBuf, String)> {
    if !root.join("scripts/install.sh").is_file() {
        return Err(Error::new(
            "PAYLOAD_MISSING",
            format!("No installer in {}", root.display()),
        ));
    }
    let out = data_dir.join("fleet").join("payload.tgz");
    std::fs::create_dir_all(data_dir.join("fleet")).map_err(io("PAYLOAD_BUILD"))?;
    let entries: Vec<&str> = [
        "bin",
        "scripts",
        "config",
        "deploy",
        "desktop",
        ".env.example",
        "VERSION",
    ]
    .into_iter()
    .filter(|e| root.join(e).exists())
    .collect();
    let st = std::process::Command::new("tar")
        .arg("-czf")
        .arg(&out)
        .arg("-C")
        .arg(root)
        .args(&entries)
        .env("COPYFILE_DISABLE", "1") // no macOS ._ resource files in the archive
        .status()
        .map_err(io("PAYLOAD_BUILD"))?;
    if !st.success() {
        return Err(Error::new("PAYLOAD_BUILD", "tar failed"));
    }
    let bytes = std::fs::read(&out).map_err(io("PAYLOAD_BUILD"))?;
    Ok((out, fingerprint(&bytes)))
}

pub fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn fail(status: StatusCode, e: Error) -> Response {
    (status, Json(json!({ "error": e }))).into_response()
}

fn status_for(e: &Error) -> StatusCode {
    match e.code {
        "NODE_UNKNOWN" | "NODE_REVOKED" | "UNAUTHENTICATED" => StatusCode::UNAUTHORIZED,
        "CODE_INVALID" | "CODE_USED" | "CODE_EXPIRED" | "CODE_WRONG_PC" => StatusCode::FORBIDDEN,
        "LICENCE_PC_LIMIT" | "BRAIN_ONLY_ON_MAIN" | "AI_ALREADY_ASSIGNED" => StatusCode::CONFLICT,
        "ROLE_UNKNOWN" | "CSR_INVALID" | "BAD_REQUEST" => StatusCode::BAD_REQUEST,
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    }
}

/// What a service program answers to `version`: only a numeric `a.b.c` is believed.
fn program_version(bin: &Path) -> Option<String> {
    let out = std::process::Command::new(bin)
        .arg("version")
        .stdin(std::process::Stdio::null())
        .output()
        .ok()?;
    let v = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (out.status.success() && crate::jobs::version_at_least(&v, "0.0.0")).then_some(v)
}

/// What can be updated on a PC, from facts: its service's version against the program this main
/// PC shares, and its Lefi Desktop against the one in the installer payload (ADR-051, ADR-062).
/// `remote`: the service can replace itself; otherwise it is updated once with `update.sh`.
pub fn updates_for(s: &Shared, n: &crate::registry::Node) -> Value {
    let hb = n.last_heartbeat.as_ref();
    let service = match (
        hb,
        s.satellite_version.as_deref(),
        s.satellite_sha256.as_ref(),
    ) {
        (Some(h), Some(avail), Some(_)) if crate::protocol::is_newer(avail, &h.helperd_version) => {
            json!({
                "installed": h.helperd_version,
                "available": avail,
                "remote": crate::jobs::version_at_least(
                    &h.helperd_version,
                    crate::jobs::SELF_UPDATE_MIN_VERSION
                ) && h.report.is_some(),
            })
        }
        _ => Value::Null,
    };
    let desktop = hb
        .and_then(|h| h.report.as_ref())
        .and_then(|r| {
            r.components
                .iter()
                .find(|c| c.id == "desktop" && c.installed)
        })
        .and_then(|c| c.version.clone())
        .zip(s.desktop_version.clone())
        .filter(|(inst, avail)| crate::protocol::is_newer(avail, inst))
        .map(|(inst, avail)| json!({ "installed": inst, "available": avail }))
        .unwrap_or(Value::Null);
    json!({ "service": service, "desktop": desktop })
}

/// The platform key of a satellite binary (`macos-aarch64`, `linux-x86_64`, …).
pub fn platform_key() -> String {
    format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH)
}

/// This PC's LAN address: the source address the OS would use to reach the LAN (no packet sent).
pub fn detect_lan_ip() -> Option<IpAddr> {
    let s = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    s.connect("192.0.2.1:9").ok()?;
    s.local_addr()
        .ok()
        .map(|a| a.ip())
        .filter(|ip| !ip.is_loopback() && !ip.is_unspecified())
}

fn load_or_create_token(dir: &Path) -> Result<String> {
    load_or_create_named_token(dir, "admin.token")
}

fn load_or_create_named_token(dir: &Path, name: &str) -> Result<String> {
    let p = dir.join("fleet").join(name);
    if let Ok(t) = std::fs::read_to_string(&p) {
        if t.trim().len() >= 32 {
            return Ok(t.trim().to_string());
        }
    }
    std::fs::create_dir_all(dir.join("fleet")).map_err(io("TOKEN_WRITE"))?;
    let mut b = [0u8; 32];
    getrandom::getrandom(&mut b).map_err(|e| Error::new("TOKEN_WRITE", e.to_string()))?;
    let token: String = b.iter().map(|x| format!("{x:02x}")).collect();
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    use std::io::Write;
    opts.open(&p)
        .and_then(|mut f| f.write_all(token.as_bytes()))
        .map_err(io("TOKEN_WRITE"))?;
    Ok(token)
}

impl Shared {
    pub fn new(
        cfg: MainConfig,
        ca: RootCa,
        installation_id: String,
        max_pcs: u32,
    ) -> Result<Arc<Self>> {
        let registry = Registry::load(&cfg.data_dir)?;
        let admin_token = load_or_create_token(&cfg.data_dir)?;
        let brain_token = load_or_create_named_token(&cfg.data_dir, "brain.token")?;
        let payload = match &cfg.payload_root {
            Some(root) => match build_payload(root, &cfg.data_dir) {
                Ok(p) => Some(p),
                Err(e) => {
                    eprintln!("remote install disabled: {e}");
                    None
                }
            },
            None => None,
        };
        let satellite_sha256 = cfg
            .satellite_bin
            .as_ref()
            .and_then(|p| std::fs::read(p).ok())
            .map(|b| fingerprint(&b));
        let satellite_version = cfg.satellite_bin.as_ref().and_then(|p| program_version(p));
        let desktop_version = cfg
            .payload_root
            .as_ref()
            .and_then(|r| crate::report::bundle_version(&r.join("desktop").join("Lefi Crop.app")));
        Ok(Arc::new(Self {
            registry: Mutex::new(registry),
            ca,
            installation_id,
            max_pcs,
            admin_token,
            cfg,
            satellite_sha256,
            satellite_version,
            desktop_version,
            payload,
            samples: Mutex::new(HashMap::new()),
            brain_token,
            robot_job: Mutex::new(None),
        }))
    }

    fn main_ip(&self) -> String {
        self.cfg
            .lan_ips
            .first()
            .map(|i| i.to_string())
            .unwrap_or_else(|| "127.0.0.1".into())
    }

    pub fn join_url(&self) -> String {
        format!("http://{}:{}/setup", self.main_ip(), self.cfg.http_port)
    }

    fn join_command(&self, code: &str) -> String {
        format!(
            "curl -fsS http://{}:{}/setup/join.sh | sh -s -- {code}",
            self.main_ip(),
            self.cfg.http_port
        )
    }
}

// ------------------------------------------------------------------ join page (HTTP, LAN)

/// The page every PC opens: guided join, then that PC's own status (ADR-040). It shows only the
/// asking PC and changes nothing; all data is inserted as text by its script, never as HTML.
const SETUP_PAGE: &str = include_str!("setup.html");

fn page(shared: &Shared, view: &str) -> String {
    SETUP_PAGE
        .replace("__PAGE__", view)
        .replace("__IP__", &shared.main_ip())
        .replace("__HTTP__", &shared.cfg.http_port.to_string())
        .replace("__ID__", &shared.installation_id)
        .replace("__FP_SHORT__", &shared.ca.fingerprint[..16])
}

/// Updates the service of a PC that already joined; its certificate and registration stay.
fn update_script(shared: &Shared) -> String {
    let sha = shared.satellite_sha256.clone().unwrap_or_default();
    format!(
        r#"#!/bin/sh
# Lefi Crop Helper satellite update — served by the main PC {ip} (ADR-040).
set -eu
MAIN="{ip}"; WANT_SHA="{sha}"; PLATFORM="{platform}"
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) P=macos-aarch64 ;; Darwin-x86_64) P=macos-x86_64 ;;
  *) echo "This PC is not supported yet (macOS only for now)." >&2; exit 1 ;;
esac
[ "$P" = "$PLATFORM" ] || {{ echo "The main PC only has the service for $PLATFORM; this PC is $P." >&2; exit 1; }}
[ -n "$WANT_SHA" ] || {{ echo "The main PC has no service program to share." >&2; exit 1; }}
DIR="$HOME/.lefi-helper"
[ -f "$DIR/node/config.json" ] || {{ echo "This PC has not joined yet: follow http://$MAIN:{http}/setup" >&2; exit 1; }}
curl -fsS "http://$MAIN:{http}/setup/helperd/$P" -o "$DIR/bin/lefi-helperd.new"
GOT="$(shasum -a 256 "$DIR/bin/lefi-helperd.new" | awk '{{print $1}}')"
[ "$GOT" = "$WANT_SHA" ] || {{ rm -f "$DIR/bin/lefi-helperd.new"; echo "Download damaged (checksum mismatch)." >&2; exit 1; }}
chmod 755 "$DIR/bin/lefi-helperd.new"; mv "$DIR/bin/lefi-helperd.new" "$DIR/bin/lefi-helperd"
echo "Restarting the Lefi Crop Helper service; macOS asks for your password once."
sudo -p "Password for %u: " "$DIR/bin/lefi-helperd" install-service satellite --data "$DIR" --scope boot --user "$(id -un)"
echo "Done. Follow this PC on http://$MAIN:{http}/setup"
"#,
        ip = shared.main_ip(),
        http = shared.cfg.http_port,
        platform = platform_key(),
    )
}

fn join_script(shared: &Shared) -> String {
    let sha = shared.satellite_sha256.clone().unwrap_or_default();
    format!(
        r#"#!/bin/sh
# Lefi Crop Helper satellite setup — served by the main PC {ip} (ADR-033).
set -eu
CODE="${{1:?usage: sh join.sh JOIN-CODE}}"
MAIN="{ip}"; CA_FP="{fp}"; WANT_SHA="{sha}"; PLATFORM="{platform}"
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) P=macos-aarch64 ;; Darwin-x86_64) P=macos-x86_64 ;;
  *) echo "This PC is not supported yet (macOS only for now)." >&2; exit 1 ;;
esac
[ "$P" = "$PLATFORM" ] || {{ echo "The main PC only has the service for $PLATFORM; this PC is $P." >&2; exit 1; }}
[ -n "$WANT_SHA" ] || {{ echo "The main PC has no satellite program to share." >&2; exit 1; }}
DIR="$HOME/.lefi-helper"; mkdir -p "$DIR/bin"; chmod 700 "$DIR"
curl -fsS "http://$MAIN:{http}/setup/helperd/$P" -o "$DIR/bin/lefi-helperd.new"
GOT="$(shasum -a 256 "$DIR/bin/lefi-helperd.new" | awk '{{print $1}}')"
[ "$GOT" = "$WANT_SHA" ] || {{ rm -f "$DIR/bin/lefi-helperd.new"; echo "Download damaged (checksum mismatch)." >&2; exit 1; }}
chmod 755 "$DIR/bin/lefi-helperd.new"; mv "$DIR/bin/lefi-helperd.new" "$DIR/bin/lefi-helperd"
"$DIR/bin/lefi-helperd" join --data "$DIR" --main "$MAIN" --code "$CODE" --ca-fp "$CA_FP"
if [ "${{LEFI_HELPER_SKIP_SERVICE:-0}}" = 1 ]; then
  echo "Service not registered (LEFI_HELPER_SKIP_SERVICE=1): run $DIR/bin/lefi-helperd satellite --data $DIR"
else
  # Start when the Mac starts (before anyone logs in): needs this account's password once.
  echo "Lefi Crop Helper will start when this Mac starts; macOS asks for your password once."
  if sudo -p "Password for %u: " "$DIR/bin/lefi-helperd" install-service satellite --data "$DIR" --scope boot --user "$(id -un)"; then :
  else
    echo "Not registered at boot (no administrator rights?); registering it to start at login instead." >&2
    "$DIR/bin/lefi-helperd" install-service satellite --data "$DIR" --scope login
  fi
fi
echo "Done. This PC now reports to the main PC; follow it on http://$MAIN:{http}/setup"
"#,
        ip = shared.main_ip(),
        fp = shared.ca.fingerprint,
        http = shared.cfg.http_port,
        platform = platform_key(),
    )
}

/// A PC is set up when joining is not enough: its service reports (so the password step on that PC
/// ended and the service runs), components were chosen for it and every one is installed, and no
/// work runs or failed on it.
pub fn setup_done(n: &crate::registry::Node, commands: &[crate::jobs::CommandRecord]) -> bool {
    let Some(report) = n.last_heartbeat.as_ref().and_then(|h| h.report.as_ref()) else {
        return false;
    };
    let installed = |id: &String| report.components.iter().any(|c| &c.id == id && c.installed);
    let last = commands.iter().rev().find(|c| c.command.node_id == n.id);
    !n.assigned.is_empty()
        && n.assigned.iter().all(installed)
        && !last.is_some_and(|c| c.active() || c.state == "failed")
}

/// Whether the asking PC has joined and finished its setup (see [`setup_done`]).
fn is_set_up(s: &Shared, peer: &SocketAddr) -> bool {
    let reg = s.registry.lock().expect("registry lock");
    asking_node(&reg, peer)
        .and_then(|id| reg.nodes.iter().find(|n| n.id == id))
        .is_some_and(|n| setup_done(n, &reg.commands))
}

/// `/setup`: the guided join, then what is still missing on this PC. Once its setup is finished
/// it goes to its home instead.
async fn h_page(
    State(s): State<Arc<Shared>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
) -> Response {
    if is_set_up(&s, &peer) {
        return Redirect::to("/").into_response();
    }
    Html(page(&s, "setup")).into_response()
}

/// `/`: the home of a PC whose setup is finished (resources, AI, work). Others go to `/setup`.
async fn h_home(
    State(s): State<Arc<Shared>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
) -> Response {
    if !is_set_up(&s, &peer) {
        return Redirect::to("/setup").into_response();
    }
    Html(page(&s, "home")).into_response()
}

async fn h_update_script(State(s): State<Arc<Shared>>) -> impl IntoResponse {
    (
        [(header::CONTENT_TYPE, "text/x-shellscript")],
        update_script(&s),
    )
}

async fn h_ca(State(s): State<Arc<Shared>>) -> impl IntoResponse {
    (
        [(header::CONTENT_TYPE, "application/x-pem-file")],
        s.ca.cert_pem.clone(),
    )
}

async fn h_script(State(s): State<Arc<Shared>>) -> impl IntoResponse {
    (
        [(header::CONTENT_TYPE, "text/x-shellscript")],
        join_script(&s),
    )
}

async fn h_binary(State(s): State<Arc<Shared>>, UrlPath(platform): UrlPath<String>) -> Response {
    if platform != platform_key() {
        return fail(
            StatusCode::NOT_FOUND,
            Error::new(
                "PLATFORM_UNAVAILABLE",
                format!("No satellite program for {platform}"),
            ),
        );
    }
    match s.cfg.satellite_bin.as_ref().map(std::fs::read) {
        Some(Ok(bytes)) => {
            ([(header::CONTENT_TYPE, "application/octet-stream")], bytes).into_response()
        }
        _ => fail(
            StatusCode::NOT_FOUND,
            Error::new(
                "PLATFORM_UNAVAILABLE",
                "No satellite program on this main PC",
            ),
        ),
    }
}

/// The AI the Brain on this PC is configured to use, from its own configuration: the truth, whatever
/// happened to the last automatic attempt to connect it (`ai_link`).
fn brain_env_file(s: &Shared) -> Option<PathBuf> {
    s.cfg
        .cli_env
        .iter()
        .find(|(k, _)| k == "ENV_FILE")
        .map(|(_, v)| PathBuf::from(v))
        .or_else(|| {
            let root = s.cfg.payload_root.as_ref()?;
            if root.ends_with("Contents/Resources/payload") {
                Some(PathBuf::from(std::env::var_os("HOME")?).join(".lefi-crop/lefi.env"))
            } else {
                Some(root.join(".env"))
            }
        })
}

pub(crate) fn brain_ai_url(s: &Shared) -> Option<String> {
    let file = brain_env_file(s)?;
    std::fs::read_to_string(file)
        .ok()?
        .lines()
        .filter_map(|l| l.strip_prefix("OLLAMA_BASE_URL="))
        .next_back()
        .map(|u| u.trim_end_matches('/').to_string())
        .filter(|u| !u.is_empty())
}

fn asking_node(reg: &Registry, peer: &SocketAddr) -> Option<String> {
    let ip = peer.ip().to_canonical().to_string();
    reg.nodes
        .iter()
        .rev()
        .find(|n| n.ip == ip && !n.revoked)
        .map(|n| n.id.clone())
}

async fn h_me(
    State(s): State<Arc<Shared>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
) -> Json<Value> {
    let reg = s.registry.lock().expect("registry lock");
    let t = now();
    let Some(n) = asking_node(&reg, &peer).and_then(|id| reg.nodes.iter().find(|n| n.id == id))
    else {
        let ip = peer.ip().to_canonical();
        let is_main = ip.is_loopback() || s.cfg.lan_ips.contains(&ip);
        return Json(json!({
            "joined": false, "is_main": is_main, "main_name": crate::names::MAIN_NAME,
        }));
    };
    let history: Vec<Value> = reg
        .commands
        .iter()
        .rev()
        .filter(|c| c.command.node_id == n.id)
        .take(8)
        .map(|c| {
            // Everything except the answers file, which this page has no use for.
            let mut v = serde_json::to_value(c).unwrap_or(Value::Null);
            v["command"]["answers"] = Value::Null;
            v
        })
        .collect();
    let command = history
        .iter()
        .find(|c| {
            matches!(
                c["state"].as_str(),
                Some("queued" | "delivered" | "running")
            )
        })
        .or_else(|| history.first())
        .cloned();
    let hb = n.last_heartbeat.as_ref();
    let samples: Vec<Value> = s
        .samples
        .lock()
        .expect("samples lock")
        .get(&n.id)
        .map(|q| q.iter().cloned().collect())
        .unwrap_or_default();
    let endpoint = format!("http://{}:{}", n.ip, s.cfg.ai_port);
    Json(json!({
        "setup_done": setup_done(n, &reg.commands),
        "used_by_brain": brain_ai_url(&s).as_deref() == Some(endpoint.as_str()),
        "joined": true,
        "node_id": n.id,
        "name": n.name,
        "main_name": crate::names::MAIN_NAME,
        "hostname": n.hostname,
        "ip": n.ip,
        "connectivity": connectivity(n, t),
        "seconds_since_seen": n.last_seen.map(|x| t.saturating_sub(x)),
        "assigned": n.assigned,
        "service_outdated": hb.is_some_and(|h| h.report.is_none()),
        "updates": updates_for(&s, n),
        "heartbeat": hb.map(|h| json!({
            "uptime_s": h.uptime_s, "disk_free_gb": h.disk_free_gb, "helperd_version": h.helperd_version,
        })),
        "report": hb.and_then(|h| h.report.as_ref()),
        "ai_endpoint": format!("http://{}:{}", n.ip, s.cfg.ai_port),
        "ai_bench": n.ai_bench,
        "ai_link": n.ai_link,
        "command": command,
        "history": history,
        "samples": samples,
        "now": t,
    }))
}

/// How many lines of one command a page receives.
const LOG_MESSAGES_MAX: usize = 5000;

/// Steps and log of a command of the asking PC, and of no other PC.
async fn h_my_log(
    State(s): State<Arc<Shared>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    UrlPath(id): UrlPath<String>,
) -> Response {
    if !safe_cmd_id(&id) {
        return fail(
            StatusCode::BAD_REQUEST,
            Error::new("BAD_REQUEST", "Bad command id."),
        );
    }
    let mine = {
        let reg = s.registry.lock().expect("registry lock");
        asking_node(&reg, &peer).is_some_and(|node| {
            reg.commands
                .iter()
                .any(|c| c.command.id == id && c.command.node_id == node)
        })
    };
    if !mine {
        return fail(
            StatusCode::NOT_FOUND,
            Error::new("COMMAND_UNKNOWN", "Unknown command."),
        );
    }
    let text = std::fs::read_to_string(command_log(&s, &id)).unwrap_or_default();
    let lines: Vec<&str> = text.lines().collect();
    let from = lines.len().saturating_sub(LOG_MESSAGES_MAX);
    let messages: Vec<Value> = lines[from..]
        .iter()
        .filter_map(|l| serde_json::from_str(l).ok())
        .collect();
    Json(json!({ "messages": messages })).into_response()
}

pub fn join_router(shared: Arc<Shared>) -> Router {
    Router::new()
        .route("/", get(h_home))
        .route("/setup", get(h_page))
        .route("/setup/", get(h_page))
        .route("/setup/ca.pem", get(h_ca))
        .route("/setup/join.sh", get(h_script))
        .route("/setup/helperd/{platform}", get(h_binary))
        .route("/setup/update.sh", get(h_update_script))
        .route("/setup/me", get(h_me))
        .route("/setup/me/log/{id}", get(h_my_log))
        .with_state(shared)
}

// ------------------------------------------------------------------ enrolment + heartbeats (TLS)

/// Who is on the other end of a TLS connection.
#[derive(Clone)]
pub struct Peer {
    pub ip: String,
    /// SHA-256 of the client certificate, when one was presented and chains to the root CA.
    pub cert_fp: Option<String>,
}

async fn h_enroll(
    State(s): State<Arc<Shared>>,
    Extension(peer): Extension<Peer>,
    Json(req): Json<EnrollRequest>,
) -> Response {
    let mut reg = s.registry.lock().expect("registry lock");
    let res = reg.enroll(
        &req.code,
        &peer.ip,
        &req.hostname,
        &req.os,
        &req.arch,
        s.max_pcs,
        now(),
        |id| {
            let pem = s.ca.sign_node_csr(&req.csr_pem, id)?;
            let fp = fingerprint(&crate::ca::der_from_pem(&pem)?);
            Ok((pem, fp))
        },
    );
    match res.and_then(|(node, pem)| reg.save().map(|_| (node, pem))) {
        Ok((node, cert_pem)) => {
            eprintln!("enrolled {} ({}) from {}", node.id, node.hostname, peer.ip);
            Json(EnrollResponse {
                node_id: node.id,
                cert_pem,
                name: node.name,
            })
            .into_response()
        }
        Err(e) => {
            eprintln!("enrolment refused from {}: {}", peer.ip, e.code);
            fail(status_for(&e), e)
        }
    }
}

async fn h_heartbeat(
    State(s): State<Arc<Shared>>,
    Extension(peer): Extension<Peer>,
    Json(hb): Json<Heartbeat>,
) -> Response {
    let Some(fp) = peer.cert_fp.clone() else {
        return fail(
            StatusCode::UNAUTHORIZED,
            Error::new(
                "UNAUTHENTICATED",
                "A heartbeat needs this PC's certificate.",
            ),
        );
    };
    let sample = sample_of(&hb, now());
    let mut reg = s.registry.lock().expect("registry lock");
    match reg.heartbeat(&fp, &peer.ip, hb, now()) {
        Ok(node) => {
            if let Some(v) = sample {
                let mut all = s.samples.lock().expect("samples lock");
                let q = all.entry(node.id.clone()).or_default();
                q.push_back(v);
                while q.len() > SAMPLES_MAX {
                    q.pop_front();
                }
            }
            let command = reg.take_command(&node.id, now());
            if s.cfg.auto_pair_desktops && wants_desktop_offer(&reg, &node.id, now()) {
                if let Some(n) = reg.nodes.iter_mut().find(|n| n.id == node.id) {
                    n.desktop_pair_at = Some(now());
                }
                tokio::spawn(send_desktop_offer(
                    s.clone(),
                    node.id.clone(),
                    node.name.clone(),
                ));
            }
            let _ = reg.save();
            Json(HeartbeatResponse {
                name: node.name,
                interval_s: HEARTBEAT_SECS,
                assigned: node.assigned,
                command,
            })
            .into_response()
        }
        Err(e) => fail(status_for(&e), e),
    }
}

/// The registered, not revoked node behind a client certificate.
#[allow(clippy::result_large_err)]
fn node_of(s: &Shared, peer: &Peer) -> std::result::Result<String, Response> {
    let Some(fp) = &peer.cert_fp else {
        return Err(fail(
            StatusCode::UNAUTHORIZED,
            Error::new("UNAUTHENTICATED", "This needs the PC's certificate."),
        ));
    };
    let reg = s.registry.lock().expect("registry lock");
    match reg.nodes.iter().find(|n| &n.cert_fp == fp) {
        Some(n) if !n.revoked => Ok(n.id.clone()),
        Some(_) => Err(fail(
            StatusCode::UNAUTHORIZED,
            Error::new("NODE_REVOKED", "This PC was removed on the main PC."),
        )),
        None => Err(fail(
            StatusCode::UNAUTHORIZED,
            Error::new("NODE_UNKNOWN", "This PC is not registered."),
        )),
    }
}

async fn h_payload(State(s): State<Arc<Shared>>, Extension(peer): Extension<Peer>) -> Response {
    if let Err(r) = node_of(&s, &peer) {
        return r;
    }
    match s.payload.as_ref().map(|(p, _)| std::fs::read(p)) {
        Some(Ok(bytes)) => ([(header::CONTENT_TYPE, "application/gzip")], bytes).into_response(),
        _ => fail(
            StatusCode::NOT_FOUND,
            Error::new("PAYLOAD_MISSING", "No installer payload on this main PC."),
        ),
    }
}

/// The service program this main PC shares, for a joined PC replacing its own (ADR-062). mTLS:
/// only a PC with its certificate gets it; it checks the SHA-256 the command carried.
async fn h_helperd(State(s): State<Arc<Shared>>, Extension(peer): Extension<Peer>) -> Response {
    if let Err(r) = node_of(&s, &peer) {
        return r;
    }
    match s.cfg.satellite_bin.as_ref().map(std::fs::read) {
        Some(Ok(bytes)) => {
            ([(header::CONTENT_TYPE, "application/octet-stream")], bytes).into_response()
        }
        _ => fail(
            StatusCode::NOT_FOUND,
            Error::new("PLATFORM_UNAVAILABLE", "No service program on this main PC"),
        ),
    }
}

fn command_log(s: &Shared, id: &str) -> PathBuf {
    s.cfg
        .data_dir
        .join("fleet")
        .join("commands")
        .join(format!("{id}.ndjson"))
}

fn safe_cmd_id(id: &str) -> bool {
    id.len() <= 40 && id.starts_with("cmd-") && id[4..].chars().all(|c| c.is_ascii_hexdigit())
}

async fn h_events(
    State(s): State<Arc<Shared>>,
    Extension(peer): Extension<Peer>,
    UrlPath(id): UrlPath<String>,
    Json(batch): Json<CommandEvents>,
) -> Response {
    let node_id = match node_of(&s, &peer) {
        Ok(n) => n,
        Err(r) => return r,
    };
    if !safe_cmd_id(&id) {
        return fail(
            StatusCode::BAD_REQUEST,
            Error::new("BAD_REQUEST", "Bad command id."),
        );
    }
    let mut reg = s.registry.lock().expect("registry lock");
    match reg.record_events(&node_id, &id, &batch, now()) {
        Ok(cancel) => {
            // The same {kind, event|line} shape Lefi Crop Helper already folds for local installs.
            let path = command_log(&s, &id);
            let _ = std::fs::create_dir_all(path.parent().expect("commands dir"));
            if let Ok(mut f) = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&path)
            {
                use std::io::Write;
                for line in &batch.output {
                    let _ = writeln!(f, "{}", json!({ "kind": "output", "line": line }));
                }
                for e in &batch.events {
                    let _ = writeln!(f, "{}", json!({ "kind": "event", "event": e }));
                }
            }
            // A finished, real install of the AI component: connect the Brain to it (ADR-033).
            let ai_done = batch.finished.is_some()
                && reg.commands.iter().any(|c| {
                    c.command.id == id
                        && c.state == "ok"
                        && c.command.kind == "install"
                        && !c.command.dry_run
                        && c.command.roles.iter().any(|r| r == "ai")
                });
            let link = if ai_done {
                begin_ai_link(&s, &mut reg, &node_id)
            } else {
                None
            };
            let _ = reg.save();
            drop(reg);
            if let Some(url) = link {
                tokio::spawn(link_ai(s.clone(), node_id, url));
            }
            Json(CommandEventsResponse { cancel }).into_response()
        }
        Err(e) => fail(StatusCode::NOT_FOUND, e),
    }
}

/// Marks the node as "linking" and returns the AI URL to check (None: no address or CLI).
fn begin_ai_link(s: &Shared, reg: &mut Registry, node_id: &str) -> Option<String> {
    let node = reg
        .nodes
        .iter_mut()
        .find(|n| n.id == node_id && !n.revoked)?;
    let url = format!("http://{}:{}", node.ip, s.cfg.ai_port);
    node.ai_link = Some(AiLink {
        url: url.clone(),
        state: "linking".into(),
        code: None,
        model: None,
        gpu_pct: None,
        message: "Checking the AI on that PC and connecting Lefi Brain…".into(),
        at: now(),
    });
    Some(url)
}

/// Runs `lefi ai use URL --json` on this (main) PC: the installer's own check (supported model,
/// real generation, 100% on that node's GPU) and, if it passes, the Brain's configuration.
pub async fn link_ai(s: Arc<Shared>, node_id: String, url: String) {
    let res = match s.cfg.payload_root.as_ref().map(|r| r.join("bin/lefi")) {
        Some(lefi) if lefi.is_file() => {
            let mut c = tokio::process::Command::new(lefi);
            c.args(["ai", "use", &url, "--json"])
                .env(
                    "PATH",
                    format!(
                        "/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/local/sbin:/usr/bin:/bin:/usr/sbin:/sbin:{}",
                        std::env::var("PATH").unwrap_or_default()
                    ),
                )
                .env("NO_COLOR", "1")
                .stdin(std::process::Stdio::null());
            for (k, v) in &s.cfg.cli_env {
                c.env(k, v);
            }
            match c.output().await {
                Ok(o) => String::from_utf8_lossy(&o.stdout)
                    .lines()
                    .rev()
                    .find_map(|l| serde_json::from_str::<Value>(l).ok())
                    .unwrap_or_else(|| json!({"result":"failed","code":"CLI_ERROR","message": String::from_utf8_lossy(&o.stderr).lines().last().unwrap_or("lefi ai use gave no result").to_string()})),
                Err(e) => json!({"result":"failed","code":"CLI_ERROR","message": e.to_string()}),
            }
        }
        _ => {
            json!({"result":"failed","code":"CLI_MISSING","message":"The lefi command is not available to the service (start it with --payload-root)."})
        }
    };
    let mut reg = s.registry.lock().expect("registry lock");
    if let Some(node) = reg.nodes.iter_mut().find(|n| n.id == node_id) {
        node.ai_link = Some(AiLink {
            url,
            state: if res["result"] == "ok" {
                "ok".into()
            } else {
                "failed".into()
            },
            code: res["code"].as_str().map(str::to_string),
            model: res["model"]
                .as_str()
                .filter(|m| !m.is_empty())
                .map(str::to_string),
            gpu_pct: res["gpu_pct"].as_u64(),
            message: res["message"].as_str().unwrap_or("").to_string(),
            at: now(),
        });
        eprintln!("AI link {node_id}: {}", res["message"]);
    }
    let _ = reg.save();
}

pub fn tls_router(shared: Arc<Shared>) -> Router {
    Router::new()
        .route("/v1/enroll", post(h_enroll))
        .route("/v1/heartbeat", post(h_heartbeat))
        .route("/v1/payload", get(h_payload))
        .route("/v1/helperd", get(h_helperd))
        .route("/v1/commands/{id}/events", post(h_events))
        .with_state(shared)
}

pub fn tls_config(shared: &Shared) -> Result<Arc<rustls::ServerConfig>> {
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let mut roots = rustls::RootCertStore::empty();
    roots
        .add(rustls::pki_types::CertificateDer::from(
            crate::ca::der_from_pem(&shared.ca.cert_pem)?,
        ))
        .map_err(|e| Error::new("TLS_CONFIG", e.to_string()))?;
    let verifier = rustls::server::WebPkiClientVerifier::builder_with_provider(
        Arc::new(roots),
        provider.clone(),
    )
    .allow_unauthenticated() // enrolment has no certificate yet; heartbeats require one
    .build()
    .map_err(|e| Error::new("TLS_CONFIG", e.to_string()))?;
    let mut ips = shared.cfg.lan_ips.clone();
    ips.push(IpAddr::from([127, 0, 0, 1]));
    let (cert_pem, key_pem) = shared.ca.server_cert(&ips)?;
    let chain = vec![
        rustls::pki_types::CertificateDer::from(crate::ca::der_from_pem(&cert_pem)?),
        rustls::pki_types::CertificateDer::from(crate::ca::der_from_pem(&shared.ca.cert_pem)?),
    ];
    let key = rustls_pemfile::private_key(&mut key_pem.as_bytes())
        .ok()
        .flatten()
        .ok_or_else(|| Error::new("TLS_CONFIG", "server key"))?;
    let cfg = rustls::ServerConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .map_err(|e| Error::new("TLS_CONFIG", e.to_string()))?
        .with_client_cert_verifier(verifier)
        .with_single_cert(chain, key)
        .map_err(|e| Error::new("TLS_CONFIG", e.to_string()))?;
    Ok(Arc::new(cfg))
}

pub async fn serve_tls(listener: TcpListener, cfg: Arc<rustls::ServerConfig>, router: Router) {
    let acceptor = tokio_rustls::TlsAcceptor::from(cfg);
    loop {
        let Ok((tcp, addr)) = listener.accept().await else {
            continue;
        };
        let acceptor = acceptor.clone();
        let router = router.clone();
        tokio::spawn(async move {
            let Ok(tls) = acceptor.accept(tcp).await else {
                return;
            };
            let cert_fp = tls
                .get_ref()
                .1
                .peer_certificates()
                .and_then(|c| c.first())
                .map(|c| fingerprint(c.as_ref()));
            let peer = Peer {
                ip: addr.ip().to_canonical().to_string(),
                cert_fp,
            };
            let svc = hyper_util::service::TowerToHyperService::new(router.layer(Extension(peer)));
            let _ = hyper::server::conn::http1::Builder::new()
                .serve_connection(hyper_util::rt::TokioIo::new(tls), svc)
                .await;
        });
    }
}

// ------------------------------------------------------------------ console API (loopback)

fn authorised(s: &Shared, headers: &HeaderMap) -> bool {
    let want = format!("Bearer {}", s.admin_token);
    headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| {
            // constant-time enough for a loopback token: compare every byte
            v.len() == want.len()
                && v.bytes()
                    .zip(want.bytes())
                    .fold(0u8, |a, (x, y)| a | (x ^ y))
                    == 0
        })
}

fn deny() -> Response {
    fail(
        StatusCode::UNAUTHORIZED,
        Error::new("UNAUTHENTICATED", "Missing or wrong console token."),
    )
}

async fn a_status(State(s): State<Arc<Shared>>, headers: HeaderMap) -> Response {
    if !authorised(&s, &headers) {
        return deny();
    }
    let t = now();
    let brain_ai = brain_ai_url(&s);
    let reg = s.registry.lock().expect("registry lock");
    let nodes: Vec<Value> = reg
        .nodes
        .iter()
        .map(|n| {
            let mut v = serde_json::to_value(n).unwrap_or(Value::Null);
            v["connectivity"] = json!(connectivity(n, t));
            v["seconds_since_seen"] = json!(n.last_seen.map(|x| t.saturating_sub(x)));
            v["active_command"] = json!(reg.active_command(&n.id));
            v["last_command"] = json!(reg.last_command(&n.id));
            v["last_install"] = json!(reg.last_install(&n.id));
            let endpoint = format!("http://{}:{}", n.ip, s.cfg.ai_port);
            v["used_by_brain"] = json!(brain_ai.as_deref() == Some(endpoint.as_str()));
            v["ai_endpoint"] = json!(endpoint);
            v["service_outdated"] = json!(n
                .last_heartbeat
                .as_ref()
                .is_some_and(|h| h.report.is_none()));
            v["updates"] = updates_for(&s, n);
            v
        })
        .collect();
    Json(json!({
        "installation_id": s.installation_id,
        "main_name": crate::names::MAIN_NAME,
        "service_version": crate::VERSION,
        "satellite_version": s.satellite_version,
        "desktop_version": s.desktop_version,
        "ca_fingerprint": s.ca.fingerprint,
        "join_url": s.join_url(),
        "update_command": format!(
            "curl -fsS http://{}:{}/setup/update.sh | sh",
            s.main_ip(),
            s.cfg.http_port
        ),
        "lan_ips": s.cfg.lan_ips.iter().map(|i| i.to_string()).collect::<Vec<_>>(),
        "max_pcs": s.max_pcs,
        "satellite_platform": platform_key(),
        "satellite_available": s.satellite_sha256.is_some(),
        "remote_install_available": s.payload.is_some(),
        "now": t,
        "nodes": nodes,
    }))
    .into_response()
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CodeReq {
    expected_ip: Option<String>,
}

async fn a_code(
    State(s): State<Arc<Shared>>,
    headers: HeaderMap,
    Json(req): Json<CodeReq>,
) -> Response {
    if !authorised(&s, &headers) {
        return deny();
    }
    let ip = req.expected_ip.filter(|v| !v.trim().is_empty());
    if let Some(v) = &ip {
        if v.parse::<IpAddr>().is_err() {
            return fail(
                StatusCode::BAD_REQUEST,
                Error::new("BAD_REQUEST", "Not an IP address."),
            );
        }
    }
    let mut reg = s.registry.lock().expect("registry lock");
    match reg
        .new_code(ip, s.max_pcs, now())
        .and_then(|(c, jc)| reg.save().map(|_| (c, jc)))
    {
        Ok((code, jc)) => Json(json!({
            "code": code, "expires_at": jc.expires_at, "expected_ip": jc.expected_ip,
            "join_url": s.join_url(), "join_command": s.join_command(&code),
            "ca_fingerprint": s.ca.fingerprint,
        }))
        .into_response(),
        Err(e) => fail(status_for(&e), e),
    }
}

async fn a_revoke(
    State(s): State<Arc<Shared>>,
    headers: HeaderMap,
    UrlPath(id): UrlPath<String>,
) -> Response {
    if !authorised(&s, &headers) {
        return deny();
    }
    let mut reg = s.registry.lock().expect("registry lock");
    match reg.revoke(&id).and_then(|_| reg.save()) {
        Ok(()) => Json(json!({ "ok": true })).into_response(),
        Err(e) => fail(status_for(&e), e),
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AssignReq {
    roles: Vec<String>,
}

async fn a_assign(
    State(s): State<Arc<Shared>>,
    headers: HeaderMap,
    UrlPath(id): UrlPath<String>,
    Json(req): Json<AssignReq>,
) -> Response {
    if !authorised(&s, &headers) {
        return deny();
    }
    let mut reg = s.registry.lock().expect("registry lock");
    match reg
        .assign(&id, &req.roles)
        .and_then(|n| reg.save().map(|_| n))
    {
        Ok(n) => Json(json!({ "node": n })).into_response(),
        Err(e) => fail(status_for(&e), e),
    }
}

/// Retry: connect the Brain to the AI on this PC (after fixing what the last check reported).
async fn a_link_ai(
    State(s): State<Arc<Shared>>,
    headers: HeaderMap,
    UrlPath(id): UrlPath<String>,
) -> Response {
    if !authorised(&s, &headers) {
        return deny();
    }
    let mut reg = s.registry.lock().expect("registry lock");
    let has_ai = reg
        .nodes
        .iter()
        .any(|n| n.id == id && !n.revoked && n.assigned.iter().any(|r| r == "ai"));
    if !has_ai {
        return fail(
            StatusCode::CONFLICT,
            Error::new(
                "NO_AI_ASSIGNED",
                "The AI component is not assigned to this PC.",
            ),
        );
    }
    let url = begin_ai_link(&s, &mut reg, &id);
    let _ = reg.save();
    drop(reg);
    match url {
        Some(u) => {
            tokio::spawn(link_ai(s.clone(), id, u));
            Json(json!({ "ok": true })).into_response()
        }
        None => fail(
            StatusCode::NOT_FOUND,
            Error::new("NODE_UNKNOWN", "No such PC."),
        ),
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct InstallReq {
    #[serde(default)]
    dry_run: bool,
    /// Only these assigned components (default: all of them).
    #[serde(default)]
    roles: Option<Vec<String>>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RunReq {
    /// remove · service · ai_bench · erase
    kind: String,
    /// `remove`: the component.
    #[serde(default)]
    role: Option<String>,
    /// `service`: start · stop · restart.
    #[serde(default)]
    action: Option<String>,
}

fn queue_cmd(
    s: &Shared,
    id: &str,
    kind: &str,
    dry_run: bool,
    only: Option<&[String]>,
    action: Option<&str>,
) -> Response {
    let sha = s
        .payload
        .as_ref()
        .map(|(_, h)| h.clone())
        .unwrap_or_default();
    let mut reg = s.registry.lock().expect("registry lock");
    match reg
        .queue_spec(id, kind, dry_run, only, action, &sha, now())
        .and_then(|r| reg.save().map(|_| r))
    {
        Ok(rec) => Json(json!({ "command": rec })).into_response(),
        Err(e) => {
            let st = match e.code {
                "COMMAND_BUSY" | "NOTHING_TO_INSTALL" | "PAYLOAD_MISSING" | "SERVICE_OUTDATED"
                | "REMOVE_UNSUPPORTED" => StatusCode::CONFLICT,
                _ => status_for(&e),
            };
            fail(st, e)
        }
    }
}

async fn a_install(
    State(s): State<Arc<Shared>>,
    headers: HeaderMap,
    UrlPath(id): UrlPath<String>,
    Json(req): Json<InstallReq>,
) -> Response {
    if !authorised(&s, &headers) {
        return deny();
    }
    queue_cmd(&s, &id, "install", req.dry_run, req.roles.as_deref(), None)
}

/// The rest of the allowlist (ADR-040). Anything else is refused here and again on the satellite.
async fn a_run(
    State(s): State<Arc<Shared>>,
    headers: HeaderMap,
    UrlPath(id): UrlPath<String>,
    Json(req): Json<RunReq>,
) -> Response {
    if !authorised(&s, &headers) {
        return deny();
    }
    if !matches!(
        req.kind.as_str(),
        "remove" | "service" | "ai_bench" | "erase"
    ) {
        return fail(
            StatusCode::BAD_REQUEST,
            Error::new("BAD_REQUEST", "Unknown command."),
        );
    }
    let only: Option<Vec<String>> = req.role.map(|r| vec![r]);
    queue_cmd(
        &s,
        &id,
        &req.kind,
        false,
        only.as_deref(),
        req.action.as_deref(),
    )
}

/// Asks a PC's service to replace itself with the program this main PC shares (ADR-062).
async fn a_update_service(
    State(s): State<Arc<Shared>>,
    headers: HeaderMap,
    UrlPath(id): UrlPath<String>,
) -> Response {
    if !authorised(&s, &headers) {
        return deny();
    }
    let (Some(version), Some(sha256)) = (s.satellite_version.clone(), s.satellite_sha256.clone())
    else {
        return fail(
            StatusCode::CONFLICT,
            Error::new(
                "PLATFORM_UNAVAILABLE",
                "This main PC has no service program to share.",
            ),
        );
    };
    let update = crate::protocol::ServiceUpdate {
        version,
        platform: platform_key(),
        sha256,
    };
    let mut reg = s.registry.lock().expect("registry lock");
    match reg
        .queue_service_update(&id, update, now())
        .and_then(|r| reg.save().map(|_| r))
    {
        Ok(rec) => Json(json!({ "command": rec })).into_response(),
        Err(e) => {
            let st = match e.code {
                "COMMAND_BUSY" | "SERVICE_OUTDATED" | "UP_TO_DATE" | "NODE_OFFLINE" => {
                    StatusCode::CONFLICT
                }
                _ => status_for(&e),
            };
            fail(st, e)
        }
    }
}

async fn a_rollback(
    State(s): State<Arc<Shared>>,
    headers: HeaderMap,
    UrlPath(id): UrlPath<String>,
) -> Response {
    if !authorised(&s, &headers) {
        return deny();
    }
    queue_cmd(&s, &id, "rollback", false, None, None)
}

async fn a_cancel(
    State(s): State<Arc<Shared>>,
    headers: HeaderMap,
    UrlPath(id): UrlPath<String>,
) -> Response {
    if !authorised(&s, &headers) {
        return deny();
    }
    let mut reg = s.registry.lock().expect("registry lock");
    match reg.request_cancel(&id, now()).and_then(|_| reg.save()) {
        Ok(()) => Json(json!({ "ok": true })).into_response(),
        Err(e) => fail(StatusCode::CONFLICT, e),
    }
}

async fn a_command(
    State(s): State<Arc<Shared>>,
    headers: HeaderMap,
    UrlPath(id): UrlPath<String>,
) -> Response {
    if !authorised(&s, &headers) {
        return deny();
    }
    if !safe_cmd_id(&id) {
        return fail(
            StatusCode::BAD_REQUEST,
            Error::new("BAD_REQUEST", "Bad command id."),
        );
    }
    let rec = {
        let reg = s.registry.lock().expect("registry lock");
        reg.commands.iter().find(|c| c.command.id == id).cloned()
    };
    let Some(rec) = rec else {
        return fail(
            StatusCode::NOT_FOUND,
            Error::new("COMMAND_UNKNOWN", "Unknown command."),
        );
    };
    let messages: Vec<Value> = std::fs::read_to_string(command_log(&s, &id))
        .unwrap_or_default()
        .lines()
        .filter_map(|l| serde_json::from_str(l).ok())
        .collect();
    Json(json!({ "record": rec, "messages": messages })).into_response()
}

pub fn admin_router(shared: Arc<Shared>) -> Router {
    Router::new()
        .route("/admin/nodes/{id}/install", post(a_install))
        .route("/admin/nodes/{id}/rollback", post(a_rollback))
        .route("/admin/nodes/{id}/update-service", post(a_update_service))
        .route("/admin/nodes/{id}/run", post(a_run))
        .route("/admin/nodes/{id}/link-ai", post(a_link_ai))
        .route("/admin/commands/{id}/cancel", post(a_cancel))
        .route("/admin/commands/{id}", get(a_command))
        .route("/admin/status", get(a_status))
        .route("/admin/codes", post(a_code))
        .route("/admin/nodes/{id}/revoke", post(a_revoke))
        .route("/admin/nodes/{id}/assign", post(a_assign))
        .with_state(shared)
}

/// Runs the three listeners until the process is stopped.
pub async fn run(shared: Arc<Shared>) -> Result<()> {
    let c = &shared.cfg;
    let http = TcpListener::bind((c.bind, c.http_port))
        .await
        .map_err(io("BIND"))?;
    let tls = TcpListener::bind((c.bind, c.tls_port))
        .await
        .map_err(io("BIND"))?;
    let admin = TcpListener::bind((IpAddr::from([127, 0, 0, 1]), c.admin_port))
        .await
        .map_err(io("BIND"))?;
    let tls_cfg = tls_config(&shared)?;
    eprintln!(
        "lefi-helperd main: join page {} · TLS :{} · console 127.0.0.1:{} · CA {}",
        shared.join_url(),
        c.tls_port,
        c.admin_port,
        &shared.ca.fingerprint[..16]
    );
    if c.publish_name {
        let (first_ip, port) = (shared.main_ip(), c.http_port);
        let shared = shared.clone();
        tokio::spawn(async move {
            let mut p = crate::names::Publisher::default();
            let mut brain = crate::names::Publisher::default();
            let env_file = brain_env_file(&shared).unwrap_or_default();
            loop {
                // The address now, not at start: a Mac that moved network or got a new DHCP
                // address must not keep announcing lefi-main.local at its old one (ADR-055).
                let ip = detect_lan_ip()
                    .map(|i| i.to_string())
                    .unwrap_or_else(|| first_ip.clone());
                p.publish(crate::names::MAIN_NAME, &ip, port);
                let env_text = std::fs::read_to_string(&env_file).unwrap_or_default();
                brain.publish_brain(&ip, crate::names::brain_gateway_port(&env_text));
                tokio::time::sleep(std::time::Duration::from_secs(30)).await;
            }
        });
    }
    if c.auto_pair_local {
        let shared = shared.clone();
        tokio::spawn(async move {
            let mut last_check = None;
            loop {
                offer_local_desktop(&shared, &mut last_check).await;
                tokio::time::sleep(std::time::Duration::from_secs(30)).await;
            }
        });
    }
    let join = axum::serve(
        http,
        join_router(shared.clone()).into_make_service_with_connect_info::<SocketAddr>(),
    );
    crate::robot_host::write_brain_link(&shared);
    tokio::spawn(crate::backup::run(shared.clone()));
    let console = axum::serve(
        admin,
        admin_router(shared.clone()).merge(crate::robot_host::router(shared.clone())),
    );
    tokio::select! {
        r = join => r.map_err(io("SERVE"))?,
        r = console => r.map_err(io("SERVE"))?,
        _ = serve_tls(tls, tls_cfg, tls_router(shared.clone())) => {},
    }
    Ok(())
}

// ------------------------------------------------------------------ Lefi Desktop pairing (ADR-050)

/// A new offer at most this often per PC while its Lefi Desktop stays unpaired (a code lasts 10 min).
const DESKTOP_OFFER_EVERY_S: u64 = 15 * 60;

/// This PC reports a Lefi Desktop that is not paired, and no offer went out recently.
pub fn wants_desktop_offer(reg: &Registry, node_id: &str, now: u64) -> bool {
    let Some(n) = reg.nodes.iter().find(|n| n.id == node_id && !n.revoked) else {
        return false;
    };
    let unpaired = n
        .last_heartbeat
        .as_ref()
        .and_then(|h| h.report.as_ref())
        .and_then(|r| r.components.iter().find(|c| c.id == "desktop"))
        .is_some_and(|c| c.installed && c.paired == Some(false));
    let recent = n
        .desktop_pair_at
        .is_some_and(|t| now.saturating_sub(t) < DESKTOP_OFFER_EVERY_S);
    unpaired && !recent && reg.active_command(node_id).is_none()
}

/// Runs `lefi <args>` on this (main) PC and returns its JSON answer.
pub(crate) async fn lefi_json(s: &Shared, args: &[&str]) -> Option<Value> {
    let out = lefi_output(s, args).await?;
    let text = out.trim();
    serde_json::from_str(text).ok().or_else(|| {
        text.lines()
            .rev()
            .find_map(|l| serde_json::from_str::<Value>(l).ok())
    })
}

pub(crate) async fn lefi_output(s: &Shared, args: &[&str]) -> Option<String> {
    lefi_command_output(s.cfg.payload_root.as_deref()?, &s.cfg.cli_env, args, &[]).await
}

/// Runs `<root>/bin/lefi <args>` with the service's environment plus `extra`; stdout when it succeeds.
pub(crate) async fn lefi_command_output(
    root: &Path,
    cli_env: &[(String, String)],
    args: &[&str],
    extra: &[(String, String)],
) -> Option<String> {
    lefi_command_run(root, cli_env, args, extra).await.ok()
}

pub(crate) async fn lefi_run(s: &Shared, args: &[&str]) -> std::result::Result<String, String> {
    match s.cfg.payload_root.as_deref() {
        Some(root) => lefi_command_run(root, &s.cfg.cli_env, args, &[]).await,
        None => Err("This service has no Lefi Crop command line to run.".into()),
    }
}

/// Like `lefi_command_output`, but a failure says why: the command's own error lines (ADR-104).
pub(crate) async fn lefi_command_run(
    root: &Path,
    cli_env: &[(String, String)],
    args: &[&str],
    extra: &[(String, String)],
) -> std::result::Result<String, String> {
    let lefi = root.join("bin/lefi");
    if !lefi.is_file() {
        return Err(format!("{} is missing", lefi.display()));
    }
    let mut c = tokio::process::Command::new(lefi);
    c.args(args)
        .env(
            "PATH",
            format!(
                "/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/local/sbin:/usr/bin:/bin:/usr/sbin:/sbin:{}",
                std::env::var("PATH").unwrap_or_default()
            ),
        )
        .env("NO_COLOR", "1")
        .stdin(std::process::Stdio::null());
    for (k, v) in cli_env.iter().chain(extra) {
        c.env(k, v);
    }
    let o = c.output().await.map_err(|e| e.to_string())?;
    if o.status.success() {
        return Ok(String::from_utf8_lossy(&o.stdout).into_owned());
    }
    let mut text = String::from_utf8_lossy(&o.stderr).into_owned();
    if text.trim().is_empty() {
        text = String::from_utf8_lossy(&o.stdout).into_owned();
    }
    Err(last_lines(&text, 20))
}

/// The last `n` non-empty lines of `text`, trimmed: what a person needs from an error or a log.
pub(crate) fn last_lines(text: &str, n: usize) -> String {
    let lines: Vec<&str> = text
        .lines()
        .map(str::trim_end)
        .filter(|l| !l.trim().is_empty())
        .collect();
    lines[lines.len().saturating_sub(n)..].join("\n")
}

/// Lefi Brain's issuing CA signed by the LEFI root, which this service holds (ADR-026). Same key,
/// so devices already paired stay valid. Best effort: a self-signed CA still pairs.
async fn ensure_two_level_ca(s: &Shared) {
    let status = lefi_json(s, &["pair", "ca", "--json"]).await;
    if status.as_ref().is_some_and(|v| v["two_level"] == true) {
        return;
    }
    let Some(csr) = lefi_output(s, &["pair", "ca-request"]).await else {
        return;
    };
    let Ok(cert) = s.ca.sign_brain_issuing_csr(&csr) else {
        eprintln!("desktop pairing: Lefi Brain's CA request could not be signed");
        return;
    };
    let dir = s.cfg.data_dir.join("fleet");
    let (cp, rp) = (dir.join("issuing.signed.crt"), dir.join("root.crt"));
    if std::fs::write(&cp, cert).is_err() || std::fs::write(&rp, &s.ca.cert_pem).is_err() {
        return;
    }
    let installed = lefi_json(
        s,
        &[
            "pair",
            "ca-install",
            "--json",
            "--cert",
            &cp.to_string_lossy(),
            "--root",
            &rp.to_string_lossy(),
        ],
    )
    .await;
    let _ = std::fs::remove_file(&cp);
    if installed.is_some_and(|v| v["two_level"] == true) {
        // Lefi Gateway reads its trust pool at start.
        let _ = lefi_output(s, &["restart", "caddy"]).await;
        eprintln!("desktop pairing: Lefi Brain's CA is now signed by the LEFI root");
    }
}

/// A one-time offer from Lefi Brain on this PC: its Lefi name on the gateway's port, a code, and the
/// gateway CA fingerprint the answer must carry. `None` when the gateway does not ask for devices.
pub async fn make_offer(s: &Shared, label: &str) -> Option<PairingOffer> {
    let env = std::fs::read_to_string(brain_env_file(s)?).ok()?;
    let required = env
        .lines()
        .filter_map(|l| l.strip_prefix("LEFI_DEVICE_CERT_REQUIRED="))
        .next_back()
        .is_some_and(|v| v.trim() == "true");
    let port = crate::names::brain_gateway_port(&env)?;
    if !required {
        return None;
    }
    ensure_two_level_ca(s).await;
    let v = lefi_json(s, &["pair", "new", "--json", "--label", label]).await?;
    let offer = PairingOffer {
        url: format!("https://{}.local:{port}", crate::names::MAIN_NAME),
        code: v["code"].as_str()?.to_string(),
        gateway_ca_fingerprint: v["gateway_ca_fingerprint"].as_str()?.to_string(),
    };
    offer.valid().then_some(offer)
}

async fn send_desktop_offer(s: Arc<Shared>, node_id: String, name: String) {
    let Some(offer) = make_offer(&s, &format!("Lefi Desktop on {name}")).await else {
        eprintln!(
            "desktop pairing: no offer for {name} (Lefi Gateway not asking for devices yet?)"
        );
        return;
    };
    let mut reg = s.registry.lock().expect("registry lock");
    match reg.queue_desktop_pair(&node_id, offer, now()) {
        Ok(_) => eprintln!("desktop pairing: offer queued for {name}"),
        Err(e) => eprintln!("desktop pairing: {name}: {}", e.code),
    }
    let _ = reg.save();
}

/// Other addresses of this PC's gateway for its own Lefi Desktop: the address Lefi Gateway was set up
/// with (in its certificate), and loopback when the gateway serves it (ADR-055).
pub fn local_alternates(env_text: &str, caddyfile: &str, port: u16) -> Vec<String> {
    let mut v = vec![];
    if let Some(url) = env_text
        .lines()
        .filter_map(|l| l.strip_prefix("LEFI_ADMIN_URL="))
        .next_back()
        .map(str::trim)
        .filter(|u| u.starts_with("https://"))
    {
        v.push(url.trim_end_matches('/').to_string());
    }
    if caddyfile.contains(&format!("https://localhost:{port}")) {
        v.push(format!("https://localhost:{port}"));
    }
    v
}

/// The local Lefi Desktop's pairing, as its files say: (device id, key present).
fn local_pairing(dir: &Path) -> Option<(String, bool)> {
    let v: Value =
        serde_json::from_str(&std::fs::read_to_string(dir.join("pairing.json")).ok()?).ok()?;
    let id = v["device_id"].as_str()?.to_string();
    Some((id, dir.join("device-key.pem").is_file()))
}

/// How often the main PC asks Lefi Brain whether its own Lefi Desktop's pairing is still active.
const LOCAL_CHECK_EVERY_S: u64 = 5 * 60;

/// The Lefi Desktop of the main PC itself: same offer, written straight into its data folder. Also
/// when its pairing was revoked or replaced: the main PC's own Lefi Desktop always pairs again by
/// itself (ADR-055). The offer file itself prevents duplicates; Lefi Desktop removes it once used,
/// refused or expired.
async fn offer_local_desktop(s: &Shared, last_check: &mut Option<u64>) {
    let Some(home) = std::env::var_os("HOME").map(PathBuf::from) else {
        return;
    };
    let installed = [
        PathBuf::from("/Applications/Lefi Crop.app"),
        home.join("Applications/Lefi Crop.app"),
    ]
    .iter()
    .any(|a| a.join("Contents").is_dir());
    let dir = crate::report::desktop_data_dir(&home);
    if !installed || dir.join("pairing-offer.json").is_file() {
        return;
    }
    if let Some((id, has_key)) = local_pairing(&dir) {
        if !has_key {
            return; // Lefi Desktop drops a pairing without its key by itself, then this offers
        }
        if last_check.is_some_and(|t| now().saturating_sub(t) < LOCAL_CHECK_EVERY_S) {
            return;
        }
        *last_check = Some(now());
        let Some(list) = lefi_json(s, &["pair", "list", "--json"]).await else {
            return; // Lefi Brain not answering: nothing is decided without it
        };
        let active = list.as_array().is_some_and(|a| {
            a.iter()
                .any(|d| d["id"] == id.as_str() && d["status"] == "active")
        });
        if active {
            return;
        }
        eprintln!("desktop pairing: this PC's Lefi Desktop holds a pairing Lefi Brain no longer accepts; pairing it again");
        for f in ["pairing.json", "device-key.pem"] {
            let _ = std::fs::remove_file(dir.join(f));
        }
    }
    if let Some(offer) = make_offer(s, "Lefi Desktop on the main PC").await {
        let env = brain_env_file(s)
            .and_then(|p| std::fs::read_to_string(p).ok())
            .unwrap_or_default();
        let caddy = brain_env_file(s)
            .and_then(|p| p.parent().map(|d| d.join("caddy/Caddyfile")))
            .and_then(|p| std::fs::read_to_string(p).ok())
            .unwrap_or_default();
        let port = offer
            .url
            .rsplit_once(':')
            .and_then(|(_, p)| p.parse().ok())
            .unwrap_or(8443);
        let alternates = local_alternates(&env, &caddy, port);
        match crate::executor::write_offer_with(&dir, &offer, &alternates) {
            Ok(_) => eprintln!("desktop pairing: offer left for the Lefi Desktop of this PC"),
            Err(e) => eprintln!("desktop pairing: {}", e.code),
        }
    }
}

#[cfg(test)]
mod desktop_offer_tests {
    use super::*;

    fn reg_with(paired: Option<bool>, installed: bool) -> (Registry, String) {
        let d = tempfile::tempdir().unwrap();
        let mut r = Registry::load(d.path()).unwrap();
        let (c, _) = r.new_code(None, 5, 0).unwrap();
        let (node, _) = r
            .enroll(&c, "10.0.0.2", "host", "macos", "arm64", 3, 1, |id| {
                Ok((format!("PEM-{id}"), format!("fp-{id}")))
            })
            .unwrap();
        let mut report = crate::protocol::NodeReport::default();
        report.components.push(crate::protocol::ComponentState {
            id: "desktop".into(),
            installed,
            state: "installed".into(),
            paired,
            ..Default::default()
        });
        let n = r.nodes.iter_mut().find(|n| n.id == node.id).unwrap();
        n.last_heartbeat = Some(crate::protocol::Heartbeat {
            report: Some(report),
            ..Default::default()
        });
        (r, node.id)
    }

    fn record(node: &str, state: &str) -> crate::jobs::CommandRecord {
        serde_json::from_value(json!({
            "command": {"id": "c", "node_id": node, "kind": "install", "roles": ["desktop"],
              "dry_run": false, "answers": "", "payload_sha256": "", "issued_at": 0, "expires_at": 0},
            "state": state, "cancel_requested": false, "created_at": 0, "updated_at": 0,
            "steps_done": 0, "steps_total": 0, "current_step": null, "exit_code": null,
            "error": null, "rollback_result": null,
        }))
        .unwrap()
    }

    #[test]
    fn joining_is_not_a_finished_setup() {
        // Joined, but its service never reported (e.g. still waiting for that PC's password).
        let (mut r, id) = reg_with(None, false);
        r.nodes[0].last_heartbeat = None;
        assert!(!setup_done(&r.nodes[0], &[]));
        // Reports, but nothing was chosen for it yet.
        let (mut r, id2) = reg_with(None, true);
        assert!(!setup_done(&r.nodes[0], &[]));
        // Chosen and not installed yet.
        let (mut r3, _) = reg_with(None, false);
        r3.nodes[0].assigned = vec!["desktop".into()];
        assert!(!setup_done(&r3.nodes[0], &[]));
        // Chosen and installed: done, unless work runs or failed there.
        r.nodes[0].assigned = vec!["desktop".into()];
        assert!(setup_done(&r.nodes[0], &[]));
        assert!(!setup_done(&r.nodes[0], &[record(&id2, "running")]));
        assert!(!setup_done(&r.nodes[0], &[record(&id2, "failed")]));
        assert!(setup_done(
            &r.nodes[0],
            &[record(&id2, "failed"), record(&id2, "ok")]
        ));
        // Work on another PC does not count.
        assert!(setup_done(&r.nodes[0], &[record("another-pc", "running")]));
        let _ = id;
    }

    #[test]
    fn the_local_lefi_desktop_also_gets_the_gateway_address_and_loopback() {
        let env = "LEFI_ADMIN_URL=https://192.0.2.10:8443\n";
        assert_eq!(
            super::local_alternates(
                env,
                "https://lefi-main.local:8443, https://192.0.2.10:8443",
                8443
            ),
            ["https://192.0.2.10:8443"]
        );
        assert_eq!(
            super::local_alternates(env, "x, https://localhost:8443 {", 8443),
            ["https://192.0.2.10:8443", "https://localhost:8443"]
        );
        assert!(super::local_alternates("LEFI_ADMIN_URL=http://x:8080", "", 8443).is_empty());
    }

    #[test]
    fn only_an_installed_unpaired_lefi_desktop_gets_an_offer_and_not_too_often() {
        let (mut r, id) = reg_with(Some(false), true);
        assert!(wants_desktop_offer(&r, &id, 1000));
        r.nodes[0].desktop_pair_at = Some(1000);
        assert!(!wants_desktop_offer(&r, &id, 1000 + 60));
        assert!(wants_desktop_offer(&r, &id, 1000 + DESKTOP_OFFER_EVERY_S));
        let (r, id) = reg_with(Some(true), true);
        assert!(!wants_desktop_offer(&r, &id, 1000), "already paired");
        let (r, id) = reg_with(None, false);
        assert!(!wants_desktop_offer(&r, &id, 1000), "no Lefi Desktop there");
    }
}

// ------------------------------------------------------------------ restart after an update (ADR-104)

/// How often the service compares its own version with the program now on disk.
pub const REPLACED_CHECK_EVERY: std::time::Duration = std::time::Duration::from_secs(60);
/// Exit code that tells launchd (KeepAlive, SuccessfulExit = false) to start the service again.
pub const RESTART_EXIT_CODE: i32 = 75;

/// The version the program at `exe` reports, if it runs.
pub async fn version_on_disk(exe: &Path) -> Option<String> {
    let o = tokio::process::Command::new(exe)
        .arg("version")
        .stdin(std::process::Stdio::null())
        .output()
        .await
        .ok()?;
    let text = String::from_utf8_lossy(&o.stdout);
    text.split_whitespace()
        .find(|w| w.chars().next().is_some_and(|c| c.is_ascii_digit()))
        .map(str::to_string)
}

/// Another version is on disk and nothing this service started is running.
pub fn must_restart(on_disk: &str, busy: bool) -> bool {
    on_disk != crate::VERSION && !busy
}

/// Replacing Lefi Crop Helper.app does not restart a service already running from the old one, and
/// the old one kept answering (the main MacBook's robot, 0.20.0). When the program on disk reports
/// another version, the service exits with `RESTART_EXIT_CODE` once nothing it started is running
/// (a robot install or removal, a backup), and launchd starts the new program.
pub async fn restart_when_replaced(s: Arc<Shared>) {
    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    loop {
        tokio::time::sleep(REPLACED_CHECK_EVERY).await;
        let Some(on_disk) = version_on_disk(&exe).await else {
            continue; // being replaced right now, or gone: look again later
        };
        let robot_busy = s
            .robot_job
            .lock()
            .expect("robot job lock")
            .as_ref()
            .is_some_and(|j| j.state == "running");
        let busy = robot_busy || crate::backup::RUNNING.load(std::sync::atomic::Ordering::SeqCst);
        if !must_restart(&on_disk, busy) {
            continue;
        }
        eprintln!(
            "lefi-helperd {} replaced by {on_disk} on disk: restarting to run it",
            crate::VERSION
        );
        std::process::exit(RESTART_EXIT_CODE);
    }
}

#[cfg(test)]
mod restart_tests {
    use super::*;

    #[tokio::test]
    async fn a_replaced_program_is_noticed_and_restarts_only_when_idle() {
        let d = tempfile::tempdir().unwrap();
        let exe = d.path().join("lefi-helperd");
        std::fs::write(&exe, "#!/bin/sh\necho 9.9.9\n").unwrap();
        std::fs::set_permissions(&exe, std::os::unix::fs::PermissionsExt::from_mode(0o755))
            .unwrap();
        assert_eq!(version_on_disk(&exe).await.as_deref(), Some("9.9.9"));
        assert!(version_on_disk(&d.path().join("missing")).await.is_none());
        assert!(must_restart("9.9.9", false));
        assert!(
            !must_restart("9.9.9", true),
            "never in the middle of an install or a backup"
        );
        assert!(!must_restart(crate::VERSION, false));
    }
}
