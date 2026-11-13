//! lefi-helperd main      --data DIR [--ip IP] [--bind IP] [--satellite-bin PATH] [--payload-root DIR] [ports]
//! lefi-helperd join      --data DIR --main IP --code XXXX-XXXX --ca-fp SHA256
//! lefi-helperd satellite --data DIR
//! lefi-helperd install-service main|satellite --data DIR [--scope boot --user NAME|--scope login] (macOS)
//! lefi-helperd uninstall-service main|satellite [--scope boot]
//! lefi-helperd status    --data DIR                         (what a heartbeat would report)
//! lefi-helperd session   --data DIR                         (agent inside the user's session, ADR-040)

use std::collections::HashMap;
use std::net::IpAddr;
use std::path::PathBuf;
use std::process::ExitCode;

use lefi_helperd::error::{Error, Result};
use lefi_helperd::main_node::{self, MainConfig, Shared};
use lefi_helperd::protocol::{ADMIN_PORT, HTTP_PORT, TLS_PORT};
use lefi_helperd::{ca, licence, satellite, service};

fn flags(args: &[String]) -> Result<(Vec<String>, HashMap<String, String>)> {
    let (mut pos, mut map) = (Vec::new(), HashMap::new());
    let mut it = args.iter();
    while let Some(a) = it.next() {
        if let Some(k) = a.strip_prefix("--") {
            let v = it
                .next()
                .ok_or_else(|| Error::new("USAGE", format!("--{k} needs a value")))?;
            map.insert(k.to_string(), v.clone());
        } else {
            pos.push(a.clone());
        }
    }
    Ok((pos, map))
}

fn need<'a>(m: &'a HashMap<String, String>, k: &str) -> Result<&'a String> {
    m.get(k)
        .ok_or_else(|| Error::new("USAGE", format!("--{k} is required")))
}

fn port(m: &HashMap<String, String>, k: &str, default: u16) -> Result<u16> {
    m.get(k).map_or(Ok(default), |v| {
        v.parse()
            .map_err(|_| Error::new("USAGE", format!("--{k} must be a port")))
    })
}

/// Tests point the probes at a fake AI and a temporary home with these variables.
fn exec_options() -> lefi_helperd::executor::ExecOptions {
    lefi_helperd::executor::ExecOptions {
        ai_port: std::env::var("LEFI_HELPERD_AI_PORT")
            .ok()
            .and_then(|v| v.parse().ok()),
        home: std::env::var_os("LEFI_HELPERD_HOME").map(PathBuf::from),
        publish_name: std::env::var_os("LEFI_HELPERD_NO_MDNS").is_none(),
        // The real service: after replacing its program it exits and launchd starts the new one.
        exit_after_service_update: true,
        ..Default::default()
    }
}

async fn run(args: Vec<String>) -> Result<()> {
    let (cmd, rest) = args
        .split_first()
        .ok_or_else(|| Error::new("USAGE", "see the header of src/main.rs"))?;
    let (pos, m) = flags(rest)?;
    match cmd.as_str() {
        "main" => {
            let data = PathBuf::from(need(&m, "data")?);
            let root = ca::RootCa::load(&data)?;
            let (installation_id, lic) = licence::load(&data, &root.cert_pem)?;
            let lan_ips: Vec<IpAddr> = match m.get("ip") {
                Some(v) => vec![v
                    .parse()
                    .map_err(|_| Error::new("USAGE", "--ip must be an IP address"))?],
                None => main_node::detect_lan_ip().into_iter().collect(),
            };
            let session_dir = data.join("session").display().to_string();
            let cfg = MainConfig {
                data_dir: data,
                lan_ips,
                bind: m
                    .get("bind")
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(IpAddr::from([0, 0, 0, 0])),
                http_port: port(&m, "http-port", HTTP_PORT)?,
                tls_port: port(&m, "tls-port", TLS_PORT)?,
                admin_port: port(&m, "admin-port", ADMIN_PORT)?,
                ai_port: 11434,
                // As the boot service (LaunchDaemon) this process is outside the user's GUI session:
                // the CLI loads LaunchAgents (the simulated robot) through `lefi-helperd session`
                // there. Inside the session the CLI calls launchctl directly (ADR-040, ADR-104).
                cli_env: vec![(
                    "LEFI_SESSION_DIR".into(),
                    session_dir,
                )],
                publish_name: std::env::var_os("LEFI_HELPERD_NO_MDNS").is_none(),
                auto_pair_desktops: std::env::var_os("LEFI_HELPERD_NO_AUTO_PAIR").is_none(),
                auto_pair_local: std::env::var_os("LEFI_HELPERD_NO_AUTO_PAIR").is_none(),
                payload_root: m
                    .get("payload-root")
                    .map(PathBuf::from)
                    .or_else(|| std::env::var_os("LEFI_ROOT").map(PathBuf::from)),
                satellite_bin: Some(m.get("satellite-bin").map(PathBuf::from).unwrap_or(
                    std::env::current_exe().map_err(|e| Error::new("EXE", e.to_string()))?,
                )),
            };
            eprintln!(
                "licence {} · {} PC(s) · customer {}",
                lic.licence_id, lic.max_pcs, lic.customer
            );
            let shared = Shared::new(cfg, root, installation_id, lic.max_pcs)?;
            tokio::spawn(main_node::restart_when_replaced(shared.clone()));
            main_node::run(shared).await
        }
        "join" => {
            let data = PathBuf::from(need(&m, "data")?);
            let cfg = satellite::join(
                &data,
                need(&m, "main")?,
                need(&m, "code")?,
                need(&m, "ca-fp")?,
                port(&m, "http-port", HTTP_PORT)?,
                port(&m, "tls-port", TLS_PORT)?,
            )
            .await?;
            println!("Joined as {} (main PC {}).", cfg.node_id, cfg.main);
            Ok(())
        }
        "version" => {
            println!("{}", env!("CARGO_PKG_VERSION"));
            Ok(())
        }
        "satellite" => {
            // LEFI_HELPERD_HEARTBEAT_SECS: faster heartbeats for tests only.
            let every = std::env::var("LEFI_HELPERD_HEARTBEAT_SECS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(lefi_helperd::protocol::HEARTBEAT_SECS);
            satellite::run_with(&PathBuf::from(need(&m, "data")?), exec_options(), every).await
        }
        "session" => lefi_helperd::session::run(&PathBuf::from(need(&m, "data")?)).await,
        "status" => {
            let data = PathBuf::from(need(&m, "data")?);
            println!(
                "{}",
                serde_json::to_string_pretty(&satellite::collect(&data, &exec_options()).await)
                    .unwrap_or_default()
            );
            Ok(())
        }
        "install-service" => {
            let mode = pos.first().map(String::as_str).unwrap_or("");
            if mode != "main" && mode != "satellite" {
                return Err(Error::new(
                    "USAGE",
                    "install-service main|satellite --data DIR [--scope boot --user NAME | --scope login] [--payload-root DIR]",
                ));
            }
            let exe = std::env::current_exe().map_err(|e| Error::new("EXE", e.to_string()))?;
            let scope = match m.get("scope").map(String::as_str).unwrap_or("login") {
                "boot" => {
                    let user = need(&m, "user")?.clone();
                    let home = service::home_of(&user)?;
                    service::Scope::Boot { user, home }
                }
                "login" => service::Scope::Login,
                _ => return Err(Error::new("USAGE", "--scope boot|login")),
            };
            let mut extra = vec![];
            if let Some(r) = m.get("payload-root") {
                extra.extend(["--payload-root".to_string(), r.clone()]);
            }
            let p = service::install(
                mode,
                &exe,
                &PathBuf::from(need(&m, "data")?),
                &extra,
                &scope,
            )?;
            println!(
                "Service {} registered ({}, {}).",
                service::label(mode),
                if matches!(scope, service::Scope::Boot { .. }) {
                    "starts when the Mac starts"
                } else {
                    "starts at login"
                },
                p.display()
            );
            Ok(())
        }
        "uninstall-service" => {
            let mode = pos.first().map(String::as_str).unwrap_or("");
            let boot = m.get("scope").map(String::as_str) == Some("boot");
            service::uninstall(mode, boot)?;
            println!("Service {} removed.", service::label(mode));
            Ok(())
        }
        _ => Err(Error::new(
            "USAGE",
            "commands: main, join, satellite, session, status, version, install-service, uninstall-service",
        )),
    }
}

#[tokio::main]
async fn main() -> ExitCode {
    lefi_helperd::init_crypto();
    match run(std::env::args().skip(1).collect()).await {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("error: {e}");
            ExitCode::from(if e.code == "NODE_REVOKED" || e.code == "NODE_UNKNOWN" {
                3
            } else {
                1
            })
        }
    }
}
