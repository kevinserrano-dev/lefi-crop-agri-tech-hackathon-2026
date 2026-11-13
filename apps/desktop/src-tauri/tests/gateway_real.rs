//! Lefi Desktop's Rust client against a REAL Brain behind a REAL Lefi Gateway (Caddy, HTTPS).
//! Ignored by default: `scripts/tests/desktop_gateway_real.sh` starts both in a temporary folder
//! on loopback and runs it with `--include-ignored`. Never points at an installed Brain.

use lefi_desktop_lib::brain::{ApiCall, BrainClient};
use lefi_desktop_lib::config::BrainConfig;
use lefi_desktop_lib::error::AppError;
use lefi_desktop_lib::pairing::{self, KeyVault};
use serde_json::{json, Value};

fn env(name: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| panic!("{name} not set: run desktop_gateway_real.sh"))
}

fn client(url: &str, ca_path: &str) -> BrainClient {
    let mut cfg = BrainConfig::parse(url, false).expect("gateway url");
    cfg.ca_pem = Some(std::fs::read(ca_path).expect("CA file"));
    BrainClient::new(cfg).expect("client")
}

async fn call(c: &BrainClient, method: &str, path: &str, body: Option<Value>) -> (u16, Value) {
    let a = c
        .call(ApiCall {
            method: method.into(),
            path: path.into(),
            body,
        })
        .await
        .expect("answer");
    (a.status, a.body)
}

/// Runs the Brain's own CLI on the temporary state (never an installed Brain).
fn brain_cli(args: &[&str]) -> Value {
    let out = std::process::Command::new(env("LEFI_TEST_BRAIN_PY"))
        .current_dir(env("LEFI_TEST_BRAIN_DIR"))
        .env_remove("LEFI_ENV_FILE")
        .env("LEFI_STATE_DIR", env("LEFI_TEST_STATE"))
        .args(["-m", "lefi_brain"])
        .args(args)
        .output()
        .expect("brain cli");
    serde_json::from_slice(&out.stdout).unwrap_or(Value::Null)
}

#[tokio::test]
#[ignore = "needs a real Brain and Caddy: scripts/tests/desktop_gateway_real.sh"]
async fn pair_then_sign_in_through_mtls_then_revoke() {
    let ca = env("LEFI_TEST_GATEWAY_CA");
    let url = env("LEFI_TEST_GATEWAY_URL");
    let first_pw = env("LEFI_TEST_ADMIN_PASSWORD");
    let new_pw = "a-new-test-password-42";
    let login = json!({"username": "admin", "password": first_pw});

    // Not paired: the gateway answers health, Lefi Brain refuses everything else.
    for u in [url.clone(), env("LEFI_TEST_GATEWAY_URL_IP")] {
        let (s, health) = call(&client(&u, &ca), "GET", "/api/v1/health", None).await;
        assert_eq!(s, 200, "{u}");
        assert_eq!(health["service"], "lefi-brain");
    }
    let (s, body) = call(
        &client(&url, &ca),
        "POST",
        "/api/v1/auth/login",
        Some(login.clone()),
    )
    .await;
    assert_eq!(
        (s, body["error"]["code"].as_str()),
        (401, Some("DEVICE_NOT_PAIRED"))
    );
    // ADR-056: through the real gateway, a client without a certificate is told exactly that.
    assert_eq!(body["error"]["details"]["reason"], "no_certificate");

    // A wrong code changes nothing and stores no key. The key lives in a private file, as in the app.
    let dir = std::env::temp_dir().join(format!("lefi-desktop-test-{}", std::process::id()));
    let vault = pairing::FileVault::new(&dir);
    let err = pairing::pair(&url, "ZZZZ-ZZZZ-ZZZZ", "TEST desk", &vault, false)
        .await
        .unwrap_err();
    assert!(err.to_string().contains("refused this code"), "{err}");
    assert!(vault.get().unwrap().is_none());

    // Pair with a real one-time code from Lefi Brain's CLI (what Lefi Crop Helper runs).
    let code = brain_cli(&["pair", "new", "--json", "--label", "TEST desk"])["code"]
        .as_str()
        .expect("code")
        .to_string();
    let p = pairing::pair(&url, &code, "TEST desk", &vault, false)
        .await
        .expect("paired");
    assert_eq!(
        p.gateway_ca_pem,
        std::fs::read_to_string(&ca).unwrap(),
        "pins the gateway CA"
    );
    let again = pairing::pair(&url, &code, "TEST desk 2", &vault, false).await;
    assert!(again.is_err(), "a code works once");

    let key = vault.get().unwrap().expect("key kept in the vault");
    let c = BrainClient::new(BrainConfig::from_pairing(&p, &key).unwrap()).unwrap();
    let (s, body) = call(
        &c,
        "POST",
        "/api/v1/auth/login",
        Some(json!({"username": "admin", "password": "wrong-password-1"})),
    )
    .await;
    assert_eq!(
        (s, body["error"]["code"].as_str()),
        (401, Some("INVALID_CREDENTIALS"))
    );

    let (s, session) = call(&c, "POST", "/api/v1/auth/login", Some(login)).await;
    assert_eq!(s, 200, "{session}");
    assert_eq!(session["must_change_password"], true);
    assert!(
        session.get("token").is_none(),
        "the token stays in the cookie, in Rust"
    );
    let (s, me) = call(&c, "GET", "/api/v1/auth/session", None).await;
    assert_eq!((s, me["user"]["username"].as_str()), (200, Some("admin")));
    let (s, body) = call(&c, "GET", "/api/v1/roles", None).await;
    assert_eq!(
        (s, body["error"]["code"].as_str()),
        (403, Some("PASSWORD_CHANGE_REQUIRED"))
    );
    let (s, changed) = call(
        &c,
        "POST",
        "/api/v1/auth/password",
        Some(json!({"current_password": first_pw, "new_password": new_pw})),
    )
    .await;
    assert_eq!(
        (s, changed["must_change_password"].as_bool()),
        (200, Some(false))
    );
    assert_eq!(call(&c, "GET", "/api/v1/roles", None).await.0, 200);

    // Lefi AI assistant through the gateway (ADR-067), with the script's test-only fake AI node:
    // the answer is written in the background and read back until it is done.
    let (s, ai) = call(&c, "GET", "/api/v1/ai/assistant", None).await;
    assert_eq!((s, ai["state"].as_str()), (200, Some("available")), "{ai}");
    let (s, conv) = call(
        &c,
        "POST",
        "/api/v1/ai/chat",
        Some(json!({"message": "¿Qué zonas hay?"})),
    )
    .await;
    assert_eq!(s, 202, "{conv}");
    let path = format!("/api/v1/ai/conversations/{}", conv["id"].as_str().unwrap());
    let mut answer = Value::Null;
    for _ in 0..100 {
        let (_, now) = call(&c, "GET", &path, None).await;
        if now["messages"][1]["state"] != "thinking" {
            answer = now["messages"][1].clone();
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
    assert_eq!(answer["state"], "done", "{answer}");
    assert_eq!(answer["tools"][0]["name"], "greenhouse_overview");
    assert_eq!(answer["tools"][0]["outcome"], "ok");

    // Lefi Brain knows this device, and audited the sign-in with it.
    let devices = brain_cli(&["pair", "list", "--json"]);
    let mine = devices
        .as_array()
        .unwrap()
        .iter()
        .find(|d| d["id"] == p.device_id.as_str())
        .expect("listed");
    assert_eq!(mine["status"], "active");
    assert!(!mine["last_seen_at"].is_null());

    // Revoked: refused at once, without waiting for the certificate to expire.
    let revoked = brain_cli(&["pair", "revoke", &p.device_id, "--json", "--reason", "TEST"]);
    assert_eq!(revoked["status"], "revoked");
    let (s, body) = call(&c, "GET", "/api/v1/auth/session", None).await;
    assert_eq!(
        (s, body["error"]["code"].as_str()),
        (401, Some("DEVICE_REVOKED"))
    );
    assert_eq!(body["error"]["details"]["reason"], "revoked");
    assert_eq!(body["error"]["details"]["device_id"], p.device_id.as_str());
    assert_eq!(call(&c, "POST", "/api/v1/auth/logout", None).await.0, 401);
    let _ = std::fs::remove_dir_all(&dir);
}

/// ADR-055: the main PC's name does not resolve (its service is not announcing it) → pairing uses
/// the gateway's address instead, and keeps the name as an alternate; pairing this PC again
/// replaces its older pairing in Lefi Brain instead of adding another device.
#[tokio::test]
#[ignore = "needs a real Brain and Caddy: scripts/tests/desktop_gateway_real.sh"]
async fn an_unresolvable_name_falls_back_to_the_address_and_one_pc_keeps_one_pairing() {
    let ip_url = env("LEFI_TEST_GATEWAY_URL_IP");
    let port = ip_url.rsplit(':').next().unwrap().to_string();
    let nowhere = format!("https://lefi-nowhere-{}.invalid:{port}", std::process::id());
    let dir = std::env::temp_dir().join(format!("lefi-desktop-test55-{}", std::process::id()));
    let vault = pairing::FileVault::new(&dir);
    let new_code = || {
        brain_cli(&["pair", "new", "--json", "--label", "TEST failover"])["code"]
            .as_str()
            .expect("code")
            .to_string()
    };
    let urls = [nowhere.clone(), ip_url.clone()];
    let first = pairing::pair_any(&urls, &new_code(), "TEST failover", &vault, false)
        .await
        .expect("paired through the address");
    assert_eq!(first.url, ip_url.trim_end_matches('/'));
    assert_eq!(first.alternates, std::slice::from_ref(&nowhere));
    let key = vault.get().unwrap().unwrap();
    let c = BrainClient::new(BrainConfig::from_pairing(&first, &key).unwrap()).unwrap();
    let (s, body) = call(&c, "GET", "/api/v1/auth/session", None).await;
    assert_eq!(
        (s, body["error"]["code"].as_str()),
        (401, Some("NOT_AUTHENTICATED")),
        "the device is accepted; only a person must still sign in"
    );
    // ADR-057: from this PC's LAN address the gateway forwards a non-loopback X-Forwarded-For,
    // as for every PC on a real network. Lefi Brain must still see the request as coming through
    // the gateway (it refused it as `not_through_gateway` while uvicorn rewrote the peer).
    if let Ok(lan) = std::env::var("LEFI_TEST_GATEWAY_URL_LAN") {
        let mut by_lan = first.clone();
        by_lan.url = lan.clone();
        let c = BrainClient::new(BrainConfig::from_pairing(&by_lan, &key).unwrap()).unwrap();
        let (s, body) = call(&c, "GET", "/api/v1/auth/session", None).await;
        assert_eq!(
            (s, body["error"]["code"].as_str()),
            (401, Some("NOT_AUTHENTICATED")),
            "through {lan}: {body}"
        );
    } else {
        eprintln!("no LAN address on this PC: the non-loopback case was not run");
    }

    let second = pairing::pair_any(&urls, &new_code(), "TEST failover", &vault, false)
        .await
        .expect("paired again");
    let list = brain_cli(&["pair", "list", "--json"]);
    let find = |id: &str| {
        list.as_array()
            .unwrap()
            .iter()
            .find(|d| d["id"] == id)
            .cloned()
            .expect("listed")
    };
    let mid = pairing::machine_id().expect("this PC has an id");
    let (a, b) = (find(&first.device_id), find(&second.device_id));
    assert_eq!(
        (a["machine_id"].as_str(), b["machine_id"].as_str()),
        (Some(mid.as_str()), Some(mid.as_str()))
    );
    assert_eq!(a["status"], "revoked");
    assert_eq!(a["revoked_reason"], "replaced by a new pairing of this PC");
    assert_eq!(b["status"], "active");
    let (s, body) = call(&c, "GET", "/api/v1/auth/session", None).await;
    assert_eq!(
        (s, body["error"]["code"].as_str()),
        (401, Some("DEVICE_REVOKED"))
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
#[ignore = "needs a real Brain and Caddy: scripts/tests/desktop_gateway_real.sh"]
async fn another_ca_is_refused() {
    let c = client(&env("LEFI_TEST_GATEWAY_URL"), &env("LEFI_TEST_WRONG_CA"));
    let err = c
        .call(ApiCall {
            method: "GET".into(),
            path: "/api/v1/health".into(),
            body: None,
        })
        .await
        .unwrap_err();
    assert!(matches!(err, AppError::Unreachable(_)), "{err}");
}

#[tokio::test]
#[ignore = "needs a real Brain, Caddy and a dns-sd announcement: scripts/tests/desktop_gateway_real.sh"]
async fn finds_the_announced_brain_and_sees_it_is_on() {
    use lefi_desktop_lib::discovery;
    let service = env("LEFI_TEST_BRAIN_SERVICE");
    let host_url = env("LEFI_TEST_ANNOUNCED_URL");
    let found = discovery::find(&service, std::time::Duration::from_secs(6), None).await;
    let hit = found
        .iter()
        .find(|b| b.url == host_url)
        .unwrap_or_else(|| panic!("{host_url} not among {found:?}"));
    assert_eq!((hit.via, hit.state), ("mdns", "on"));
    assert!(hit.addresses.iter().any(|a| a == "127.0.0.1"), "{hit:?}");
    // Nothing announced under another type is picked up.
    let none = discovery::find(
        "_lefi-brain-none._tcp.local.",
        std::time::Duration::from_secs(2),
        None,
    )
    .await;
    assert!(none.is_empty(), "{none:?}");
}

/// Workforce (ADR-069): an administrator creates a person through Lefi Gateway; that person signs
/// in through the same gateway with the temporary password, must choose their own, gets exactly
/// their role's permissions, and is refused at once once deactivated.
#[tokio::test]
#[ignore = "needs a real Brain and Caddy: scripts/tests/desktop_gateway_real.sh"]
async fn admin_creates_a_user_who_signs_in_through_the_gateway() {
    let url = env("LEFI_TEST_GATEWAY_URL");
    let dir = std::env::temp_dir().join(format!("lefi-desktop-test69-{}", std::process::id()));
    let vault = pairing::FileVault::new(&dir);
    let code = brain_cli(&["pair", "new", "--json", "--label", "TEST users"])["code"]
        .as_str()
        .expect("code")
        .to_string();
    let p = pairing::pair(&url, &code, "TEST users", &vault, false)
        .await
        .expect("paired");
    let key = vault.get().unwrap().unwrap();
    let pc = || BrainClient::new(BrainConfig::from_pairing(&p, &key).unwrap()).unwrap();

    // A second administrator made with Lefi Brain's CLI, so the installer's administrator (used by
    // the other tests with its first password) is left untouched.
    let admin_name = format!("test.admin{}", std::process::id());
    let mut cli = std::process::Command::new(env("LEFI_TEST_BRAIN_PY"))
        .current_dir(env("LEFI_TEST_BRAIN_DIR"))
        .env_remove("LEFI_ENV_FILE")
        .env("LEFI_STATE_DIR", env("LEFI_TEST_STATE"))
        .args([
            "-m",
            "lefi_brain",
            "user",
            "add",
            &admin_name,
            "--role",
            "admin",
        ])
        .args(["--password-stdin", "--json"])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::null())
        .spawn()
        .expect("brain cli");
    {
        use std::io::Write;
        let mut stdin = cli.stdin.take().unwrap();
        writeln!(stdin, "test-admin-first-1").unwrap();
    }
    assert!(cli.wait().unwrap().success(), "user add");
    let admin = pc();
    let (s, session) = call(
        &admin,
        "POST",
        "/api/v1/auth/login",
        Some(json!({"username": admin_name, "password": "test-admin-first-1"})),
    )
    .await;
    assert_eq!(s, 200, "{session}");
    if session["must_change_password"] == true {
        let (s, _) = call(
            &admin,
            "POST",
            "/api/v1/auth/password",
            Some(json!({"current_password": "test-admin-first-1", "new_password": "test-admin-own-2"})),
        )
        .await;
        assert_eq!(s, 200);
    }

    let username = format!("test.scout{}", std::process::id());
    let (s, made) = call(
        &admin,
        "POST",
        "/api/v1/users",
        Some(json!({"username": username, "display_name": "TEST Scout", "role": "scout"})),
    )
    .await;
    assert_eq!(s, 201, "{made}");
    let temporary = made["temporary_password"]
        .as_str()
        .expect("shown once")
        .to_string();
    let user_id = made["user"]["id"].as_str().unwrap().to_string();

    // The new person, on the same PC (the same paired device), through the same gateway.
    let person = pc();
    let (s, me) = call(
        &person,
        "POST",
        "/api/v1/auth/login",
        Some(json!({"username": username, "password": temporary})),
    )
    .await;
    assert_eq!(
        (s, me["must_change_password"].as_bool()),
        (200, Some(true)),
        "{me}"
    );
    let (s, me) = call(
        &person,
        "POST",
        "/api/v1/auth/password",
        Some(json!({"current_password": temporary, "new_password": "scout-own-password-1"})),
    )
    .await;
    assert_eq!((s, me["role"]["id"].as_str()), (200, Some("scout")));
    assert_eq!(call(&person, "GET", "/api/v1/plants", None).await.0, 200);
    let (s, body) = call(&person, "GET", "/api/v1/users", None).await;
    assert_eq!(
        (s, body["error"]["code"].as_str()),
        (403, Some("FORBIDDEN"))
    );

    // Notifications (ADR-072) through the gateway: the new person reports an incident, and Lefi
    // Brain notifies the administrator, who reads it and marks it read.
    let (s, inc) = call(
        &person,
        "POST",
        "/api/v1/alerts",
        Some(json!({"title": "TEST leak under bench", "severity": "warning"})),
    )
    .await;
    assert_eq!(s, 201, "{inc}");
    let (s, inbox) = call(&admin, "GET", "/api/v1/notifications", None).await;
    assert_eq!(s, 200, "{inbox}");
    let item = inbox["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|n| n["alert_id"] == inc["id"])
        .expect("the administrator was notified");
    assert_eq!(item["kind"], "incident_reported");
    let (s, read) = call(
        &admin,
        "POST",
        "/api/v1/notifications/read",
        Some(json!({"ids": [item["id"]]})),
    )
    .await;
    assert_eq!((s, read["marked"].as_i64()), (200, Some(1)));
    let (_, mine) = call(&person, "GET", "/api/v1/notifications", None).await;
    assert!(
        mine["items"]
            .as_array()
            .unwrap()
            .iter()
            .all(|n| n["alert_id"] != inc["id"]),
        "the reporter is not notified of their own incident"
    );

    // Deactivated: the open session ends at once and the password no longer works.
    let (s, body) = call(
        &admin,
        "PATCH",
        &format!("/api/v1/users/{user_id}"),
        Some(json!({"status": "disabled"})),
    )
    .await;
    assert_eq!((s, body["status"].as_str()), (200, Some("disabled")));
    assert_eq!(
        call(&person, "GET", "/api/v1/auth/session", None).await.0,
        401
    );
    let (s, _) = call(
        &person,
        "POST",
        "/api/v1/auth/login",
        Some(json!({"username": username, "password": "scout-own-password-1"})),
    )
    .await;
    assert_eq!(s, 401);

    // The administrator reads it all back from the audit trail.
    let (s, page) = call(&admin, "GET", "/api/v1/audit?action=user.", None).await;
    assert_eq!(s, 200, "{page}");
    let actions: Vec<&str> = page["entries"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| e["target_id"] == user_id.as_str())
        .map(|e| e["action"].as_str().unwrap())
        .collect();
    assert_eq!(
        actions,
        ["user.disabled", "user.password_changed", "user.created"]
    );
    let _ = std::fs::remove_dir_all(&dir);
}
