//! Lefi Crop Helper — guided installer shell (ADR-030). The bash installer does the work; this app
//! writes a validated answers file, runs `scripts/install.sh` and relays its NDJSON events.

mod activation;
mod answers;
mod backups;
mod commands;
mod console;
mod devices;
mod erase;
mod error;
mod fleet;
mod installer;
mod models;
mod session;
mod updates;

use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};

pub fn run() {
    // reqwest shares the service's rustls without a default provider: without this, the first HTTP
    // client built in this app aborts the process (ADR-038).
    lefi_helperd::init_crypto();
    log_panics();
    updates::clear_quarantine();
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            app.manage(installer::Runner::default());
            // Root CA + licence live in the app's private data folder on this PC.
            let data_dir = std::env::var_os("LEFI_HELPER_DATA")
                .map(std::path::PathBuf::from)
                .unwrap_or(app.path().app_data_dir()?);
            app.manage(session::Sessions::new(&data_dir));
            app.manage(activation::Activation::new(data_dir));
            WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("Lefi Crop Helper")
                .inner_size(1120.0, 780.0)
                .min_inner_size(920.0, 660.0)
                // The WebView may only show the bundled UI (or the Vite dev server in debug).
                .on_navigation(is_app_url)
                .build()?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing while the installer runs would cut its output pipe mid-step.
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.state::<installer::Runner>().is_running() {
                    api.prevent_close();
                    let _ = window.emit("setup://close-blocked", ());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::setup_context,
            commands::activation_status,
            commands::activate,
            commands::skip_activation,
            commands::scan_hardware,
            commands::preview_plan,
            commands::run_install,
            commands::run_check,
            commands::install_session,
            commands::check_ai_node,
            commands::cancel_install,
            commands::run_rollback,
            commands::run_brain_update,
            console::console_state,
            console::read_credentials,
            console::finish_setup,
            console::change_admin_password,
            console::system_status,
            console::remove_component,
            console::uninstall_everything,
            erase::erase_plan,
            erase::erase_nodes,
            erase::erase_this_pc,
            erase::quit_and_remove_helper,
            devices::create_pairing_code,
            devices::paired_devices,
            devices::revoke_device,
            devices::pair_local_desktop,
            devices::reset_local_pairing,
            fleet::fleet_status,
            fleet::fleet_start_service,
            fleet::fleet_stop_service,
            fleet::fleet_create_code,
            fleet::fleet_revoke,
            fleet::fleet_assign,
            fleet::fleet_install,
            fleet::fleet_rollback,
            fleet::fleet_cancel,
            fleet::fleet_command,
            fleet::fleet_link_ai,
            fleet::fleet_update_service,
            fleet::fleet_run,
            updates::updates_status,
            updates::apply_helper_update,
            updates::update_settings,
            updates::set_update_settings,
            backups::backup_status,
            backups::backup_disks,
            backups::backup_list,
            backups::backup_set_disk,
            backups::backup_schedule,
            backups::backup_run_now,
            backups::backup_restore,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Lefi Crop Helper");
}

/// Keeps the reason for an internal error where support can read it (stderr goes nowhere when the
/// app is opened from Finder). With `panic = "unwind"` one failed command does not end the app.
fn log_panics() {
    let default = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        if let Some(home) = std::env::var_os("HOME") {
            let dir = std::path::Path::new(&home).join("Library/Logs/Lefi Crop Helper");
            let _ = std::fs::create_dir_all(&dir);
            if let Ok(mut f) = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(dir.join("crash.log"))
            {
                use std::io::Write;
                let now = time::OffsetDateTime::now_utc().unix_timestamp();
                let ver = env!("CARGO_PKG_VERSION");
                let _ = writeln!(f, "{now} v{ver} {info}");
            }
        }
        default(info);
    }));
}

fn is_app_url(url: &url::Url) -> bool {
    let bundled = url.scheme() == "tauri" || url.host_str() == Some("tauri.localhost");
    let dev = cfg!(debug_assertions)
        && url.scheme() == "http"
        && url.host_str() == Some("127.0.0.1")
        && url.port() == Some(1430);
    bundled || dev
}

#[cfg(test)]
mod tests {
    /// A command the window may not call fails only at run time, in the packaged app ("not allowed
    /// by ACL"). These three lists must name the same commands.
    #[test]
    fn every_command_is_registered_declared_and_granted() {
        let quoted = |text: &str| -> std::collections::BTreeSet<String> {
            text.split('"')
                .skip(1)
                .step_by(2)
                .map(str::to_string)
                .collect()
        };
        let build = include_str!("../build.rs");
        let declared =
            quoted(&build[build.find(".commands(").unwrap()..build.find("]),").unwrap()]);

        let caps: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/default.json")).unwrap();
        let granted: std::collections::BTreeSet<String> = caps["permissions"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|p| p.as_str()?.strip_prefix("allow-"))
            .map(|p| p.replace('-', "_"))
            .collect();

        let lib = include_str!("lib.rs");
        let start = lib.find("generate_handler![").unwrap();
        let handler: std::collections::BTreeSet<String> = lib
            [start..lib[start..].find("])").unwrap() + start]
            .split(',')
            .filter_map(|l| l.trim().rsplit("::").next())
            .filter(|c| !c.is_empty() && !c.contains('!') && !c.contains('['))
            .map(str::to_string)
            .collect();

        assert_eq!(declared, granted, "build.rs and capabilities/default.json");
        assert_eq!(declared, handler, "build.rs and generate_handler!");
    }
}
