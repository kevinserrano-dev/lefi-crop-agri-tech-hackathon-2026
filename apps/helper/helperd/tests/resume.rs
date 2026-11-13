//! A satellite PC "loses power" in the middle of a remote install: the satellite service and its
//! installer are killed with SIGKILL, then the service starts again (real binary, real TLS on
//! loopback, a clearly fake installer payload). The command must continue, or — if Cancel was
//! pressed while the PC was down — every run of it must be undone.

use std::net::IpAddr;
use std::path::{Path, PathBuf};
use std::process::{Child, Command as Proc};
use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::Arc;
use std::time::Duration;

use lefi_helperd::ca::{test_root, RootCa};
use lefi_helperd::main_node::{self, MainConfig, Shared};
use lefi_helperd::satellite;
use serde_json::{json, Value};

static NEXT_PORT: AtomicU16 = AtomicU16::new(30790);

struct Env {
    shared: Arc<Shared>,
    admin: u16,
    sat: tempfile::TempDir,
    _main: tempfile::TempDir,
}

async fn admin(e: &Env, method: &str, path: &str, body: Value) -> Value {
    let c = reqwest::Client::new();
    let url = format!("http://127.0.0.1:{}{path}", e.admin);
    let r = if method == "GET" {
        c.get(url)
    } else {
        c.post(url).json(&body)
    };
    r.bearer_auth(&e.shared.admin_token)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap_or(Value::Null)
}

async fn setup() -> (Env, String) {
    lefi_helperd::init_crypto();
    let main_dir = tempfile::tempdir().unwrap();
    let sat = tempfile::tempdir().unwrap();
    let (cpem, kpem) = test_root();
    let p = NEXT_PORT.fetch_add(3, Ordering::SeqCst);
    let cfg = MainConfig {
        publish_name: false,
        auto_pair_desktops: false,
        auto_pair_local: false,
        data_dir: main_dir.path().to_path_buf(),
        lan_ips: vec![IpAddr::from([127, 0, 0, 1])],
        bind: IpAddr::from([127, 0, 0, 1]),
        http_port: p,
        tls_port: p + 1,
        admin_port: p + 2,
        ai_port: 9,
        cli_env: vec![],
        satellite_bin: None,
        payload_root: Some(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fake-installer")),
    };
    let shared = Shared::new(
        cfg,
        RootCa::from_pem(&cpem, &kpem).unwrap(),
        "TEST".into(),
        3,
    )
    .unwrap();
    tokio::spawn(main_node::run(shared.clone()));
    for _ in 0..50 {
        if reqwest::get(format!("http://127.0.0.1:{p}/setup"))
            .await
            .is_ok()
        {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    let e = Env {
        shared: shared.clone(),
        admin: p + 2,
        sat,
        _main: main_dir,
    };
    let code = admin(&e, "POST", "/admin/codes", json!({})).await;
    let cfg = satellite::join(
        e.sat.path(),
        "127.0.0.1",
        code["code"].as_str().unwrap(),
        &shared.ca.fingerprint,
        p,
        p + 1,
    )
    .await
    .unwrap();
    admin(
        &e,
        "POST",
        &format!("/admin/nodes/{}/assign", cfg.node_id),
        json!({"roles":["ai"]}),
    )
    .await;
    (e, cfg.node_id)
}

/// The real `lefi-helperd satellite` process.
fn start_satellite(data: &Path) -> Child {
    Proc::new(env!("CARGO_BIN_EXE_lefi-helperd"))
        .args(["satellite", "--data"])
        .arg(data)
        .env("LEFI_HELPERD_HEARTBEAT_SECS", "1")
        .env("LEFI_HELPERD_AI_PORT", "1")
        .env("LEFI_HELPERD_NO_MDNS", "1")
        .env(
            "LEFI_HELPERD_HOME",
            std::env::temp_dir().join("lefi-helperd-test-no-home"),
        )
        .env("FAKE_STEP_SECS", "3")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .unwrap()
}

/// "Power cut": SIGKILL the service and the installer it started.
fn power_cut(sat: &mut Child, data: &Path) {
    let cur: Value =
        serde_json::from_slice(&std::fs::read(data.join("node/current.json")).unwrap()).unwrap();
    sat.kill().unwrap();
    let _ = sat.wait();
    if let Some(pid) = cur["pid"].as_u64() {
        let _ = Proc::new("kill").args(["-9", &pid.to_string()]).status();
    }
}

async fn wait_for(e: &Env, cmd: &str, states: &[&str], secs: u64) -> Value {
    for _ in 0..secs * 4 {
        let v = admin(e, "GET", &format!("/admin/commands/{cmd}"), Value::Null).await;
        if states.contains(&v["record"]["state"].as_str().unwrap_or("")) {
            return v;
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    panic!("{cmd} never reached {states:?}");
}

fn journals(data: &Path, cmd: &str) -> Vec<String> {
    let m: Value =
        serde_json::from_slice(&std::fs::read(data.join("node/journals.json")).unwrap_or_default())
            .unwrap_or_default();
    m[cmd]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default()
}

fn base(p: &str) -> String {
    PathBuf::from(p)
        .file_name()
        .unwrap()
        .to_string_lossy()
        .to_string()
}

#[tokio::test]
async fn install_continues_after_the_satellite_restarts() {
    let (e, node) = setup().await;
    let data = e.sat.path().to_path_buf();
    let mut sat = start_satellite(&data);
    let q = admin(
        &e,
        "POST",
        &format!("/admin/nodes/{node}/install"),
        json!({}),
    )
    .await;
    let id = q["command"]["command"]["id"].as_str().unwrap().to_string();
    wait_for(&e, &id, &["running"], 30).await;
    tokio::time::sleep(Duration::from_secs(2)).await;
    power_cut(&mut sat, &data);
    assert!(
        data.join("node/current.json").exists(),
        "the command is remembered across the restart"
    );

    let mut sat = start_satellite(&data);
    let v = wait_for(&e, &id, &["ok", "failed", "cancelled"], 60).await;
    assert_eq!(v["record"]["state"], "ok", "{v}");
    let msgs = v["messages"].as_array().unwrap();
    assert!(msgs.iter().any(|m| m["line"]
        .as_str()
        .unwrap_or("")
        .contains("restarted during the work")));
    assert!(
        !data.join("node/current.json").exists(),
        "nothing left to resume"
    );
    let runs = journals(&data, &id);
    assert_eq!(
        runs.len(),
        2,
        "the interrupted run and the resumed run: {runs:?}"
    );

    // "Undo the last install" undoes both runs of that command, in one go.
    let q = admin(
        &e,
        "POST",
        &format!("/admin/nodes/{node}/rollback"),
        Value::Null,
    )
    .await;
    assert_eq!(q["command"]["command"]["target_command"], json!(id));
    let rid = q["command"]["command"]["id"].as_str().unwrap().to_string();
    let v = wait_for(&e, &rid, &["ok", "failed", "cancelled"], 30).await;
    let undo = v["messages"]
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["event"]["event"] == "rollback.item")
        .unwrap()["event"]["label"]
        .as_str()
        .unwrap()
        .to_string();
    for r in &runs {
        assert!(undo.contains(&base(r)), "{undo} should list {r}");
    }
    sat.kill().unwrap();
    let _ = sat.wait();
}

#[tokio::test]
async fn cancel_while_the_satellite_is_down_undoes_every_run() {
    let (e, node) = setup().await;
    let data = e.sat.path().to_path_buf();
    let mut sat = start_satellite(&data);
    let q = admin(
        &e,
        "POST",
        &format!("/admin/nodes/{node}/install"),
        json!({}),
    )
    .await;
    let id = q["command"]["command"]["id"].as_str().unwrap().to_string();
    wait_for(&e, &id, &["running"], 30).await;
    tokio::time::sleep(Duration::from_secs(2)).await;
    power_cut(&mut sat, &data);
    admin(
        &e,
        "POST",
        &format!("/admin/commands/{id}/cancel"),
        Value::Null,
    )
    .await;

    let mut sat = start_satellite(&data);
    let v = wait_for(&e, &id, &["ok", "failed", "cancelled"], 60).await;
    assert_eq!(
        (
            v["record"]["state"].as_str(),
            v["record"]["rollback_result"].as_str()
        ),
        (Some("cancelled"), Some("ok")),
        "{v}"
    );
    let runs = journals(&data, &id);
    assert_eq!(runs.len(), 1, "only the interrupted run existed: {runs:?}");
    let undo = v["messages"]
        .as_array()
        .unwrap()
        .iter()
        .rev()
        .find(|m| m["event"]["event"] == "rollback.item")
        .unwrap()["event"]["label"]
        .as_str()
        .unwrap()
        .to_string();
    assert!(undo.contains(&base(&runs[0])), "{undo}");
    sat.kill().unwrap();
    let _ = sat.wait();
}
