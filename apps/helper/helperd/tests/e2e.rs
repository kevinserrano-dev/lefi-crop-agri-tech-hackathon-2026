//! Main PC and satellite in one process, real TLS on loopback test ports, throwaway CA.

use std::net::IpAddr;
use std::sync::atomic::{AtomicU16, Ordering};

use lefi_helperd::ca::{test_root, RootCa};
use lefi_helperd::main_node::{self, MainConfig, Shared};
use lefi_helperd::satellite;
use serde_json::{json, Value};

static NEXT_PORT: AtomicU16 = AtomicU16::new(28790);

fn ports() -> (u16, u16, u16) {
    let p = NEXT_PORT.fetch_add(3, Ordering::SeqCst);
    (p, p + 1, p + 2)
}

async fn start_main(
    data: &std::path::Path,
    max_pcs: u32,
) -> (std::sync::Arc<Shared>, (u16, u16, u16)) {
    lefi_helperd::init_crypto();
    let (cpem, kpem) = test_root();
    let (h, t, a) = ports();
    let cfg = MainConfig {
        publish_name: false,
        auto_pair_desktops: false,
        auto_pair_local: false,
        data_dir: data.to_path_buf(),
        lan_ips: vec![IpAddr::from([127, 0, 0, 1])],
        bind: IpAddr::from([127, 0, 0, 1]),
        http_port: h,
        tls_port: t,
        admin_port: a,
        satellite_bin: None,
        payload_root: None,
        ai_port: 9,
        cli_env: vec![],
    };
    let shared = Shared::new(
        cfg,
        RootCa::from_pem(&cpem, &kpem).unwrap(),
        "TEST-0000-0000-0000".into(),
        max_pcs,
    )
    .unwrap();
    tokio::spawn(main_node::run(shared.clone()));
    for _ in 0..50 {
        if reqwest::get(format!("http://127.0.0.1:{h}/setup"))
            .await
            .is_ok()
        {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    (shared, (h, t, a))
}

async fn admin(
    shared: &Shared,
    port: u16,
    method: &str,
    path: &str,
    body: Value,
    token: bool,
) -> (u16, Value) {
    let c = reqwest::Client::new();
    let url = format!("http://127.0.0.1:{port}{path}");
    let mut r = if method == "GET" {
        c.get(url)
    } else {
        c.post(url).json(&body)
    };
    if token {
        r = r.bearer_auth(&shared.admin_token);
    }
    let resp = r.send().await.unwrap();
    (
        resp.status().as_u16(),
        resp.json().await.unwrap_or(Value::Null),
    )
}

#[tokio::test]
async fn enrol_heartbeat_assign_and_revoke_over_real_tls() {
    let main_dir = tempfile::tempdir().unwrap();
    let sat_dir = tempfile::tempdir().unwrap();
    let (shared, (h, t, a)) = start_main(main_dir.path(), 3).await;
    let fp = shared.ca.fingerprint.clone();

    // The console API needs the token.
    assert_eq!(
        admin(&shared, a, "GET", "/admin/status", Value::Null, false)
            .await
            .0,
        401
    );
    let (st, code) = admin(&shared, a, "POST", "/admin/codes", json!({}), true).await;
    assert_eq!(st, 200, "{code}");
    let code = code["code"].as_str().unwrap().to_string();

    // A wrong fingerprint stops the satellite before it sends anything.
    let e = satellite::join(sat_dir.path(), "127.0.0.1", &code, &"0".repeat(64), h, t)
        .await
        .unwrap_err();
    assert_eq!(e.code, "CA_MISMATCH");

    let cfg = satellite::join(sat_dir.path(), "127.0.0.1", &code, &fp, h, t)
        .await
        .unwrap();
    assert!(cfg.node_id.starts_with("pc-"));
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let m = std::fs::metadata(sat_dir.path().join("node/key.pem"))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(m & 0o777, 0o600);
    }
    // The code cannot be used twice.
    let other = tempfile::tempdir().unwrap();
    assert_eq!(
        satellite::join(other.path(), "127.0.0.1", &code, &fp, h, t)
            .await
            .unwrap_err()
            .code,
        "CODE_USED"
    );

    // Heartbeat with the issued certificate.
    let r = satellite::beat(sat_dir.path(), &cfg, &sandbox())
        .await
        .unwrap();
    assert!(r.assigned.is_empty());
    let (_, status) = admin(&shared, a, "GET", "/admin/status", Value::Null, true).await;
    assert_eq!(status["nodes"][0]["connectivity"], "online");
    assert!(status["nodes"][0]["last_heartbeat"]["hostname"].is_string());

    // A heartbeat without a certificate is refused.
    let root = std::fs::read_to_string(sat_dir.path().join("node/root-ca.pem")).unwrap();
    let anon = reqwest::Client::builder()
        .use_rustls_tls()
        .tls_built_in_root_certs(false)
        .add_root_certificate(reqwest::Certificate::from_pem(root.as_bytes()).unwrap())
        .build()
        .unwrap();
    let resp = anon.post(format!("https://127.0.0.1:{t}/v1/heartbeat")).json(&json!({
        "hostname":"x","os":"x","arch":"x","helperd_version":"x","uptime_s":null,"disk_free_gb":null,"services":[]
    })).send().await.unwrap();
    assert_eq!(resp.status().as_u16(), 401);

    // The join page tells only the asking PC about itself.
    let me: Value = reqwest::get(format!("http://127.0.0.1:{h}/setup/me"))
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(me["joined"], true);
    if me["report"].is_object() {
        assert!(
            !me["samples"].as_array().unwrap().is_empty(),
            "each heartbeat with a report is kept for the home page's charts"
        );
    }
    // Joined is not set up: nothing is chosen for it yet, so it stays on its setup steps and its
    // home sends it back there.
    assert_eq!(me["setup_done"], false);
    let no_follow = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap();
    let r = no_follow
        .get(format!("http://127.0.0.1:{h}/"))
        .send()
        .await
        .unwrap();
    assert!(r.status().is_redirection());
    assert_eq!(r.headers()["location"], "/setup");
    let page = reqwest::get(format!("http://127.0.0.1:{h}/setup"))
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    assert!(page.contains(r#"const PAGE="setup""#));
    assert!(page.contains(&fp[..16]));
    assert!(!page.contains(&cfg.node_id), "the page itself lists no PCs");

    // Assignments: the Brain is refused, the AI is accepted and reported back to the satellite.
    let id = cfg.node_id.clone();
    let (st, e) = admin(
        &shared,
        a,
        "POST",
        &format!("/admin/nodes/{id}/assign"),
        json!({"roles":["core"]}),
        true,
    )
    .await;
    assert_eq!(
        (st, e["error"]["code"].as_str()),
        (409, Some("BRAIN_ONLY_ON_MAIN"))
    );
    assert_eq!(
        admin(
            &shared,
            a,
            "POST",
            &format!("/admin/nodes/{id}/assign"),
            json!({"roles":["ai"]}),
            true
        )
        .await
        .0,
        200
    );
    assert_eq!(
        satellite::beat(sat_dir.path(), &cfg, &sandbox())
            .await
            .unwrap()
            .assigned,
        vec!["ai".to_string()]
    );

    // Revoked: the satellite is told and stops.
    assert_eq!(
        admin(
            &shared,
            a,
            "POST",
            &format!("/admin/nodes/{id}/revoke"),
            Value::Null,
            true
        )
        .await
        .0,
        200
    );
    assert_eq!(
        satellite::beat(sat_dir.path(), &cfg, &sandbox())
            .await
            .unwrap_err()
            .code,
        "NODE_REVOKED"
    );
}

#[tokio::test]
async fn licence_limit_and_bound_codes() {
    let main_dir = tempfile::tempdir().unwrap();
    let (shared, (h, t, a)) = start_main(main_dir.path(), 2).await;
    let fp = shared.ca.fingerprint.clone();
    let (st, c) = admin(
        &shared,
        a,
        "POST",
        "/admin/codes",
        json!({"expected_ip":"10.9.9.9"}),
        true,
    )
    .await;
    assert_eq!(st, 200);
    let s1 = tempfile::tempdir().unwrap();
    let e = satellite::join(
        s1.path(),
        "127.0.0.1",
        c["code"].as_str().unwrap(),
        &fp,
        h,
        t,
    )
    .await
    .unwrap_err();
    assert_eq!(e.code, "CODE_WRONG_PC");
    let (_, c2) = admin(&shared, a, "POST", "/admin/codes", json!({}), true).await;
    satellite::join(
        s1.path(),
        "127.0.0.1",
        c2["code"].as_str().unwrap(),
        &fp,
        h,
        t,
    )
    .await
    .unwrap();
    let (st, e) = admin(&shared, a, "POST", "/admin/codes", json!({}), true).await;
    assert_eq!(
        (st, e["error"]["code"].as_str()),
        (409, Some("LICENCE_PC_LIMIT"))
    );
}

/// Probes point at a closed port and an empty home: tests never touch the real AI of this PC.
fn sandbox() -> lefi_helperd::executor::ExecOptions {
    lefi_helperd::executor::ExecOptions {
        ai_port: Some(1),
        home: Some(std::env::temp_dir().join("lefi-helperd-test-no-home")),
        ..Default::default()
    }
}
