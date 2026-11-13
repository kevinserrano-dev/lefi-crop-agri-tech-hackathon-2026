//! Finding Lefi Brain on the network (ADR-047). The main PC announces `_lefi-brain._tcp` (mDNS)
//! while Lefi Gateway serves HTTPS there; Lefi Desktop browses for it and also tries the main PC's
//! Lefi name, `lefi-main.local`.
//!
//! **A discovery answer is never trusted.** Another machine can announce the same name. Each
//! candidate is only asked `GET /api/v1/health`, over TLS whose certificate is NOT checked
//! (this PC has no pinned CA yet), without cookies, credentials or redirects, to say whether
//! something that calls itself Lefi Brain is on. Nothing else is ever sent to it from here; the
//! pinned CA obtained by pairing is the only trust anchor for everything after.

use std::collections::BTreeMap;
use std::time::Duration;

use mdns_sd::{ServiceDaemon, ServiceEvent};
use reqwest::{redirect, Client};
use serde::Serialize;
use serde_json::Value;

pub const BRAIN_SERVICE: &str = "_lefi-brain._tcp.local.";
/// The main PC's Lefi name (ADR-042), tried even when the announcement is not seen.
pub const MAIN_NAME_URL: &str = "https://lefi-main.local:8443";
const HEALTH: &str = "/api/v1/health";

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FoundBrain {
    /// Origin to pair with, e.g. `https://lefi-main.local:8443`.
    pub url: String,
    /// IP addresses the announcement gave (empty when found by name only).
    pub addresses: Vec<String>,
    /// `mdns`: announced on the network. `name`: answered at the main PC's Lefi name.
    pub via: &'static str,
    /// `on`: answered as Lefi Brain. `not_answering`: no answer. `not_a_brain`: something else.
    /// `brain_down`: the gateway answered, Lefi Brain behind it did not (HTTP 5xx).
    pub state: &'static str,
    pub version: Option<String>,
}

/// One candidate from the announcement: host name, port, addresses.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Candidate {
    pub host: String,
    pub port: u16,
    pub addresses: Vec<String>,
}

/// Browses `service` for `wait`, returning what resolved. Errors (no multicast) give an empty list.
pub fn browse(service: &str, wait: Duration) -> Vec<Candidate> {
    let Ok(daemon) = ServiceDaemon::new() else {
        return Vec::new();
    };
    let Ok(rx) = daemon.browse(service) else {
        let _ = daemon.shutdown();
        return Vec::new();
    };
    let deadline = std::time::Instant::now() + wait;
    let mut found = Vec::new();
    while let Some(left) = deadline.checked_duration_since(std::time::Instant::now()) {
        match rx.recv_timeout(left) {
            Ok(ServiceEvent::ServiceResolved(info)) => {
                let mut addresses: Vec<String> =
                    info.get_addresses().iter().map(|a| a.to_string()).collect();
                addresses.sort();
                found.push(Candidate {
                    host: info.get_hostname().trim_end_matches('.').to_string(),
                    port: info.get_port(),
                    addresses,
                });
            }
            Ok(_) => {}
            Err(_) => break,
        }
    }
    let _ = daemon.stop_browse(service);
    let _ = daemon.shutdown();
    found
}

/// The origins to probe: every announced host (by name), then the main PC's Lefi name. Deduplicated.
pub fn candidate_urls(
    found: &[Candidate],
    fallback: Option<&str>,
) -> Vec<(String, Vec<String>, &'static str)> {
    let mut out: BTreeMap<String, (Vec<String>, &'static str)> = BTreeMap::new();
    for c in found {
        if !valid_host(&c.host) || c.port == 0 {
            continue;
        }
        let url = format!("https://{}:{}", c.host, c.port);
        let entry = out.entry(url).or_insert_with(|| (Vec::new(), "mdns"));
        for a in &c.addresses {
            if !entry.0.contains(a) {
                entry.0.push(a.clone());
            }
        }
    }
    if let Some(f) = fallback {
        out.entry(f.to_string())
            .or_insert_with(|| (Vec::new(), "name"));
    }
    out.into_iter().map(|(u, (a, v))| (u, a, v)).collect()
}

/// Only plain DNS host names reach a URL (an announcement is untrusted input).
fn valid_host(h: &str) -> bool {
    !h.is_empty()
        && h.len() <= 253
        && h.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && label
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-')
                && !label.starts_with('-')
        })
}

/// What a `/health` answer says.
pub fn classify(status: Option<u16>, body: &Value) -> (&'static str, Option<String>) {
    match status {
        None => ("not_answering", None),
        Some(500..=599) => ("brain_down", None),
        Some(200) if body["service"] == "lefi-brain" && body["status"] == "ok" => (
            "on",
            body["version"]
                .as_str()
                .map(|v| v.chars().take(40).collect()),
        ),
        Some(_) => ("not_a_brain", None),
    }
}

/// Client for the health probe only: certificate NOT verified (see module docs), nothing stored.
fn probe_client() -> Option<Client> {
    Client::builder()
        .no_proxy()
        .redirect(redirect::Policy::none())
        .tls_danger_accept_invalid_certs(true)
        .tls_danger_accept_invalid_hostnames(true)
        .connect_timeout(Duration::from_secs(3))
        .timeout(Duration::from_secs(4))
        .user_agent(concat!("lefi-desktop/", env!("CARGO_PKG_VERSION")))
        .build()
        .ok()
}

async fn probe(client: &Client, origin: &str) -> (Option<u16>, Value) {
    let Ok(res) = client.get(format!("{origin}{HEALTH}")).send().await else {
        return (None, Value::Null);
    };
    let status = res.status().as_u16();
    let body = res.json::<Value>().await.unwrap_or(Value::Null);
    (Some(status), body)
}

/// Browse, then probe every candidate. Brains that answer come first.
pub async fn find(service: &str, wait: Duration, fallback: Option<&str>) -> Vec<FoundBrain> {
    let service = service.to_string();
    let found = tokio::task::spawn_blocking(move || browse(&service, wait))
        .await
        .unwrap_or_default();
    let Some(client) = probe_client() else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for (url, addresses, via) in candidate_urls(&found, fallback) {
        let (status, body) = probe(&client, &url).await;
        let (state, version) = classify(status, &body);
        // The fallback name that does not answer is not a finding: nothing is there.
        if via == "name" && state == "not_answering" {
            continue;
        }
        out.push(FoundBrain {
            url,
            addresses,
            via,
            state,
            version,
        });
    }
    out.sort_by_key(|b| (b.state != "on", b.url.clone()));
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn answers_are_classified_without_trusting_them() {
        let brain = json!({"status": "ok", "service": "lefi-brain", "version": "0.2.0"});
        assert_eq!(classify(Some(200), &brain), ("on", Some("0.2.0".into())));
        assert_eq!(
            classify(Some(200), &json!({"service": "x"})).0,
            "not_a_brain"
        );
        assert_eq!(classify(Some(404), &brain).0, "not_a_brain");
        assert_eq!(classify(Some(502), &Value::Null).0, "brain_down");
        assert_eq!(classify(None, &Value::Null).0, "not_answering");
    }

    #[test]
    fn candidates_are_deduplicated_and_unsafe_hosts_dropped() {
        let found = vec![
            Candidate {
                host: "lefi-main.local".into(),
                port: 8443,
                addresses: vec!["192.0.2.10".into()],
            },
            Candidate {
                host: "lefi-main.local".into(),
                port: 8443,
                addresses: vec!["fe80::1".into()],
            },
            Candidate {
                host: "evil.example/x?".into(),
                port: 8443,
                addresses: vec![],
            },
            Candidate {
                host: "a b".into(),
                port: 1,
                addresses: vec![],
            },
        ];
        let urls = candidate_urls(&found, Some(MAIN_NAME_URL));
        assert_eq!(
            urls,
            vec![(
                "https://lefi-main.local:8443".to_string(),
                vec!["192.0.2.10".to_string(), "fe80::1".to_string()],
                "mdns"
            )]
        );
        let other = candidate_urls(&[], Some(MAIN_NAME_URL));
        assert_eq!(other, vec![(MAIN_NAME_URL.to_string(), vec![], "name")]);
    }
}
