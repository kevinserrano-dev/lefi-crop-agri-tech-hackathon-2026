//! A joined PC's service replaces itself with the main PC's program (ADR-062), over real TLS on
//! loopback. The "programs" are FAKE shell scripts: nothing real is installed or restarted.

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

static NEXT_PORT: AtomicU16 = AtomicU16::new(30790);

struct Fleet {
    shared: Arc<Shared>,
    admin: u16,
    node: String,
    /// The satellite's (fake) service program that the update replaces.
    exe: PathBuf,
    /// What the main PC's (fake) program answers to `version`.
    answer: PathBuf,
    _dirs: Vec<tempfile::TempDir>,
}

fn write_exec(path: &Path, body: &str) {
    std::fs::write(path, body).unwrap();
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
}

async fn fleet() -> Fleet {
    lefi_helperd::init_crypto();
    let main_dir = tempfile::tempdir().unwrap();
    let sat = tempfile::tempdir().unwrap();
    let tools = tempfile::tempdir().unwrap();
    // The program the main PC shares answers what this file says.
    let answer = tools.path().join("answer");
    std::fs::write(&answer, "9.9.9\n").unwrap();
    let shared_bin = tools.path().join("lefi-helperd-shared");
    write_exec(
        &shared_bin,
        &format!(
            "#!/bin/sh\n[ \"$1\" = version ] && cat '{}'\n",
            answer.display()
        ),
    );
    let exe_dir = tools.path().join("bin");
    std::fs::create_dir_all(&exe_dir).unwrap();
    let exe = exe_dir.join("lefi-helperd");
    write_exec(&exe, "#!/bin/sh\necho old\n");

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
        satellite_bin: Some(shared_bin),
        payload_root: Some(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fake-installer")),
        ai_port: 9,
        cli_env: vec![],
    };
    let shared = Shared::new(
        cfg,
        RootCa::from_pem(&cpem, &kpem).unwrap(),
        "TEST".into(),
        3,
    )
    .unwrap();
    assert_eq!(shared.satellite_version.as_deref(), Some("9.9.9"));
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
    let mut f = Fleet {
        shared: shared.clone(),
        admin: p + 2,
        node: String::new(),
        exe: exe.clone(),
        answer,
        _dirs: vec![],
    };
    let (_, code) = admin(&f, "POST", "/admin/codes", json!({})).await;
    let data = sat.path().to_path_buf();
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
    let opts = ExecOptions {
        ai_port: Some(1),
        home: Some(std::env::temp_dir().join("lefi-helperd-test-no-home")),
        service_exe: Some(exe),
        ..Default::default()
    };
    tokio::spawn(async move {
        let _ = satellite::run_with(&data, opts, 1).await;
    });
    f.node = cfg.node_id;
    f._dirs = vec![main_dir, sat, tools];
    f
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

/// The update this PC is offered, once its first report arrived.
async fn offered(f: &Fleet) -> Value {
    for _ in 0..80 {
        let (_, st) = admin(f, "GET", "/admin/status", Value::Null).await;
        let n = &st["nodes"][0];
        if !n["updates"]["service"].is_null() {
            return n["updates"]["service"].clone();
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    panic!("no service update offered");
}

async fn wait_end(f: &Fleet, cmd: &str) -> Value {
    for _ in 0..120 {
        let (_, v) = admin(f, "GET", &format!("/admin/commands/{cmd}"), Value::Null).await;
        if matches!(v["record"]["state"].as_str(), Some("ok" | "failed")) {
            return v;
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    panic!("command {cmd} never ended");
}

#[tokio::test]
async fn a_joined_pc_replaces_its_service_with_the_main_pcs() {
    let f = fleet().await;
    let svc = offered(&f).await;
    assert_eq!(svc["installed"], env!("CARGO_PKG_VERSION"));
    assert_eq!(
        (svc["available"].as_str(), svc["remote"].as_bool()),
        (Some("9.9.9"), Some(true))
    );
    // The PC's own page says it too (read-only).
    let (_, st) = admin(&f, "GET", "/admin/status", Value::Null).await;
    assert_eq!(st["satellite_version"], "9.9.9");

    let (code, q) = admin(
        &f,
        "POST",
        &format!("/admin/nodes/{}/update-service", f.node),
        json!({}),
    )
    .await;
    assert_eq!(code, 200, "{q}");
    let cmd = q["command"]["command"]["id"].as_str().unwrap().to_string();
    assert_eq!(q["command"]["command"]["kind"], "update_service");
    let (busy, _) = admin(
        &f,
        "POST",
        &format!("/admin/nodes/{}/update-service", f.node),
        json!({}),
    )
    .await;
    assert_eq!(busy, 409, "one command at a time");

    let end = wait_end(&f, &cmd).await;
    assert_eq!(end["record"]["state"], "ok", "{end}");
    let now = std::fs::read_to_string(&f.exe).unwrap();
    assert!(now.contains("answer"), "the program was replaced: {now}");
    let prev = std::fs::read_to_string(f.exe.with_file_name("lefi-helperd.prev")).unwrap();
    assert_eq!(
        prev, "#!/bin/sh\necho old\n",
        "the previous program is kept"
    );
    assert!(!f.exe.with_file_name("lefi-helperd.new").exists());
}

#[tokio::test]
async fn a_program_that_does_not_answer_its_version_changes_nothing() {
    let f = fleet().await;
    offered(&f).await;
    // The main PC announced 9.9.9; the program it then sends answers something else.
    std::fs::write(&f.answer, "1.2.3\n").unwrap();
    let (code, q) = admin(
        &f,
        "POST",
        &format!("/admin/nodes/{}/update-service", f.node),
        json!({}),
    )
    .await;
    assert_eq!(code, 200, "{q}");
    let cmd = q["command"]["command"]["id"].as_str().unwrap().to_string();
    let end = wait_end(&f, &cmd).await;
    assert_eq!(end["record"]["state"], "failed", "{end}");
    assert!(
        end["record"]["error"]
            .as_str()
            .unwrap_or("")
            .contains("Nothing was changed"),
        "{end}"
    );
    assert_eq!(
        std::fs::read_to_string(&f.exe).unwrap(),
        "#!/bin/sh\necho old\n"
    );
    assert!(!f.exe.with_file_name("lefi-helperd.prev").exists());
    assert!(!f.exe.with_file_name("lefi-helperd.new").exists());
}
