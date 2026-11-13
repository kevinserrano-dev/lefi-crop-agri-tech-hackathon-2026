//! Lefi Brain asks this service to install, power and remove the simulated robot (ADR-090). The
//! real service on loopback; the installer and `lefi` are FAKES that only record what they were
//! asked and answer like the real ones (`--events ndjson`, `lefi robot status --json`).

use std::net::IpAddr;
use std::path::Path;
use std::sync::atomic::{AtomicU16, Ordering};
use std::time::Duration;

use lefi_helperd::ca::{test_root, RootCa};
use lefi_helperd::main_node::{self, MainConfig, Shared};
use serde_json::{json, Value};

static NEXT_PORT: AtomicU16 = AtomicU16::new(31790);

const FAKE_INSTALLER: &str = r#"#!/bin/sh
# FAKE installer: records its arguments, answers with installer events, marks the robot installed.
echo "$*" >>"$LEFI_STATE_DIR/installer.calls"
case "$*" in
  *--remove-role\ robot*) rm -f "$LEFI_STATE_DIR/robot.installed" ;;
  *) [ -n "$FAIL" ] && { echo '{"event":"step.failed","code":"ROBOT_SETUP","message":"fake failure"}'; echo '{"event":"plan.done","result":"failed"}'; exit 1; }
     echo '{"event":"plan.started","steps_total":3}'
     echo '{"event":"step.started","step":"robot.install","steps_done":2,"steps_total":3,"title":"Simulated robot"}'
     echo '{"event":"step.log","level":"info","message":"Preparing Python for the 2D robot"}'
     touch "$LEFI_STATE_DIR/robot.installed" ;;
esac
echo '{"event":"plan.done","result":"ok"}'
"#;

const FAKE_LEFI: &str = r#"#!/bin/sh
# FAKE lefi: only `lefi robot …`, from marker files.
s="$LEFI_STATE_DIR"
case "$1 $2" in
  "robot status")
    i=false; r=false
    [ -f "$s/robot.installed" ] && i=true
    [ -f "$s/robot.running" ] && r=true
    echo "{\"installed\":$i,\"running\":$r,\"answering\":$r,\"backend\":\"lite\",\"port\":8765,\"ai_here\":false}" ;;
  "robot start") [ -f "$s/robot.installed" ] || exit 3; touch "$s/robot.running" ;;
  "robot stop") rm -f "$s/robot.running" ;;
  *) exit 2 ;;
esac
"#;

struct Host {
    base: String,
    state: tempfile::TempDir,
    _main: tempfile::TempDir,
    _payload: tempfile::TempDir,
}

fn write_exec(path: &Path, body: &str) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, body).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
}

async fn host(env_text: &str, fail: bool) -> Host {
    lefi_helperd::init_crypto();
    let main_dir = tempfile::tempdir().unwrap();
    let state = tempfile::tempdir().unwrap();
    let payload = tempfile::tempdir().unwrap();
    write_exec(&payload.path().join("scripts/install.sh"), FAKE_INSTALLER);
    write_exec(&payload.path().join("bin/lefi"), FAKE_LEFI);
    let env_file = state.path().join("lefi.env");
    std::fs::write(&env_file, env_text).unwrap();
    let mut cli_env = vec![
        (
            "LEFI_STATE_DIR".to_string(),
            state.path().display().to_string(),
        ),
        ("ENV_FILE".to_string(), env_file.display().to_string()),
    ];
    if fail {
        cli_env.push(("FAIL".into(), "1".into()));
    }
    let (cpem, kpem) = test_root();
    let p = NEXT_PORT.fetch_add(3, Ordering::SeqCst);
    let cfg = MainConfig {
        publish_name: false,
        auto_pair_desktops: false,
        auto_pair_local: false,
        data_dir: main_dir.path().to_path_buf(),
        lan_ips: vec![IpAddr::from([192, 168, 8, 10])],
        bind: IpAddr::from([127, 0, 0, 1]),
        http_port: p,
        tls_port: p + 1,
        admin_port: p + 2,
        satellite_bin: None,
        payload_root: Some(payload.path().to_path_buf()),
        ai_port: 9,
        cli_env,
    };
    let shared = Shared::new(
        cfg,
        RootCa::from_pem(&cpem, &kpem).unwrap(),
        "TEST".into(),
        3,
    )
    .unwrap();
    tokio::spawn(main_node::run(shared.clone()));
    let base = format!("http://127.0.0.1:{}", p + 2);
    for _ in 0..50 {
        if state.path().join("helper/link.json").is_file()
            && reqwest::get(format!("{base}/brain/robot/places"))
                .await
                .is_ok()
        {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    Host {
        base,
        state,
        _main: main_dir,
        _payload: payload,
    }
}

fn link(h: &Host) -> (String, String) {
    let v: Value = serde_json::from_str(
        &std::fs::read_to_string(h.state.path().join("helper/link.json")).unwrap(),
    )
    .unwrap();
    (
        v["url"].as_str().unwrap().into(),
        v["token"].as_str().unwrap().into(),
    )
}

async fn call(
    h: &Host,
    method: &str,
    path: &str,
    body: Option<Value>,
    token: &str,
) -> (u16, Value) {
    let c = reqwest::Client::new();
    let url = format!("{}{}", h.base, path);
    let req = if method == "GET" {
        c.get(url)
    } else {
        c.post(url).json(&body.unwrap_or(json!({})))
    };
    let res = req.bearer_auth(token).send().await.unwrap();
    let status = res.status().as_u16();
    (status, res.json().await.unwrap_or(Value::Null))
}

async fn wait_job(h: &Host, token: &str, id: &str) -> Value {
    for _ in 0..100 {
        let (_, j) = call(h, "GET", &format!("/brain/robot/jobs/{id}"), None, token).await;
        if j["state"] != "running" {
            return j;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    panic!("the robot job never ended");
}

#[tokio::test]
async fn lefi_brain_installs_powers_and_removes_the_robot_on_the_main_pc() {
    let h = host("OLLAMA_BASE_URL=http://192.168.8.20:11434\n", false).await;
    let (url, token) = link(&h);
    assert_eq!(url, h.base, "the link names this service's console address");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(h.state.path().join("helper/link.json"))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
    }
    // Only Lefi Brain's token opens these routes.
    assert_eq!(
        call(&h, "GET", "/brain/robot/places", None, "wrong")
            .await
            .0,
        401
    );

    let (st, places) = call(&h, "GET", "/brain/robot/places", None, &token).await;
    assert_eq!(st, 200);
    assert_eq!(places["places"][0]["node_id"], "main");
    assert_eq!(places["places"][0]["eligible"], true);

    let (st, err) = call(
        &h,
        "POST",
        "/brain/robot/install",
        Some(json!({"node_id": "main", "backend": "unity"})),
        &token,
    )
    .await;
    assert_eq!(
        (st, err["error"]["code"].as_str()),
        (400, Some("BAD_REQUEST"))
    );

    let (st, job) = call(
        &h,
        "POST",
        "/brain/robot/install",
        Some(json!({"node_id": "main", "backend": "lite"})),
        &token,
    )
    .await;
    assert_eq!(st, 202, "{job}");
    let done = wait_job(&h, &token, job["id"].as_str().unwrap()).await;
    assert_eq!(done["state"], "done");
    assert_eq!(
        (done["steps_done"].as_u64(), done["steps_total"].as_u64()),
        (Some(3), Some(3))
    );
    assert_eq!(done["message"], "Preparing Python for the 2D robot");
    let calls = std::fs::read_to_string(h.state.path().join("installer.calls")).unwrap();
    assert!(
        calls.contains("--roles robot --answers") && calls.contains("--events ndjson"),
        "{calls}"
    );
    let answers = std::fs::read_to_string(h._main.path().join("fleet/robot-answers.env")).unwrap();
    assert!(answers.contains("ROBOT_BACKEND=lite"));

    let (st, on) = call(
        &h,
        "POST",
        "/brain/robot/power",
        Some(json!({"node_id": "main", "on": true})),
        &token,
    )
    .await;
    assert_eq!((st, on["robot"]["running"].as_bool()), (200, Some(true)));
    let (_, status) = call(&h, "GET", "/brain/robot/status", None, &token).await;
    assert_eq!(
        (
            status["robot"]["installed"].as_bool(),
            status["job"]["kind"].as_str()
        ),
        (Some(true), Some("install"))
    );
    let (_, off) = call(
        &h,
        "POST",
        "/brain/robot/power",
        Some(json!({"node_id": "main", "on": false})),
        &token,
    )
    .await;
    assert_eq!(off["robot"]["running"], false);

    let (st, job) = call(
        &h,
        "POST",
        "/brain/robot/remove",
        Some(json!({"node_id": "main"})),
        &token,
    )
    .await;
    assert_eq!(st, 202);
    assert_eq!(
        wait_job(&h, &token, job["id"].as_str().unwrap()).await["state"],
        "done"
    );
    let (_, status) = call(&h, "GET", "/brain/robot/status", None, &token).await;
    assert_eq!(status["robot"]["installed"], false);
}

#[tokio::test]
async fn the_robot_is_refused_on_the_pc_whose_ai_lefi_brain_uses() {
    let h = host("OLLAMA_BASE_URL=http://127.0.0.1:11434\n", false).await;
    let (_, token) = link(&h);
    let (_, places) = call(&h, "GET", "/brain/robot/places", None, &token).await;
    assert_eq!(
        (
            places["places"][0]["eligible"].as_bool(),
            places["places"][0]["reason"].as_str()
        ),
        (Some(false), Some("ai_node"))
    );
    let (st, err) = call(
        &h,
        "POST",
        "/brain/robot/install",
        Some(json!({"node_id": "main", "backend": "lite"})),
        &token,
    )
    .await;
    assert_eq!(
        (st, err["error"]["code"].as_str()),
        (409, Some("ROBOT_ON_AI_NODE"))
    );
    assert!(
        !h.state.path().join("installer.calls").exists(),
        "the installer never ran"
    );
    let (st, _) = call(
        &h,
        "POST",
        "/brain/robot/install",
        Some(json!({"node_id": "pc-unknown", "backend": "lite"})),
        &token,
    )
    .await;
    assert_eq!(st, 404);
}

#[tokio::test]
async fn a_failed_install_keeps_the_installers_reason() {
    let h = host("", true).await;
    let (_, token) = link(&h);
    let (_, job) = call(
        &h,
        "POST",
        "/brain/robot/install",
        Some(json!({"node_id": "main", "backend": "genesis"})),
        &token,
    )
    .await;
    let done = wait_job(&h, &token, job["id"].as_str().unwrap()).await;
    assert_eq!(
        (
            done["state"].as_str(),
            done["error_code"].as_str(),
            done["message"].as_str()
        ),
        (Some("failed"), Some("ROBOT_SETUP"), Some("fake failure"))
    );
    // Powering a robot that is not installed is refused with the CLI's failure.
    let (st, err) = call(
        &h,
        "POST",
        "/brain/robot/power",
        Some(json!({"node_id": "main", "on": true})),
        &token,
    )
    .await;
    assert_eq!(
        (st, err["error"]["code"].as_str()),
        (409, Some("ROBOT_POWER"))
    );
}
