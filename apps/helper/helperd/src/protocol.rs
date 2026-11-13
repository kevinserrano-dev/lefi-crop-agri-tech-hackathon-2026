//! Messages between the main PC and satellites (JSON over TLS).

use serde::{Deserialize, Serialize};

pub const HTTP_PORT: u16 = 8790; // join page /setup (read-only) + downloads
pub const TLS_PORT: u16 = 8791; // enrolment (code) + heartbeats (client certificate)
pub const ADMIN_PORT: u16 = 8792; // console API, loopback only, bearer token
pub const HEARTBEAT_SECS: u64 = 10;
pub const ONLINE_SECS: u64 = 35;
pub const STALE_SECS: u64 = 120;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EnrollRequest {
    pub code: String,
    pub csr_pem: String,
    pub hostname: String,
    pub os: String,
    pub arch: String,
    pub helperd_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnrollResponse {
    pub node_id: String,
    pub cert_pem: String,
    /// The name Lefi gives this PC (`lefi-node-N`).
    #[serde(default)]
    pub name: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct ServiceState {
    pub name: String,
    /// running · stopped · unknown (from launchctl on macOS).
    pub state: String,
}

/// What a satellite reports. Only facts measured on that PC; null when not measurable.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Heartbeat {
    pub hostname: String,
    pub os: String,
    pub arch: String,
    pub helperd_version: String,
    pub uptime_s: Option<u64>,
    pub disk_free_gb: Option<f64>,
    pub services: Vec<ServiceState>,
    /// Absent from a service older than ADR-040: the main PC asks to update it.
    #[serde(default)]
    pub report: Option<NodeReport>,
}

/// What the PC measures about itself (`report.rs`, ADR-040). Null: not measurable here.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct NodeReport {
    pub pc: PcFacts,
    pub metrics: Metrics,
    pub components: Vec<ComponentState>,
    /// The AI answering on this PC's loopback; null when nothing answers.
    pub ai: Option<AiReport>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct PcFacts {
    pub model: Option<String>,
    pub chip: Option<String>,
    pub cores: Option<u32>,
    pub memory_gb: Option<f64>,
    pub os_version: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Metrics {
    pub load_1m: Option<f64>,
    pub memory_used_gb: Option<f64>,
    pub gpu_utilization_pct: Option<f64>,
    pub gpu_memory_in_use_gb: Option<f64>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct ComponentState {
    /// ai · desktop · robot · firmware
    pub id: String,
    pub installed: bool,
    /// running · stopped · disabled · installed · external · not_installed
    pub state: String,
    pub version: Option<String>,
    pub detail: Option<String>,
    pub path: Option<String>,
    /// Lefi Desktop only: paired with Lefi Brain on this PC (its `pairing.json` exists, ADR-050).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub paired: Option<bool>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct AiReport {
    pub version: Option<String>,
    pub models: Vec<AiModel>,
    pub loaded: Vec<AiLoaded>,
    /// The service was set to listen on the network (null: not a Lefi Crop service).
    pub lan: Option<bool>,
    pub kill_switch: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct AiModel {
    pub name: String,
    pub size_gb: f64,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct AiLoaded {
    pub name: String,
    pub size_gb: f64,
    /// Share of the model in GPU memory (Ollama `size_vram / size`).
    pub gpu_pct: Option<u64>,
    pub context_length: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HeartbeatResponse {
    pub interval_s: u64,
    /// The name this PC announces on the network (ADR-042).
    #[serde(default)]
    pub name: String,
    /// Components assigned to this PC on the main PC.
    pub assigned: Vec<String>,
    /// A command for this PC, delivered once (ADR-033 slice 2).
    #[serde(default)]
    pub command: Option<Command>,
}

/// What the main PC asks a satellite to do. Commands travel only over the mTLS channel whose
/// server the satellite authenticated with the pinned root CA; the satellite also checks the
/// target, the expiry and that the id was never run before (safety rule: no duplicate execution).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Command {
    pub id: String,
    pub node_id: String,
    /// The only things a satellite can be asked to do (ADR-040; there is no remote shell):
    /// install · rollback · remove · service · ai_bench · desktop_pair · erase
    pub kind: String,
    /// Installer roles this command installs (install only).
    pub roles: Vec<String>,
    /// `--dry-run`: show the plan on that PC, change nothing.
    pub dry_run: bool,
    /// The `--answers` file, rendered on the main PC (install only).
    pub answers: String,
    /// SHA-256 of the installer payload the satellite must download (`GET /v1/payload`).
    pub payload_sha256: String,
    pub issued_at: u64,
    pub expires_at: u64,
    /// Rollback: the install command whose runs to undo (all of them, also across a restart).
    #[serde(default)]
    pub target_command: Option<String>,
    /// `service`: start · stop · restart · off · on (of `roles[0]`).
    #[serde(default)]
    pub action: Option<String>,
    /// `desktop_pair`: the one-time offer for this PC's Lefi Desktop (ADR-050). Not sent when empty,
    /// so older satellites still accept the other commands.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pairing: Option<PairingOffer>,
    /// `update_service`: the service program this PC must download from the main PC (ADR-062).
    /// Not sent when empty, so older satellites still accept the other commands.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub service_update: Option<ServiceUpdate>,
}

/// The main PC's service program for this PC: its version, platform and SHA-256. The satellite
/// downloads it over mTLS (`GET /v1/helperd`), checks the SHA-256 and that it answers this version.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ServiceUpdate {
    pub version: String,
    pub platform: String,
    pub sha256: String,
}

impl ServiceUpdate {
    pub fn valid(&self) -> bool {
        let numeric = self.version.split('.').count() == 3
            && self
                .version
                .split('.')
                .all(|p| !p.is_empty() && p.len() <= 6 && p.chars().all(|c| c.is_ascii_digit()));
        numeric
            && self.platform.len() <= 32
            && self
                .platform
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
            && self.sha256.len() == 64
            && self.sha256.chars().all(|c| c.is_ascii_hexdigit())
    }
}

/// `a.b.c` numerically newer than `b`; anything else is not (the rule of ADR-051).
pub fn is_newer(candidate: &str, installed: &str) -> bool {
    let parse = |s: &str| -> Option<Vec<u64>> {
        let p: Option<Vec<u64>> = s.trim().split('.').map(|x| x.parse().ok()).collect();
        p.filter(|p| p.len() == 3)
    };
    matches!((parse(candidate), parse(installed)), (Some(a), Some(b)) if a > b)
}

/// What Lefi Desktop needs to pair by itself: Lefi Brain's address, a one-time code made by Lefi
/// Brain on the main PC, and the SHA-256 of Lefi Gateway's CA it must find in the answer.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PairingOffer {
    pub url: String,
    pub code: String,
    pub gateway_ca_fingerprint: String,
}

impl PairingOffer {
    /// Checked on both PCs: an https origin, a pairing code, a SHA-256 in hex.
    pub fn valid(&self) -> bool {
        let code: String = self.code.chars().filter(|c| *c != '-').collect();
        self.url.starts_with("https://")
            && self.url.len() < 200
            && !self.url[8..].contains(['/', '?', '#', '@', ' '])
            && code.len() == 12
            && code.chars().all(|c| c.is_ascii_alphanumeric())
            && self.gateway_ca_fingerprint.len() == 64
            && self
                .gateway_ca_fingerprint
                .chars()
                .all(|c| c.is_ascii_hexdigit())
    }
}

/// A batch of what the installer printed on the satellite, in order.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CommandEvents {
    /// NDJSON events of `install.sh --events ndjson`, unchanged.
    pub events: Vec<serde_json::Value>,
    /// Human output lines (stderr).
    pub output: Vec<String>,
    /// Set on the last batch.
    pub finished: Option<CommandFinished>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CommandFinished {
    pub exit_code: Option<i32>,
    /// A failure before the installer could run (payload, checks); empty otherwise.
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandEventsResponse {
    /// The console asked to cancel: the satellite creates the installer's cancel file.
    pub cancel: bool,
}

pub const COMMAND_TTL_SECS: u64 = 15 * 60;
