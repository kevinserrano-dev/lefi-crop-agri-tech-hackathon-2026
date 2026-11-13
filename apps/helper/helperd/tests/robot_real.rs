//! The whole path of ADR-090, with nothing faked: Lefi Brain (`serve`) asks this
//! service to install the simulated robot; the repository's real installer installs the lite
//! backend; `lefi robot start` runs the real bridge; Lefi Brain sends a real mission; then the
//! robot is turned off and removed. Ignored by default (it needs `services/brain/.venv` from
//! `uv sync`, `uv` with Python 3.12 and port 8765 free); run it with
//! `cargo test --test robot_real -- --include-ignored`.
//!
//! `LEFI_ROBOT_REAL_BACKEND=genesis` installs and turns on the real MH3 in Genesis (downloads several
//! GB once into the temporary state; Apple Silicon). `LEFI_ROBOT_REAL_SESSION=1` runs a real
//! `lefi-helperd session` and sends every launchd call through it, as `lefi-helperd main` does when it
//! is the boot service (ADR-040, ADR-104). On macOS the robot's LaunchAgent plist goes to this user's
//! `~/Library/LaunchAgents` (label `com.lefi-crop.robot-sim`) and is removed at the end.

use std::net::IpAddr;
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::Duration;

use lefi_helperd::ca::{test_root, RootCa};
use lefi_helperd::main_node::{self, MainConfig, Shared};
use serde_json::{json, Value};

const PW: &str = "Real-robot-test-2026!";
const PW2: &str = "Real-robot-test-2026-new!";

fn repo() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()
        .unwrap()
}

struct Brain(Child);
impl Drop for Brain {
    /// Its whole process group (it was started in its own), by group id — never by name.
    fn drop(&mut self) {
        let group = format!("-{}", self.0.id());
        let _ = Command::new("kill").args(["-TERM", "--", &group]).status();
        let _ = self.0.wait();
    }
}

async fn wait_for<F, Fut>(what: &str, secs: u64, mut f: F) -> Value
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Option<Value>>,
{
    let t0 = std::time::Instant::now();
    for _ in 0..secs * 2 {
        if let Some(v) = f().await {
            return v;
        }
        if t0.elapsed() > Duration::from_secs(secs) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    panic!("timed out waiting for {what} after {:?}", t0.elapsed());
}

#[tokio::test]
#[ignore = "real installer, real Lefi Brain and real bridge; needs uv and port 8765"]
async fn lefi_brain_installs_turns_on_uses_and_removes_the_real_robot() {
    lefi_helperd::init_crypto();
    let root = repo();
    let state = tempfile::tempdir().unwrap();
    let main_dir = tempfile::tempdir().unwrap();
    let s = state.path();
    std::fs::write(s.join("lefi.env"), "LEFI_ROLES=core,admin\n").unwrap();
    let backend = std::env::var("LEFI_ROBOT_REAL_BACKEND").unwrap_or_else(|_| "lite".into());
    let genesis = backend == "genesis";
    let via_session = std::env::var_os("LEFI_ROBOT_REAL_SESSION").is_some();
    let mut cli_env = vec![
        ("LEFI_STATE_DIR".into(), s.display().to_string()),
        ("ENV_FILE".into(), s.join("lefi.env").display().to_string()),
    ];
    // The boot service's path: a real session helper answers the CLI's launchd requests.
    let _session = via_session.then(|| {
        cli_env.push((
            "LEFI_SESSION_DIR".into(),
            main_dir.path().join("session").display().to_string(),
        ));
        cli_env.push(("LEFI_LAUNCHD_VIA_SESSION".into(), "1".into()));
        Brain(
            Command::new(env!("CARGO_BIN_EXE_lefi-helperd"))
                .process_group(0)
                .args(["session", "--data"])
                .arg(main_dir.path())
                .stdout(Stdio::null())
                .stderr(std::fs::File::create(s.join("session.err")).unwrap())
                .spawn()
                .unwrap(),
        )
    });

    // Lefi Crop Helper's service on the main PC.
    let (cpem, kpem) = test_root();
    let admin_port = 32_792;
    let cfg = MainConfig {
        publish_name: false,
        auto_pair_desktops: false,
        auto_pair_local: false,
        data_dir: main_dir.path().to_path_buf(),
        lan_ips: vec![IpAddr::from([127, 0, 0, 1])],
        bind: IpAddr::from([127, 0, 0, 1]),
        http_port: admin_port - 2,
        tls_port: admin_port - 1,
        admin_port,
        satellite_bin: None,
        payload_root: Some(root.clone()),
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

    // Lefi Brain, with the same state folder (it reads helper/link.json from there).
    // A free port each run: a Lefi Brain left by an interrupted run must not answer instead.
    let brain_port = std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    let _brain = Brain(
        // The venv's Python itself, in its own process group: `uv run` leaves it running when
        // killed, so the whole group is stopped at the end.
        Command::new(root.join("services/brain/.venv/bin/python"))
            .process_group(0)
            .args(["-m", "lefi_brain", "serve", "--port"])
            .arg(brain_port.to_string())
            .current_dir(root.join("services/brain"))
            .env("LEFI_ENV", "development")
            .env("LEFI_STATE_DIR", s)
            .env("LEFI_BOOTSTRAP_ADMIN_USERNAME", "robotadmin")
            .env("LEFI_BOOTSTRAP_ADMIN_PASSWORD", PW)
            .env_remove("LEFI_ROBOT_SIM_URL")
            .stdout(Stdio::null())
            .stderr(std::fs::File::create(s.join("brain.err")).unwrap())
            .spawn()
            .expect("Lefi Brain starts (run `uv sync` in services/brain first)"),
    );
    let base = format!("http://127.0.0.1:{brain_port}/api/v1");
    let c = reqwest::Client::new();
    wait_for("Lefi Brain", 90, || {
        let c = c.clone();
        let url = format!("{base}/health");
        async move {
            c.get(url)
                .send()
                .await
                .ok()
                .filter(|r| r.status().is_success())
                .map(|_| json!(1))
        }
    })
    .await;
    let login = |pw: &'static str| {
        let c = c.clone();
        let url = format!("{base}/auth/login");
        async move {
            let r: Value = c
                .post(url)
                .json(
                    &json!({"username": "robotadmin", "password": pw, "token_transport": "bearer"}),
                )
                .send()
                .await
                .unwrap()
                .json()
                .await
                .unwrap();
            r["token"].as_str().unwrap().to_string()
        }
    };
    let t = login(PW).await;
    c.post(format!("{base}/auth/password"))
        .bearer_auth(&t)
        .json(&json!({"current_password": PW, "new_password": PW2}))
        .send()
        .await
        .unwrap();
    let t = login(PW2).await;
    let get = |path: String| {
        let (c, t) = (c.clone(), t.clone());
        async move {
            let r = c.get(path).bearer_auth(t).send().await.unwrap();
            (
                r.status().as_u16(),
                r.json::<Value>().await.unwrap_or(Value::Null),
            )
        }
    };
    let post = |path: String, body: Value| {
        let (c, t) = (c.clone(), t.clone());
        async move {
            let r = c
                .post(path)
                .bearer_auth(t)
                .json(&body)
                .send()
                .await
                .unwrap();
            (
                r.status().as_u16(),
                r.json::<Value>().await.unwrap_or(Value::Null),
            )
        }
    };

    // Where it may go: this PC (no AI node here).
    let (st, places) = get(format!("{base}/robot-places")).await;
    assert_eq!(st, 200, "{places}");
    assert_eq!(
        (
            places[0]["node_id"].as_str(),
            places[0]["eligible"].as_bool()
        ),
        (Some("main"), Some(true))
    );

    // Add it: the real installer runs (lite: no GPU, no MH3 model).
    let (st, robot) = post(
        format!("{base}/robots"),
        json!({"node_id": "main", "backend": backend}),
    )
    .await;
    assert_eq!(st, 202, "{robot}");
    let robot = wait_for("the install", if genesis { 3600 } else { 300 }, || {
        let f = get(format!("{base}/robots"));
        async move {
            let (_, v) = f.await;
            let d = &v[0]["device"];
            match d["status"].as_str() {
                Some("installed") => Some(v[0].clone()),
                Some("install_failed") => panic!("install failed: {d}"),
                _ => None,
            }
        }
    })
    .await;
    assert_eq!(robot["device"]["backend"], backend.as_str());
    if genesis {
        // The starter lives with this PC's data, never inside the app's payload (ADR-104).
        assert!(s.join("robot-sim/starter/GDG-Hackathon/run.sh").is_file());
        assert!(!root
            .join("simulators/robot-mh3/vendor/GDG-Hackathon")
            .exists());
    }
    assert!(s.join("robot-sim/robot.conf").is_file());
    assert!(std::fs::read_to_string(s.join("lefi.env"))
        .unwrap()
        .contains("robot"));

    // Turn it on: `lefi robot start` runs the real bridge; Lefi Brain attaches and sees it.
    let (st, on) = post(format!("{base}/robots/mh3-sim/power"), json!({"on": true})).await;
    assert_eq!(st, 200, "{on}");
    let robot = wait_for("the robot online", if genesis { 900 } else { 60 }, || {
        let f = get(format!("{base}/robots/mh3-sim"));
        async move {
            let (_, v) = f.await;
            if v["power_detail"]["problem"].is_string() {
                panic!("the robot did not start: {}", v["power_detail"]);
            }
            (v["connection"] == "online" && v["power"] == "on").then_some(v)
        }
    })
    .await;
    if genesis {
        assert!(
            robot["feeds"].as_array().is_some_and(|f| !f.is_empty()),
            "{robot}"
        );
    }
    let (st, scene) = get(format!("{base}/robots/mh3-sim/scene")).await;
    assert_eq!((st, scene["origin"].as_str()), (200, Some("SIMULATED")));

    // A real mission through Lefi Brain.
    let (st, m) = post(
        format!("{base}/robot-missions"),
        json!({"robot_id": "mh3-sim", "station_id": "sim-p1", "kind": "inspect"}),
    )
    .await;
    assert_eq!(st, 201, "{m}");
    let id = m["id"].as_str().unwrap().to_string();
    let done = wait_for("the mission", 120, || {
        let f = get(format!("{base}/robot-missions/{id}"));
        async move {
            let (_, v) = f.await;
            (v["active"] == false).then_some(v)
        }
    })
    .await;
    assert_eq!(done["state"], "COMPLETED", "{done}");

    // Off, then removed: the role and its settings are gone.
    let (st, off) = post(format!("{base}/robots/mh3-sim/power"), json!({"on": false})).await;
    assert_eq!((st, off["power"].as_str()), (200, Some("off")));
    let r = c
        .delete(format!("{base}/robots/mh3-sim"))
        .bearer_auth(&t)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status().as_u16(), 200);
    wait_for("the removal", 120, || {
        let f = get(format!("{base}/robots"));
        async move {
            let (_, v) = f.await;
            (v.as_array().is_some_and(|a| a.is_empty())).then_some(v)
        }
    })
    .await;
    assert!(!s.join("robot-sim/robot.conf").exists());
    assert!(!std::fs::read_to_string(s.join("lefi.env"))
        .unwrap()
        .contains("robot"));
}
