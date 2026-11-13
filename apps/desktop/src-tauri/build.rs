fn main() {
    // Only the commands listed here can be granted to the WebView (minimal capabilities).
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "api_request",
            "discover_brain",
            "find_brains",
            "device_identity",
            "pair_device",
            "forget_pairing",
            "pairing_status",
            "secret_get",
            "secret_set",
            "secret_del",
            "camera_stream",
            "camera_stream_stop",
            "robot_stream",
        ]),
    ))
    .expect("failed to run tauri-build");
}
