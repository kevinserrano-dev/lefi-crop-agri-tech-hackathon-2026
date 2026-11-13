//! Remote install over real TLS on loopback: the main PC queues a command, the satellite loop
//! receives it in a heartbeat, downloads the payload, runs the installer and reports back.

use std::net::IpAddr;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::Arc;
use std::time::Duration;

use lefi_helperd::ca::{test_root, RootCa};
use lefi_helperd::executor::ExecOptions;
use lefi_helperd::main_node::{self, MainConfig, Shared};
use lefi_helperd::satellite;
use serde_json::{json, Value};

static NEXT_PORT: AtomicU16 = AtomicU16::new(29790);

struct Fleet {
    shared: Arc<Shared>,
    admin: u16,
    sat: tempfile::TempDir,
    _main: tempfile::TempDir,
}

async fn fleet(payload_root: PathBuf, opts: ExecOptions) -> (Fleet, String) {
    fleet_with(payload_root, opts, 9, vec![]).await
}

async fn fleet_with(
    payload_root: PathBuf,
    opts: ExecOptions,
    ai_port: u16,
    cli_env: Vec<(String, String)>,
) -> (Fleet, String) {
    fleet_full(payload_root, opts, ai_port, cli_env, false, None).await
}

async fn fleet_full(
    payload_root: PathBuf,
    opts: ExecOptions,
    ai_port: u16,
    cli_env: Vec<(String, String)>,
    auto_pair_desktops: bool,
    sat_data: Option<PathBuf>,
) -> (Fleet, String) {
    lefi_helperd::init_crypto();
    let main_dir = tempfile::tempdir().unwrap();
    let sat = tempfile::tempdir().unwrap();
    let (cpem, kpem) = test_root();
    let p = NEXT_PORT.fetch_add(3, Ordering::SeqCst);
    let cfg = MainConfig {
        publish_name: false,
        auto_pair_desktops,
        auto_pair_local: false,
        data_dir: main_dir.path().to_path_buf(),
        lan_ips: vec![IpAddr::from([127, 0, 0, 1])],
        bind: IpAddr::from([127, 0, 0, 1]),
        http_port: p,
        tls_port: p + 1,
        admin_port: p + 2,
        satellite_bin: None,
        payload_root: Some(payload_root),
        ai_port,
        cli_env,
    };
    let shared = Shared::new(
        cfg,
        RootCa::from_pem(&cpem, &kpem).unwrap(),
        "TEST".into(),
        3,
    )
    .unwrap();
    assert!(shared.payload.is_some(), "payload built");
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
    let f = Fleet {
        shared: shared.clone(),
        admin: p + 2,
        sat,
        _main: main_dir,
    };
    let (_, code) = admin(&f, "POST", "/admin/codes", json!({})).await;
    let data = sat_data.unwrap_or_else(|| f.sat.path().to_path_buf());
    let cfg = satellite::join(
        &data,
        "127.0.0.1",
        code["code"].as_str().unwrap(),
        &shared.ca.fingerprint,
        p,
        p + 1,
    )
    .await
    .unwrap();
    tokio::spawn(async move {
        let _ = satellite::run_with(&data, opts, 1).await;
    });
    (f, cfg.node_id)
}

async fn admin(f: &Fleet, method: &str, path: &str, body: Value) -> (u16, Value) {
    let c = reqwest::Client::new();
    let url = format!("http://127.0.0.1:{}{path}", f.admin);
    let r = if method == "GET" {
        c.get(url)
    } else {
        c.post(url).json(&body)
    };
    let resp = r.bearer_auth(&f.shared.admin_token).send().await.unwrap();
    (
        resp.status().as_u16(),
        resp.json().await.unwrap_or(Value::Null),
    )
}

async fn wait_state(f: &Fleet, cmd: &str, want: &[&str], secs: u64) -> Value {
    for _ in 0..secs * 4 {
        let (_, v) = admin(f, "GET", &format!("/admin/commands/{cmd}"), Value::Null).await;
        if want.contains(&v["record"]["state"].as_str().unwrap_or("")) {
            return v;
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    panic!("command {cmd} never reached {want:?}");
}

fn fake_payload() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fake-installer")
}

#[tokio::test]
async fn install_cancel_and_rollback_on_a_satellite() {
    // 3 s per fake step: time for the cancel to travel console → main → satellite → installer.
    let opts = ExecOptions {
        env: vec![("FAKE_STEP_SECS".into(), "3".into())],
        ..sandbox()
    };
    let (f, node) = fleet(fake_payload(), opts).await;
    // Nothing assigned yet → nothing to install.
    let (st, e) = admin(
        &f,
        "POST",
        &format!("/admin/nodes/{node}/install"),
        json!({}),
    )
    .await;
    assert_eq!(
        (st, e["error"]["code"].as_str()),
        (409, Some("NOTHING_TO_INSTALL"))
    );
    admin(
        &f,
        "POST",
        &format!("/admin/nodes/{node}/assign"),
        json!({"roles":["ai","desktop"]}),
    )
    .await;

    // 1) A full install: steps, human output and the result come back to the main PC.
    let (st, q) = admin(
        &f,
        "POST",
        &format!("/admin/nodes/{node}/install"),
        json!({}),
    )
    .await;
    assert_eq!(st, 200, "{q}");
    assert_eq!(
        q["command"]["command"]["roles"],
        json!(["ai", "desktop"]),
        "both assigned components are installed"
    );
    let id = q["command"]["command"]["id"].as_str().unwrap().to_string();
    let (st, _) = admin(
        &f,
        "POST",
        &format!("/admin/nodes/{node}/install"),
        json!({}),
    )
    .await;
    assert_eq!(st, 409, "one command at a time");
    let v = wait_state(&f, &id, &["ok", "failed", "cancelled"], 60).await;
    assert_eq!(v["record"]["state"], "ok", "{v}");
    assert_eq!(
        (
            v["record"]["steps_done"].as_u64(),
            v["record"]["steps_total"].as_u64()
        ),
        (Some(3), Some(3))
    );
    let msgs = v["messages"].as_array().unwrap();
    assert!(msgs
        .iter()
        .any(|m| m["kind"] == "event" && m["event"]["event"] == "plan.done"));
    assert!(msgs
        .iter()
        .any(|m| m["kind"] == "output" && m["line"].as_str().unwrap_or("").contains("step b")));
    // The PC's own page shows the result.
    let me: Value = reqwest::get(format!("http://127.0.0.1:{}/setup/me", f.admin - 2))
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(me["command"]["state"], "ok");

    // The AI was installed for real (state ok): the main PC tries to connect its Brain to it.
    // This fake payload has no `lefi` command, so the attempt must say so instead of pretending.
    let mut link = Value::Null;
    for _ in 0..40 {
        let (_, st) = admin(&f, "GET", "/admin/status", Value::Null).await;
        link = st["nodes"][0]["ai_link"].clone();
        if link["state"] == "failed" || link["state"] == "ok" {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    assert_eq!(
        (link["state"].as_str(), link["code"].as_str()),
        (Some("failed"), Some("CLI_MISSING")),
        "{link}"
    );

    // 2) Cancel while it runs: the satellite relays it to the installer, which rolls back.
    let (_, q) = admin(
        &f,
        "POST",
        &format!("/admin/nodes/{node}/install"),
        json!({}),
    )
    .await;
    let id2 = q["command"]["command"]["id"].as_str().unwrap().to_string();
    wait_state(&f, &id2, &["running"], 20).await;
    assert_eq!(
        admin(
            &f,
            "POST",
            &format!("/admin/commands/{id2}/cancel"),
            Value::Null
        )
        .await
        .0,
        200
    );
    let v = wait_state(&f, &id2, &["ok", "failed", "cancelled"], 30).await;
    assert_eq!(v["record"]["state"], "cancelled", "{v}");
    assert_eq!(v["record"]["rollback_result"], "ok");

    // 3) Undo the last install run on that PC.
    let (_, q) = admin(
        &f,
        "POST",
        &format!("/admin/nodes/{node}/rollback"),
        Value::Null,
    )
    .await;
    let id3 = q["command"]["command"]["id"].as_str().unwrap().to_string();
    let v = wait_state(&f, &id3, &["ok", "failed", "cancelled"], 30).await;
    assert_eq!(
        (
            v["record"]["state"].as_str(),
            v["record"]["rollback_result"].as_str()
        ),
        (Some("ok"), Some("ok"))
    );

    // A removed PC gets no more commands.
    admin(
        &f,
        "POST",
        &format!("/admin/nodes/{node}/revoke"),
        Value::Null,
    )
    .await;
    let (st, _) = admin(
        &f,
        "POST",
        &format!("/admin/nodes/{node}/install"),
        json!({}),
    )
    .await;
    assert_eq!(st, 401);
}

/// The real `scripts/install.sh` of this checkout, sent to a satellite and run with --dry-run.
/// The installer's state folder and config file point to a temporary folder. Run explicitly:
/// `cargo test -- --ignored` (macOS or Linux; reads this machine's hardware, changes nothing).
#[tokio::test]
#[ignore]
async fn real_installer_dry_run_on_a_satellite() {
    let repo = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()
        .unwrap();
    let state = tempfile::tempdir().unwrap();
    let opts = ExecOptions {
        env: vec![
            (
                "LEFI_STATE_DIR".into(),
                state.path().join("state").display().to_string(),
            ),
            (
                "ENV_FILE".into(),
                state.path().join("lefi.env").display().to_string(),
            ),
        ],
        ..sandbox()
    };
    let (f, node) = fleet(repo, opts).await;
    admin(
        &f,
        "POST",
        &format!("/admin/nodes/{node}/assign"),
        json!({"roles":["ai"]}),
    )
    .await;
    let (st, q) = admin(
        &f,
        "POST",
        &format!("/admin/nodes/{node}/install"),
        json!({"dry_run": true}),
    )
    .await;
    assert_eq!(st, 200, "{q}");
    let id = q["command"]["command"]["id"].as_str().unwrap().to_string();
    let v = wait_state(&f, &id, &["ok", "failed", "cancelled"], 120).await;
    let msgs = v["messages"].as_array().unwrap();
    let started = msgs
        .iter()
        .find(|m| m["event"]["event"] == "plan.started")
        .expect("plan.started");
    assert_eq!(started["event"]["dry_run"], true);
    assert_eq!(started["event"]["roles"], "ai");
    assert_eq!(
        v["record"]["state"],
        "ok",
        "{}",
        serde_json::to_string_pretty(&v).unwrap()
    );
    assert!(
        !state.path().join("lefi.env").exists(),
        "a dry run writes no configuration"
    );
}

/// A FAKE Ollama (axum, random port) answering what `lefi ai use` checks; `share` = % on GPU.
async fn fake_ollama(share: u64) -> u16 {
    use axum::routing::{get, post};
    let size: u64 = 8_000_000_000;
    let app = axum::Router::new()
        .route("/api/version", get(|| async { axum::Json(json!({"version":"0.0.0-fake"})) }))
        .route("/api/tags", get(|| async { axum::Json(json!({"models":[{"name":"gemma4:12b"}]})) }))
        .route("/api/generate", post(|| async { axum::Json(json!({"response":"OK","done":true})) }))
        .route(
            "/api/ps",
            // Field order as real Ollama writes it (the installer reads it with text tools).
            get(move || async move {
                (
                    [(axum::http::header::CONTENT_TYPE, "application/json")],
                    format!(
                        r#"{{"models":[{{"name":"gemma4:12b","model":"gemma4:12b","size":{size},"size_vram":{},"context_length":4096}}]}}"#,
                        size * share / 100
                    ),
                )
            }),
        );
    let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = l.local_addr().unwrap().port();
    tokio::spawn(async move { axum::serve(l, app).await.unwrap() });
    port
}

/// "Connect the Brain to this AI" with the real `bin/lefi` of this checkout against a fake
/// Ollama; the Brain configuration is a temporary file (never this PC's real `.env`).
#[tokio::test]
async fn brain_is_connected_to_a_satellite_ai_only_when_it_passes_the_check() {
    let repo = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()
        .unwrap();
    for (share, want_state, want_code, want_env) in [
        (100, "ok", "OK", true),
        (50, "failed", "AI_NOT_VIABLE", false),
    ] {
        let cfgdir = tempfile::tempdir().unwrap();
        let env_file = cfgdir.path().join("lefi.env");
        std::fs::write(&env_file, "LEFI_ROLES=core\n").unwrap();
        let cli_env = vec![
            ("ENV_FILE".to_string(), env_file.display().to_string()),
            (
                "LEFI_STATE_DIR".to_string(),
                cfgdir.path().join("state").display().to_string(),
            ),
            ("LEFI_SERVICE_MODE".to_string(), "user".to_string()),
            ("HOME".to_string(), cfgdir.path().display().to_string()),
        ];
        let port = fake_ollama(share).await;
        let (f, node) = fleet_with(repo.clone(), sandbox(), port, cli_env).await;
        admin(
            &f,
            "POST",
            &format!("/admin/nodes/{node}/assign"),
            json!({"roles":["ai"]}),
        )
        .await;
        assert_eq!(
            admin(
                &f,
                "POST",
                &format!("/admin/nodes/{node}/link-ai"),
                Value::Null
            )
            .await
            .0,
            200
        );
        let mut link = Value::Null;
        for _ in 0..100 {
            let (_, st) = admin(&f, "GET", "/admin/status", Value::Null).await;
            link = st["nodes"][0]["ai_link"].clone();
            if link["state"] != "linking" {
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        assert_eq!(
            (link["state"].as_str(), link["code"].as_str()),
            (Some(want_state), Some(want_code)),
            "{link}"
        );
        let env = std::fs::read_to_string(&env_file).unwrap();
        assert_eq!(
            env.contains(&format!("OLLAMA_BASE_URL=http://127.0.0.1:{port}")),
            want_env,
            "{env}"
        );
    }
}

/// Probes point at a closed port and an empty home: tests never touch the real AI of this PC.
fn sandbox() -> ExecOptions {
    ExecOptions {
        ai_port: Some(1),
        home: Some(std::env::temp_dir().join("lefi-helperd-test-no-home")),
        ..Default::default()
    }
}

/// A FAKE Ollama: never the real one. 64 tokens in 2 s = 32 tokens per second.
async fn fake_ai() -> u16 {
    use axum::routing::{get, post};
    let gb8 = 8_589_934_592u64;
    let app = axum::Router::new()
        .route("/api/version", get(|| async { axum::Json(json!({"version":"0.0.0-fake"})) }))
        .route("/api/tags", get(move || async move {
            axum::Json(json!({"models":[{"name":"fake:model","size":gb8},{"name":"gemma4:12b","size":gb8}]}))
        }))
        .route("/api/ps", get(move || async move {
            axum::Json(json!({"models":[{"name":"gemma4:12b","size":gb8,"size_vram":gb8,"context_length":4096}]}))
        }))
        .route("/api/generate", post(|| async {
            axum::Json(json!({"response":"x","eval_count":64,"eval_duration":2_000_000_000u64,"load_duration":5_000_000u64,"prompt_eval_duration":7_000_000u64,"total_duration":2_012_000_000u64}))
        }));
    let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = l.local_addr().unwrap().port();
    tokio::spawn(async move { axum::serve(l, app).await });
    port
}

/// The fake installer plus the supported-models table.
fn payload_with_models() -> tempfile::TempDir {
    let d = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(d.path().join("config")).unwrap();
    std::fs::create_dir_all(d.path().join("scripts")).unwrap();
    let inst = d.path().join("scripts/install.sh");
    std::fs::copy(fake_payload().join("scripts/install.sh"), &inst).unwrap();
    std::fs::write(
        d.path().join("config/supported-models.tsv"),
        "# tag\tlabel\ngemma4:12b\tFake row\n",
    )
    .unwrap();
    d
}

async fn run_cmd(f: &Fleet, node: &str, body: Value) -> String {
    let (st, q) = admin(f, "POST", &format!("/admin/nodes/{node}/run"), body).await;
    assert_eq!(st, 200, "{q}");
    q["command"]["command"]["id"].as_str().unwrap().to_string()
}

#[tokio::test]
async fn the_main_pc_sees_the_node_measures_its_ai_and_removes_a_component() {
    let port = fake_ai().await;
    let opts = ExecOptions {
        ai_port: Some(port),
        ..sandbox()
    };
    let payload = payload_with_models();
    let (f, node) = fleet(payload.path().to_path_buf(), opts).await;

    // The AI on that PC, as the console and that PC's own page see it.
    let mut ai = Value::Null;
    for _ in 0..40 {
        let (_, st) = admin(&f, "GET", "/admin/status", Value::Null).await;
        ai = st["nodes"][0]["last_heartbeat"]["report"]["ai"].clone();
        if ai.is_object() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    assert_eq!(ai["version"], "0.0.0-fake", "{ai}");
    assert_eq!(ai["loaded"][0]["gpu_pct"], 100);
    let base = f.shared.join_url();
    let me: Value = reqwest::get(format!("{base}/me"))
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(me["joined"], true);
    assert_eq!(me["report"]["ai"]["models"][1]["name"], "gemma4:12b");
    assert!(me["ai_endpoint"].as_str().unwrap().ends_with(":9"));

    // A speed test: a real generation against the fake AI, only a supported model.
    let id = run_cmd(&f, &node, json!({"kind":"ai_bench"})).await;
    wait_state(&f, &id, &["ok"], 20).await;
    let (_, st) = admin(&f, "GET", "/admin/status", Value::Null).await;
    let b = &st["nodes"][0]["ai_bench"];
    assert_eq!(
        (b["tokens_per_s"].as_f64(), b["model"].as_str()),
        (Some(32.0), Some("gemma4:12b")),
        "{b}"
    );
    assert_eq!(b["gpu_pct"], 100);

    // That PC can read its own log; nobody reads a command that does not exist.
    let log = reqwest::get(format!("{base}/me/log/{id}")).await.unwrap();
    assert_eq!(log.status(), 200);
    let missing = reqwest::get(format!("{base}/me/log/cmd-00")).await.unwrap();
    assert_eq!(missing.status(), 404);

    // Only the allowlist: anything else stops at the main PC.
    let (code, _) = admin(
        &f,
        "POST",
        &format!("/admin/nodes/{node}/run"),
        json!({"kind":"shell"}),
    )
    .await;
    assert_eq!(code, 400);
    let (code, _) = admin(
        &f,
        "POST",
        &format!("/admin/nodes/{node}/run"),
        json!({"kind":"service","action":"rm -rf"}),
    )
    .await;
    assert_eq!(code, 400);

    // Remove: the component is no longer assigned once that PC confirms.
    admin(
        &f,
        "POST",
        &format!("/admin/nodes/{node}/assign"),
        json!({"roles":["ai"]}),
    )
    .await;
    let id = run_cmd(&f, &node, json!({"kind":"remove","role":"ai"})).await;
    wait_state(&f, &id, &["ok"], 20).await;
    let (_, st) = admin(&f, "GET", "/admin/status", Value::Null).await;
    assert_eq!(st["nodes"][0]["assigned"], json!([]));
}

#[tokio::test]
async fn the_brain_uses_an_ai_according_to_its_own_configuration() {
    let cfgdir = tempfile::tempdir().unwrap();
    let env_file = cfgdir.path().join("lefi.env");
    std::fs::write(&env_file, "OLLAMA_BASE_URL=http://127.0.0.1:11434\n").unwrap();
    let cli_env = vec![("ENV_FILE".to_string(), env_file.display().to_string())];
    let (f, _node) = fleet_with(fake_payload(), sandbox(), 11434, cli_env).await;
    let (_, st) = admin(&f, "GET", "/admin/status", Value::Null).await;
    assert_eq!(
        st["nodes"][0]["used_by_brain"], true,
        "no connection attempt was ever made"
    );
    std::fs::write(&env_file, "OLLAMA_BASE_URL=http://192.0.2.1:11434\n").unwrap();
    let (_, st) = admin(&f, "GET", "/admin/status", Value::Null).await;
    assert_eq!(st["nodes"][0]["used_by_brain"], false);
}

#[tokio::test]
async fn a_failed_install_sends_the_end_of_its_log_to_the_main_pc() {
    let logdir = tempfile::tempdir().unwrap();
    let log = logdir.path().join("install.log");
    let opts = ExecOptions {
        env: vec![("FAKE_FAIL_LOG".into(), log.display().to_string())],
        ..sandbox()
    };
    let (f, node) = fleet(fake_payload(), opts).await;
    admin(
        &f,
        "POST",
        &format!("/admin/nodes/{node}/assign"),
        json!({"roles":["ai"]}),
    )
    .await;
    let (st, q) = admin(
        &f,
        "POST",
        &format!("/admin/nodes/{node}/install"),
        json!({"roles":["ai"]}),
    )
    .await;
    assert_eq!(st, 200, "{q}");
    let id = q["command"]["command"]["id"].as_str().unwrap();
    let v = wait_state(&f, id, &["failed"], 20).await;
    let text = v["messages"].to_string();
    assert!(
        text.contains("Bootstrap failed: 5"),
        "the tool's exact error reaches the console: {text}"
    );
}

/// Not a test: serves a real main PC + satellite on loopback, with a FAKE AI and a FAKE installer,
/// to look at the page in a browser. `cargo test --test remote_install preview_server -- --ignored`
#[tokio::test]
#[ignore]
async fn preview_server() {
    let port = fake_ai().await;
    let logdir = tempfile::tempdir().unwrap();
    let home = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(home.path().join("Library/LaunchAgents")).unwrap();
    std::fs::write(
        home.path()
            .join("Library/LaunchAgents/com.lefi-crop.ollama.plist"),
        "x",
    )
    .unwrap();
    std::fs::create_dir_all(home.path().join(".lefi-crop/services")).unwrap();
    std::fs::write(
        home.path().join(".lefi-crop/services/ollama.svc"),
        "ENVS=OLLAMA_HOST=0.0.0.0:11434\n",
    )
    .unwrap();
    let opts = ExecOptions {
        env: vec![(
            "FAKE_FAIL_LOG".into(),
            logdir.path().join("install.log").display().to_string(),
        )],
        ai_port: Some(port),
        home: Some(home.path().to_path_buf()),
        publish_name: false,
        ..Default::default()
    };
    let payload = payload_with_models();
    let (f, node) = fleet_with(payload.path().to_path_buf(), opts, port, vec![]).await;
    admin(
        &f,
        "POST",
        &format!("/admin/nodes/{node}/assign"),
        json!({"roles":["ai"]}),
    )
    .await;
    tokio::time::sleep(Duration::from_secs(3)).await;
    let id = run_cmd(&f, &node, json!({"kind":"ai_bench"})).await;
    wait_state(&f, &id, &["ok"], 20).await;
    let (_, q) = admin(
        &f,
        "POST",
        &format!("/admin/nodes/{node}/install"),
        json!({"roles":["ai"]}),
    )
    .await;
    let id = q["command"]["command"]["id"].as_str().unwrap().to_string();
    wait_state(&f, &id, &["failed"], 20).await;
    println!("READY {}", f.shared.join_url());
    let (_, st) = admin(&f, "GET", "/admin/status", Value::Null).await;
    std::fs::write(std::env::var("PREVIEW_STATUS").unwrap(), st.to_string()).unwrap();
    tokio::time::sleep(Duration::from_secs(600)).await;
}

/// ADR-050: a joined PC reports a Lefi Desktop that is not paired; the main PC asks its (FAKE) Lefi
/// Brain for a one-time code and sends the offer in a heartbeat; the PC leaves it, mode 600, in
/// Lefi Desktop's data folder. Everything in temporary folders; `lefi` is a fake script.
#[tokio::test]
async fn a_joined_pc_gets_a_pairing_offer_for_its_lefi_desktop_by_itself() {
    use std::os::unix::fs::PermissionsExt;
    let root = tempfile::tempdir().unwrap();
    let scripts = root.path().join("scripts");
    std::fs::create_dir_all(&scripts).unwrap();
    std::fs::copy(
        fake_payload().join("scripts/install.sh"),
        scripts.join("install.sh"),
    )
    .unwrap();
    std::fs::create_dir_all(root.path().join("bin")).unwrap();
    let fp = "ab".repeat(32);
    let lefi = root.path().join("bin/lefi");
    std::fs::write(
        &lefi,
        format!(
            "#!/bin/sh\n# FAKE lefi for tests\ncase \"$1 $2\" in\n  'pair ca') echo '{{\"ready\":true,\"two_level\":true}}' ;;\n  'pair new') echo '{{\"code\":\"ABCD-EFGH-JKMN\",\"expires_at\":\"x\",\"gateway_ca_fingerprint\":\"{fp}\"}}' ;;\n  *) exit 1 ;;\nesac\n"
        ),
    )
    .unwrap();
    std::fs::set_permissions(&lefi, std::fs::Permissions::from_mode(0o755)).unwrap();
    let cfgdir = tempfile::tempdir().unwrap();
    let env_file = cfgdir.path().join("lefi.env");
    std::fs::write(
        &env_file,
        "LEFI_ROLES=core,admin\nLEFI_ADMIN_URL=https://127.0.0.1:8443\nLEFI_DEVICE_CERT_REQUIRED=true\n",
    )
    .unwrap();
    let cli_env = vec![("ENV_FILE".to_string(), env_file.display().to_string())];

    // The joined PC: a temporary home with Lefi Desktop installed, not paired.
    let home = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(home.path().join("Applications/Lefi Crop.app/Contents")).unwrap();
    let opts = ExecOptions {
        ai_port: Some(1),
        home: Some(home.path().to_path_buf()),
        ..Default::default()
    };
    let (_f, _node) = fleet_full(root.path().to_path_buf(), opts, 9, cli_env, true, None).await;

    let offer_path = lefi_helperd::report::desktop_data_dir(home.path()).join("pairing-offer.json");
    for _ in 0..80 {
        if offer_path.is_file() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    let offer: Value =
        serde_json::from_slice(&std::fs::read(&offer_path).expect("offer left")).unwrap();
    assert_eq!(offer["url"], "https://lefi-main.local:8443");
    assert_eq!(offer["code"], "ABCD-EFGH-JKMN");
    assert_eq!(offer["gateway_ca_fingerprint"], fp);
    // ADR-055: the main PC's address as this PC knows it, for when the name does not resolve.
    assert_eq!(offer["alternates"], json!(["https://127.0.0.1:8443"]));
    let mode = std::fs::metadata(&offer_path).unwrap().permissions().mode();
    assert_eq!(mode & 0o777, 0o600);
}

/// ADR-054: erasing a joined PC. Its (FAKE) installer runs `--uninstall-everything`, then the
/// service deletes Lefi Desktop's and the Helper's traces and its own folder in a TEMPORARY home,
/// and stops; the main PC marks it removed. Nothing of this Mac (home, keychain, launchd) is used.
#[tokio::test]
async fn erasing_a_pc_leaves_nothing_of_lefi_crop_in_its_home() {
    let home = tempfile::tempdir().unwrap();
    let h = home.path().to_path_buf();
    let data = h.join(".lefi-helper");
    let desktop = lefi_helperd::report::desktop_data_dir(&h);
    std::fs::create_dir_all(&desktop).unwrap();
    std::fs::write(desktop.join("pairing.json"), b"{}").unwrap();
    let agents = h.join("Library/LaunchAgents");
    std::fs::create_dir_all(&agents).unwrap();
    std::fs::write(agents.join("com.lefi-crop.helperd-session.plist"), b"x").unwrap();
    std::fs::write(agents.join("com.example.keep.plist"), b"x").unwrap();
    std::fs::create_dir_all(h.join("Documents")).unwrap();
    let opts = ExecOptions {
        ai_port: Some(1),
        home: Some(h.clone()),
        ..Default::default()
    };
    let (f, node) = fleet_full(fake_payload(), opts, 9, vec![], false, Some(data.clone())).await;
    // The first heartbeat carries this service's version, which must understand `erase`.
    for _ in 0..40 {
        let (_, st) = admin(&f, "GET", "/admin/status", Value::Null).await;
        if st["nodes"][0]["last_heartbeat"].is_object() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    let id = run_cmd(&f, &node, json!({"kind":"erase"})).await;
    let v = wait_state(&f, &id, &["ok", "failed"], 30).await;
    assert_eq!(v["record"]["state"], "ok", "{v}");
    for _ in 0..40 {
        if !data.exists() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    assert!(!data.exists(), "the service folder is gone");
    assert!(!desktop.exists(), "Lefi Desktop's data is gone");
    assert!(!agents.join("com.lefi-crop.helperd-session.plist").exists());
    assert!(
        agents.join("com.example.keep.plist").exists(),
        "other apps untouched"
    );
    assert!(h.join("Documents").exists(), "the user's files untouched");
    let (_, st) = admin(&f, "GET", "/admin/status", Value::Null).await;
    assert_eq!(
        st["nodes"][0]["revoked"], true,
        "nothing more is sent to it"
    );
    // A second erase is refused: the PC no longer belongs to the installation.
    let (code, _) = admin(
        &f,
        "POST",
        &format!("/admin/nodes/{node}/run"),
        json!({"kind":"erase"}),
    )
    .await;
    assert_ne!(code, 200);
}
