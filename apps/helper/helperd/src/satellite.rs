//! Satellite mode: enrol once with a code, then only send heartbeats (outbound, mTLS).
//! A satellite never listens on the network and knows only the main PC's address and root CA.

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::ca::{der_from_pem, fingerprint, new_csr};
use crate::error::{io, Error, Result};
use crate::protocol::{
    EnrollRequest, EnrollResponse, Heartbeat, HeartbeatResponse, ServiceState, HEARTBEAT_SECS,
    HTTP_PORT, TLS_PORT,
};

/// The port the name's service record points at; a satellite itself listens on nothing.
const AI_ANNOUNCE_PORT: u16 = crate::report::AI_PORT;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SatelliteConfig {
    pub main: String,
    pub node_id: String,
    pub http_port: u16,
    pub tls_port: u16,
}

fn node_dir(data: &Path) -> PathBuf {
    data.join("node")
}

fn write_private(path: &Path, content: &str) -> Result<()> {
    use std::io::Write;
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    opts.open(path)
        .and_then(|mut f| f.write_all(content.as_bytes()))
        .map_err(io("NODE_WRITE"))
}

pub fn hostname() -> String {
    std::process::Command::new("hostname")
        .arg("-s")
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|h| !h.is_empty())
        .unwrap_or_else(|| "unknown".into())
}

fn https_client(root_pem: &str, identity: Option<reqwest::Identity>) -> Result<reqwest::Client> {
    let root = reqwest::Certificate::from_pem(root_pem.as_bytes())
        .map_err(|e| Error::new("TLS_CONFIG", e.to_string()))?;
    let mut b = reqwest::Client::builder()
        .use_rustls_tls()
        .tls_built_in_root_certs(false) // trust only this installation's root CA
        .add_root_certificate(root)
        .timeout(Duration::from_secs(15))
        .connect_timeout(Duration::from_secs(5));
    if let Some(id) = identity {
        b = b.identity(id);
    }
    b.build()
        .map_err(|e| Error::new("TLS_CONFIG", e.to_string()))
}

async fn api_error(resp: reqwest::Response) -> Error {
    let status = resp.status();
    let body: serde_json::Value = resp.json().await.unwrap_or_default();
    let code = body["error"]["code"]
        .as_str()
        .unwrap_or("HTTP_ERROR")
        .to_string();
    let msg = body["error"]["message"].as_str().unwrap_or("").to_string();
    // `code` must be 'static: map the known ones, keep the text in the message.
    let known: &'static str = match code.as_str() {
        "CODE_INVALID" => "CODE_INVALID",
        "CODE_USED" => "CODE_USED",
        "CODE_EXPIRED" => "CODE_EXPIRED",
        "CODE_WRONG_PC" => "CODE_WRONG_PC",
        "LICENCE_PC_LIMIT" => "LICENCE_PC_LIMIT",
        "NODE_REVOKED" => "NODE_REVOKED",
        "NODE_UNKNOWN" => "NODE_UNKNOWN",
        _ => "MAIN_REFUSED",
    };
    Error::new(known, format!("{msg} (HTTP {status}, {code})"))
}

/// Enrols this PC: fetches the root CA, checks it against the fingerprint from the main PC's
/// screen, sends a CSR with the one-time code and stores the signed certificate.
pub async fn join(
    data: &Path,
    main: &str,
    code: &str,
    ca_fp: &str,
    http_port: u16,
    tls_port: u16,
) -> Result<SatelliteConfig> {
    if main.parse::<std::net::IpAddr>().is_err() {
        return Err(Error::new(
            "BAD_REQUEST",
            "The main PC must be given as an IP address.",
        ));
    }
    let root_pem = reqwest::get(format!("http://{main}:{http_port}/setup/ca.pem"))
        .await
        .map_err(|e| {
            Error::new(
                "MAIN_UNREACHABLE",
                format!("Cannot reach the main PC at {main}: {e}"),
            )
        })?
        .text()
        .await
        .map_err(|e| Error::new("MAIN_UNREACHABLE", e.to_string()))?;
    let got = fingerprint(&der_from_pem(&root_pem)?);
    if got != ca_fp.trim().to_ascii_lowercase() {
        return Err(Error::new(
            "CA_MISMATCH",
            "The main PC's certificate does not match the fingerprint in the command. Do not continue: check the address and the command on the main PC.",
        ));
    }
    let host = hostname();
    let (csr_pem, key_pem) = new_csr(&host)?;
    let req = EnrollRequest {
        code: code.to_string(),
        csr_pem,
        hostname: host,
        os: std::env::consts::OS.into(),
        arch: std::env::consts::ARCH.into(),
        helperd_version: env!("CARGO_PKG_VERSION").into(),
    };
    let client = https_client(&root_pem, None)?;
    let resp = client
        .post(format!("https://{main}:{tls_port}/v1/enroll"))
        .json(&req)
        .send()
        .await
        .map_err(|e| Error::new("MAIN_UNREACHABLE", format!("Enrolment failed: {e}")))?;
    if !resp.status().is_success() {
        return Err(api_error(resp).await);
    }
    let er: EnrollResponse = resp
        .json()
        .await
        .map_err(|e| Error::new("MAIN_REFUSED", e.to_string()))?;
    let dir = node_dir(data);
    std::fs::create_dir_all(&dir).map_err(io("NODE_WRITE"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(data, std::fs::Permissions::from_mode(0o700));
        let _ = std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700));
    }
    write_private(&dir.join("key.pem"), &key_pem)?;
    write_private(&dir.join("cert.pem"), &er.cert_pem)?;
    write_private(&dir.join("root-ca.pem"), &root_pem)?;
    let cfg = SatelliteConfig {
        main: main.into(),
        node_id: er.node_id,
        http_port,
        tls_port,
    };
    write_private(
        &dir.join("config.json"),
        &serde_json::to_string_pretty(&cfg).unwrap_or_default(),
    )?;
    if !er.name.is_empty() {
        println!("Lefi Crop calls this PC {}.", er.name);
    }
    Ok(cfg)
}

/// Facts about this PC, measured now (null when not measurable here).
pub async fn collect(data: &Path, opts: &crate::executor::ExecOptions) -> Heartbeat {
    static PC: std::sync::OnceLock<crate::protocol::PcFacts> = std::sync::OnceLock::new();
    let pc = PC.get_or_init(crate::report::pc_facts);
    Heartbeat {
        hostname: hostname(),
        os: std::env::consts::OS.into(),
        arch: std::env::consts::ARCH.into(),
        helperd_version: env!("CARGO_PKG_VERSION").into(),
        uptime_s: uptime_s(),
        disk_free_gb: disk_free_gb(data),
        services: lefi_services(),
        report: Some(crate::report::collect(opts, pc).await),
    }
}

fn now_s() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn uptime_s() -> Option<u64> {
    if cfg!(target_os = "macos") {
        // kern.boottime: "{ sec = 1700000000, usec = 0 } ..."
        let out = std::process::Command::new("sysctl")
            .args(["-n", "kern.boottime"])
            .output()
            .ok()?;
        let s = String::from_utf8_lossy(&out.stdout);
        let sec: u64 = s
            .split("sec = ")
            .nth(1)?
            .split(',')
            .next()?
            .trim()
            .parse()
            .ok()?;
        Some(now_s().saturating_sub(sec))
    } else {
        let s = std::fs::read_to_string("/proc/uptime").ok()?;
        s.split_whitespace()
            .next()?
            .parse::<f64>()
            .ok()
            .map(|f| f as u64)
    }
}

fn disk_free_gb(path: &Path) -> Option<f64> {
    let out = std::process::Command::new("df")
        .arg("-k")
        .arg(path)
        .output()
        .ok()?;
    let s = String::from_utf8_lossy(&out.stdout);
    let line = s.lines().nth(1)?;
    let avail_kb: f64 = line.split_whitespace().nth(3)?.parse().ok()?;
    Some((avail_kb / 1024.0 / 1024.0 * 10.0).round() / 10.0)
}

/// macOS: Lefi Crop LaunchAgents (`com.lefi-crop.*`) and whether they have a running process.
/// Linux: not collected yet (tech debt, ADR-033).
fn lefi_services() -> Vec<ServiceState> {
    if !cfg!(target_os = "macos") {
        return vec![];
    }
    let Ok(out) = std::process::Command::new("launchctl").arg("list").output() else {
        return vec![];
    };
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter_map(|l| {
            let mut f = l.split_whitespace();
            let pid = f.next()?;
            let _status = f.next()?;
            let label = f.next()?;
            label
                .strip_prefix("com.lefi-crop.")
                .map(|name| ServiceState {
                    name: name.to_string(),
                    state: if pid == "-" {
                        "stopped".into()
                    } else {
                        "running".into()
                    },
                })
        })
        .collect()
}

pub fn load_config(data: &Path) -> Result<SatelliteConfig> {
    let text = std::fs::read_to_string(node_dir(data).join("config.json")).map_err(|_| {
        Error::new(
            "NOT_ENROLLED",
            "This PC has not joined an installation (run: lefi-helperd join …).",
        )
    })?;
    serde_json::from_str(&text).map_err(|e| Error::new("NODE_CORRUPT", e.to_string()))
}

/// An HTTPS client that presents this PC's certificate and trusts only the installation's CA.
pub fn client_for(data: &Path) -> Result<reqwest::Client> {
    let dir = node_dir(data);
    let root = std::fs::read_to_string(dir.join("root-ca.pem")).map_err(io("NODE_CORRUPT"))?;
    let mut ident = std::fs::read(dir.join("cert.pem")).map_err(io("NODE_CORRUPT"))?;
    ident.extend(std::fs::read(dir.join("key.pem")).map_err(io("NODE_CORRUPT"))?);
    let identity = reqwest::Identity::from_pem(&ident)
        .map_err(|e| Error::new("NODE_CORRUPT", e.to_string()))?;
    https_client(&root, Some(identity))
}

/// Accepts and starts a command from a heartbeat response (one at a time).
pub fn start_command(
    data: &Path,
    cfg: &SatelliteConfig,
    cmd: crate::protocol::Command,
    busy: &std::sync::Arc<std::sync::atomic::AtomicBool>,
    opts: crate::executor::ExecOptions,
) {
    use std::sync::atomic::Ordering;
    if busy.swap(true, Ordering::SeqCst) {
        eprintln!("command {} ignored: another command is running", cmd.id);
        return;
    }
    if let Err(e) = crate::executor::accept(data, cfg, &cmd, now_s()) {
        eprintln!("command {} rejected: {e}", cmd.id);
        busy.store(false, Ordering::SeqCst);
        return;
    }
    eprintln!(
        "command {} ({}{}) accepted",
        cmd.id,
        cmd.kind,
        if cmd.dry_run { ", dry run" } else { "" }
    );
    let (data, cfg, busy) = (data.to_path_buf(), cfg.clone(), busy.clone());
    tokio::spawn(async move {
        crate::executor::execute(data, cfg, cmd, opts).await;
        busy.store(false, Ordering::SeqCst);
    });
}

/// One heartbeat. Returns what the main PC answered.
pub async fn beat(
    data: &Path,
    cfg: &SatelliteConfig,
    opts: &crate::executor::ExecOptions,
) -> Result<HeartbeatResponse> {
    let client = client_for(data)?;
    let resp = client
        .post(format!(
            "https://{}:{}/v1/heartbeat",
            cfg.main, cfg.tls_port
        ))
        .json(&collect(data, opts).await)
        .send()
        .await
        .map_err(|e| Error::new("MAIN_UNREACHABLE", e.to_string()))?;
    if !resp.status().is_success() {
        return Err(api_error(resp).await);
    }
    resp.json()
        .await
        .map_err(|e| Error::new("MAIN_REFUSED", e.to_string()))
}

/// The service loop: a heartbeat every few seconds; stops for good when the main PC removed
/// this PC (exit code 3 so the service manager can tell).
pub async fn run(data: &Path) -> Result<()> {
    run_with(
        data,
        crate::executor::ExecOptions::default(),
        HEARTBEAT_SECS,
    )
    .await
}

/// The loop with options (tests: a temporary installer state folder, faster heartbeats).
pub async fn run_with(data: &Path, opts: crate::executor::ExecOptions, every: u64) -> Result<()> {
    let cfg = load_config(data)?;
    eprintln!(
        "lefi-helperd satellite {} → main {}:{}",
        cfg.node_id, cfg.main, cfg.tls_port
    );
    let busy = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    // A command interrupted by a restart of this PC continues first (ADR-033).
    if data.join("node").join("current.json").exists() {
        busy.store(true, std::sync::atomic::Ordering::SeqCst);
        let (d, c, b, o) = (data.to_path_buf(), cfg.clone(), busy.clone(), opts.clone());
        tokio::spawn(async move {
            crate::executor::resume(d, c, o).await;
            b.store(false, std::sync::atomic::Ordering::SeqCst);
        });
    }
    let mut wait = every;
    let mut names = crate::names::Publisher::default();
    loop {
        // Erased (ADR-054): nothing of this PC's enrolment is left; end cleanly.
        if !crate::service::satellite_marker(data).exists() {
            eprintln!("this PC was erased from the installation; stopping");
            return Ok(());
        }
        match beat(data, &cfg, &opts).await {
            Ok(r) => {
                if opts.publish_name && !r.name.is_empty() {
                    if let Some(ip) = crate::main_node::detect_lan_ip() {
                        names.publish(&r.name, &ip.to_string(), AI_ANNOUNCE_PORT);
                    }
                }
                wait = if every < HEARTBEAT_SECS {
                    every
                } else {
                    r.interval_s.clamp(5, 300)
                };
                if let Some(cmd) = r.command {
                    start_command(data, &cfg, cmd, &busy, opts.clone());
                }
            }
            Err(e) if e.code == "NODE_REVOKED" || e.code == "NODE_UNKNOWN" => {
                eprintln!("removed by the main PC: {e}");
                return Err(e);
            }
            Err(e) => {
                eprintln!("heartbeat failed (will retry): {e}");
                wait = (wait * 2).min(60);
            }
        }
        tokio::time::sleep(Duration::from_secs(wait)).await;
    }
}

pub const DEFAULT_HTTP_PORT: u16 = HTTP_PORT;
pub const DEFAULT_TLS_PORT: u16 = TLS_PORT;
