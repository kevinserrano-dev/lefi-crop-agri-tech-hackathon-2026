//! Lefi Desktop — thin Tauri shell (ADR-022). No business rules here: the Brain decides.

pub mod brain;
mod commands;
pub mod config;
pub mod discovery;
pub mod error;
pub mod pairing;
pub mod secrets;
pub mod stream;
pub mod variant;

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            variant::init(&app.config().identifier);
            let data = app.path().app_data_dir()?;
            app.manage(brain::BrainState::new(brain::BrainClient::new(
                startup_config(&data)?,
            )?));
            app.manage(commands::DataDir(data.clone()));
            app.manage(stream::Streams::default());
            spawn_offer(app.handle().clone(), data);

            WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title(format!("Lefi Crop{}", variant::suffix()))
                .inner_size(1440.0, 920.0)
                .min_inner_size(1024.0, 680.0)
                // The WebView may only show the bundled app (or the Vite dev server in debug).
                .on_navigation(is_app_url)
                .build()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::api_request,
            commands::discover_brain,
            commands::find_brains,
            commands::device_identity,
            commands::pair_device,
            commands::forget_pairing,
            commands::pairing_status,
            commands::secret_get,
            commands::secret_set,
            commands::secret_del,
            commands::camera_stream,
            commands::camera_stream_stop,
            commands::robot_stream,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Lefi Desktop");
}

/// Lefi Crop Helper left a one-time offer (this PC is part of the installation): pair by itself,
/// at start and whenever the sign-in page looks for a Brain (ADR-048, ADR-050). The offer stays
/// while the main PC does not answer, so the next look retries it; every attempt is written to
/// `pairing-status.json`, which the sign-in page and Lefi Crop Helper show (ADR-055).
pub(crate) fn spawn_offer(app: tauri::AppHandle, data: std::path::PathBuf) {
    use std::sync::atomic::{AtomicBool, Ordering};
    // One pairing at a time: two offers used together would each make a key and a device.
    static PAIRING: AtomicBool = AtomicBool::new(false);
    let vault = pairing::FileVault::new(&data);
    if pairing::PairingStore::new(&data).usable(&vault).is_some()
        || std::env::var_os("LEFI_BRAIN_URL").is_some()
        || PAIRING.swap(true, Ordering::SeqCst)
    {
        return;
    }
    let Some((offer, age)) = pairing::read_offer(&data) else {
        PAIRING.store(false, Ordering::SeqCst);
        return;
    };
    if age > pairing::OFFER_TTL_S {
        pairing::drop_offer(&data);
        pairing::write_status(
            &data,
            "failed",
            "The pairing code expired before Lefi Brain could be reached. Lefi Crop Helper sends a new one by itself.",
            Some(&offer.url),
        );
        PAIRING.store(false, Ordering::SeqCst);
        return;
    }
    pairing::write_status(
        &data,
        "pairing",
        "Pairing with Lefi Brain…",
        Some(&offer.url),
    );
    tauri::async_runtime::spawn(async move {
        use pairing::KeyVault;
        let name = commands::device_name();
        match pairing::pair_with_offer(&offer, &name, &vault).await {
            Ok(p) => {
                // Kept only if this PC can really use it: key, certificate and pinned CA together.
                let client = vault
                    .get()
                    .ok()
                    .flatten()
                    .ok_or(error::AppError::Config("device key not kept".into()))
                    .and_then(|key| config::BrainConfig::from_pairing(&p, &key))
                    .and_then(brain::BrainClient::new);
                pairing::drop_offer(&data);
                match client.and_then(|c| pairing::PairingStore::new(&data).save(&p).map(|_| c)) {
                    Ok(client) => {
                        app.state::<brain::BrainState>().replace(client);
                        let _ = tauri::Emitter::emit(&app, "lefi:paired", &p.device_id);
                        pairing::write_status(
                            &data,
                            "paired",
                            "Paired with Lefi Brain.",
                            Some(&p.url),
                        );
                        eprintln!("automatic pairing: paired as {}", p.device_id);
                    }
                    Err(e) => {
                        let _ = vault.del();
                        pairing::write_status(
                            &data,
                            "failed",
                            &format!("The pairing could not be kept: {e}"),
                            Some(&p.url),
                        );
                    }
                }
            }
            Err(error::AppError::Unreachable(e)) => {
                // Kept: the next look (every few seconds) tries again, until the code expires.
                pairing::write_status(
                    &data,
                    "retrying",
                    &format!("Lefi Brain did not answer at any address of the main PC ({e}). Trying again by itself."),
                    Some(&offer.url),
                );
            }
            Err(e) => {
                pairing::drop_offer(&data);
                pairing::write_status(&data, "failed", &e.to_string(), Some(&offer.url));
                eprintln!("automatic pairing did not complete: {e}");
            }
        }
        PAIRING.store(false, Ordering::SeqCst);
    });
}

/// `LEFI_BRAIN_URL` (+ `LEFI_BRAIN_CA`) wins, for development and support; then this PC's pairing.
fn startup_config(data: &std::path::Path) -> error::AppResult<config::BrainConfig> {
    if std::env::var_os("LEFI_BRAIN_URL").is_some() {
        return config::BrainConfig::from_env();
    }
    let vault = pairing::FileVault::new(data);
    if let Some((p, key)) = pairing::PairingStore::new(data).usable(&vault) {
        return config::BrainConfig::from_pairing(&p, &key);
    }
    config::BrainConfig::from_env()
}

fn is_app_url(url: &url::Url) -> bool {
    let bundled = url.scheme() == "tauri" || url.host_str() == Some("tauri.localhost");
    let dev = cfg!(debug_assertions)
        && url.scheme() == "http"
        && url.host_str() == Some("127.0.0.1")
        && url.port() == Some(1420);
    bundled || dev
}

#[cfg(test)]
mod command_list_tests {
    /// A command missing from one of the three lists fails only in the packaged app (ADR-039).
    #[test]
    fn build_rs_capabilities_and_handler_list_the_same_commands() {
        let quoted = |text: &str| -> Vec<String> {
            text.split('"')
                .skip(1)
                .step_by(2)
                .map(str::to_string)
                .collect()
        };
        let build = include_str!("../build.rs");
        let list = &build[build.find(".commands(&[").unwrap()..];
        let mut from_build = quoted(&list[..list.find("])").unwrap()]);
        let caps: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/default.json")).unwrap();
        let mut from_caps: Vec<String> = caps["permissions"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|p| p.as_str()?.strip_prefix("allow-"))
            .map(|p| p.replace('-', "_"))
            .collect();
        let lib = include_str!("lib.rs");
        let handler = &lib[lib.find("generate_handler![").unwrap()..];
        let mut from_handler: Vec<String> = handler[..handler.find(']').unwrap()]
            .split("commands::")
            .skip(1)
            .map(|s| {
                s.trim_matches(|c: char| !c.is_alphanumeric() && c != '_')
                    .to_string()
            })
            .collect();
        for l in [&mut from_build, &mut from_caps, &mut from_handler] {
            l.sort();
        }
        assert_eq!(from_build, from_caps);
        assert_eq!(from_build, from_handler);
        assert!(from_build.contains(&"find_brains".to_string()));
    }
}
