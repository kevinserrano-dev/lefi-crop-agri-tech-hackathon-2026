//! The only IPC surface of the app (see build.rs and capabilities/default.json).

use std::path::PathBuf;

use serde::Serialize;
use tauri::State;

use crate::brain::{ApiAnswer, ApiCall, BrainClient, BrainState};
use crate::config::BrainConfig;
use crate::discovery;
use crate::error::{AppError, AppResult};
use crate::pairing::{self, FileVault, KeyVault, PairingStore};
use crate::secrets;

/// Where `pairing.json` lives (the app's data folder), managed by `lib.rs`.
pub struct DataDir(pub PathBuf);

#[tauri::command]
pub async fn api_request(brain: State<'_, BrainState>, req: ApiCall) -> AppResult<ApiAnswer> {
    brain.get().call(req).await
}

#[derive(Serialize)]
pub struct BrainEndpoint {
    name: String,
    url: String,
    source: &'static str,
}

/// The Brain this PC knows (configured or paired). Empty when none: the UI explains it.
#[tauri::command]
pub async fn discover_brain(
    app: tauri::AppHandle,
    brain: State<'_, BrainState>,
    dir: State<'_, DataDir>,
) -> AppResult<Vec<BrainEndpoint>> {
    // Lefi Crop Helper's "Reset pairing" removed this PC's pairing: stop using it right away.
    if brain.get().config().source == "paired"
        && PairingStore::new(&dir.0)
            .usable(&FileVault::new(&dir.0))
            .is_none()
    {
        if let Ok(none) = BrainClient::new(BrainConfig::none()) {
            brain.replace(none);
        }
    }
    if brain.get().config().source == "paired" {
        failover(&brain, &dir.0).await;
    }
    // Polled while this PC knows no Brain: an offer Lefi Crop Helper left meanwhile is used now.
    if brain.get().config().base_url.is_none() {
        crate::spawn_offer(app, dir.0.clone());
    }
    let client = brain.get();
    let config = client.config();
    Ok(config
        .base_url
        .iter()
        .map(|u| BrainEndpoint {
            name: "Lefi Brain".into(),
            url: u.as_str().trim_end_matches('/').to_string(),
            source: config.source,
        })
        .collect())
}

/// Something listens at this origin's host and port (2 s). Says nothing about who it is: the
/// pinned CA and this PC's certificate decide that on the real request.
async fn answers(url: &str) -> bool {
    let Ok(u) = url::Url::parse(url) else {
        return false;
    };
    let (Some(host), Some(port)) = (u.host_str(), u.port_or_known_default()) else {
        return false;
    };
    let host = host
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_string();
    matches!(
        tokio::time::timeout(
            std::time::Duration::from_secs(2),
            tokio::net::TcpStream::connect((host.as_str(), port)),
        )
        .await,
        Ok(Ok(_))
    )
}

/// The paired address does not answer (the main PC's name is not announced, or it moved): use
/// another address of the same gateway that does, and remember it first (ADR-055).
async fn failover(brain: &BrainState, dir: &std::path::Path) {
    let current = brain
        .get()
        .config()
        .base_url
        .as_ref()
        .map(|u| u.as_str().trim_end_matches('/').to_string());
    let Some(current) = current else { return };
    if answers(&current).await {
        return;
    }
    let store = PairingStore::new(dir);
    let Some((p, key)) = store.usable(&FileVault::new(dir)) else {
        return;
    };
    for alt in p.alternates.clone() {
        if alt.trim_end_matches('/') == current || !answers(&alt).await {
            continue;
        }
        let mut moved = p.clone();
        moved.url = alt.trim_end_matches('/').to_string();
        moved.alternates = std::iter::once(p.url.clone())
            .chain(p.alternates.iter().filter(|a| **a != alt).cloned())
            .collect();
        if let Ok(client) = BrainConfig::from_pairing(&moved, &key).and_then(BrainClient::new) {
            if store.save(&moved).is_ok() {
                eprintln!("Lefi Brain: {current} does not answer; using {}", moved.url);
                brain.replace(client);
            }
            return;
        }
    }
}

/// The last automatic pairing attempt on this PC, and whether an offer is waiting.
#[tauri::command]
pub fn pairing_status(dir: State<'_, DataDir>) -> serde_json::Value {
    serde_json::json!({
        "status": pairing::read_status(&dir.0),
        "offer_waiting": pairing::read_offer(&dir.0).is_some(),
    })
}

/// Looks for Lefi Brain on the network (mDNS, then `lefi-main.local`). Untrusted: says only whether
/// something answers as Lefi Brain; pairing decides what to trust (ADR-047).
#[tauri::command]
pub async fn find_brains() -> Vec<discovery::FoundBrain> {
    discovery::find(
        discovery::BRAIN_SERVICE,
        std::time::Duration::from_secs(3),
        Some(discovery::MAIN_NAME_URL),
    )
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceIdentity {
    device_id: String,
    ca_fingerprint: String,
    paired_at: String,
    url: String,
    expires_at: String,
}

fn identity_of(p: &pairing::Pairing) -> DeviceIdentity {
    DeviceIdentity {
        device_id: p.device_id.clone(),
        ca_fingerprint: p.gateway_ca_fingerprint.clone(),
        paired_at: p.paired_at_unix.to_string(),
        url: p.url.clone(),
        expires_at: p.expires_at.clone(),
    }
}

/// This PC's pairing, or `None`. No key or certificate crosses into the WebView.
#[tauri::command]
pub fn device_identity(dir: State<'_, DataDir>) -> Option<DeviceIdentity> {
    PairingStore::new(&dir.0).load().as_ref().map(identity_of)
}

/// Pairs with the Lefi Brain at `url` with a one-time code from Lefi Crop Helper (ADR-048).
#[tauri::command]
pub async fn pair_device(
    brain: State<'_, BrainState>,
    dir: State<'_, DataDir>,
    url: String,
    code: String,
) -> AppResult<DeviceIdentity> {
    let name = device_name();
    let vault = FileVault::new(&dir.0);
    let p = pairing::pair(&url, &code, &name, &vault, cfg!(debug_assertions)).await?;
    let key = vault
        .get()?
        .ok_or(AppError::Config("device key not saved".into()))?;
    let client = match BrainConfig::from_pairing(&p, &key).and_then(BrainClient::new) {
        Ok(c) => c,
        Err(e) => {
            let _ = vault.del();
            return Err(e);
        }
    };
    PairingStore::new(&dir.0).save(&p)?;
    pairing::write_status(&dir.0, "paired", "Paired with a code.", Some(&p.url));
    brain.replace(client);
    Ok(identity_of(&p))
}

/// Forgets this PC's pairing (after a revocation, or to pair with another Lefi Brain).
#[tauri::command]
pub fn forget_pairing(brain: State<'_, BrainState>, dir: State<'_, DataDir>) -> AppResult<()> {
    PairingStore::new(&dir.0).delete()?;
    FileVault::new(&dir.0).del()?;
    brain.replace(BrainClient::new(BrainConfig::none())?);
    Ok(())
}

pub fn device_name() -> String {
    let host = std::env::var("HOSTNAME")
        .ok()
        .or_else(|| {
            std::process::Command::new("hostname")
                .arg("-s")
                .output()
                .ok()
                .and_then(|o| String::from_utf8(o.stdout).ok())
        })
        .unwrap_or_default();
    let host = host.trim();
    let dev = crate::variant::suffix();
    if host.is_empty() {
        format!("Lefi Desktop{dev}")
    } else {
        format!(
            "Lefi Desktop{dev} on {}",
            host.chars().take(40).collect::<String>()
        )
    }
}

/// Keys the WebView may never read or change: the device's private key stays in Rust.
fn guard(key: &str) -> AppResult<()> {
    if key == pairing::KEY_ACCOUNT || key.starts_with("device-") {
        return Err(AppError::InvalidRequest(
            "this secret is not available".into(),
        ));
    }
    Ok(())
}

#[tauri::command]
pub fn secret_get(key: String) -> AppResult<Option<String>> {
    guard(&key)?;
    secrets::get(&key)
}

#[tauri::command]
pub fn secret_set(key: String, value: String) -> AppResult<()> {
    guard(&key)?;
    secrets::set(&key, &value)
}

#[tauri::command]
pub fn secret_del(key: String) -> AppResult<()> {
    guard(&key)?;
    secrets::del(&key)
}

#[cfg(test)]
mod tests {
    #[test]
    fn the_device_key_never_crosses_ipc() {
        assert!(super::guard("device-key").is_err());
        assert!(super::guard("device-anything").is_err());
        assert!(super::guard("ui.theme").is_ok());
    }
}

// ------------------------------------------------------------- camera live stream (ADR-079)

/// How the stream ended: 200 and no body when it simply ended or was stopped; otherwise Lefi
/// Brain's own error (status and JSON body), so the UI shows its reason.
#[derive(serde::Serialize)]
pub struct StreamEnd {
    status: u16,
    body: serde_json::Value,
    frames: u64,
}

#[tauri::command]
pub async fn camera_stream(
    brain: State<'_, BrainState>,
    streams: State<'_, crate::stream::Streams>,
    stream_id: u32,
    camera_id: String,
    on_frame: tauri::ipc::Channel<tauri::ipc::InvokeResponseBody>,
) -> AppResult<StreamEnd> {
    if !crate::stream::valid_camera_id(&camera_id) {
        return Err(AppError::InvalidRequest("invalid camera id".into()));
    }
    let path = format!("/api/v1/cameras/{camera_id}/stream");
    run_stream(&brain, &streams, stream_id, &path, on_frame).await
}

/// A simulated robot view (ADR-091): the same MJPEG path and rules as a camera, from
/// `/robots/{id}/stream/{feed}`. Stopped with `camera_stream_stop` (streams share one table).
#[tauri::command]
pub async fn robot_stream(
    brain: State<'_, BrainState>,
    streams: State<'_, crate::stream::Streams>,
    stream_id: u32,
    robot_id: String,
    feed: String,
    on_frame: tauri::ipc::Channel<tauri::ipc::InvokeResponseBody>,
) -> AppResult<StreamEnd> {
    if !crate::stream::valid_camera_id(&robot_id) || !crate::stream::valid_camera_id(&feed) {
        return Err(AppError::InvalidRequest("invalid robot view".into()));
    }
    let path = format!("/api/v1/robots/{robot_id}/stream/{feed}");
    run_stream(&brain, &streams, stream_id, &path, on_frame).await
}

async fn run_stream(
    brain: &BrainState,
    streams: &crate::stream::Streams,
    stream_id: u32,
    path: &str,
    on_frame: tauri::ipc::Channel<tauri::ipc::InvokeResponseBody>,
) -> AppResult<StreamEnd> {
    let stop = streams.open(stream_id);
    let client = brain.get();
    let mut res = client.open_stream(path).await?;
    let status = res.status().as_u16();
    if status != 200 {
        let bytes = res.bytes().await.unwrap_or_default();
        streams.close(stream_id);
        return Ok(StreamEnd {
            status,
            body: serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null),
            frames: 0,
        });
    }
    let mut parser = crate::stream::MjpegParser::default();
    let mut frames = 0u64;
    let result = loop {
        tokio::select! {
            _ = stop.notified() => break Ok(()),
            chunk = res.chunk() => match chunk {
                Ok(Some(bytes)) => {
                    if let Err(e) = parser.push(&bytes) { break Err(e); }
                    let mut gone = false;
                    loop {
                        match parser.next_frame() {
                            Ok(Some(jpeg)) => {
                                frames += 1;
                                // The window went away: stop reading.
                                if on_frame.send(tauri::ipc::InvokeResponseBody::Raw(jpeg)).is_err() {
                                    gone = true;
                                    break;
                                }
                            }
                            Ok(None) => break,
                            Err(e) => return { streams.close(stream_id); Err(e) },
                        }
                    }
                    if gone { break Ok(()); }
                }
                Ok(None) => break Ok(()),
                Err(e) => break Err(AppError::Unreachable(e.without_url().to_string())),
            },
        }
    };
    streams.close(stream_id);
    result.map(|()| StreamEnd {
        status: 200,
        body: serde_json::Value::Null,
        frames,
    })
}

#[tauri::command]
pub fn camera_stream_stop(streams: State<'_, crate::stream::Streams>, stream_id: u32) {
    streams.close(stream_id);
}
