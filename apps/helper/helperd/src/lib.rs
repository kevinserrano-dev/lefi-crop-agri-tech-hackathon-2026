//! `lefi-helperd` — the Lefi Crop Helper service (ADR-031, ADR-033).
//! One program, two modes: `main` on the Brain PC (join page, enrolment, heartbeats, console
//! API) and `satellite` on the other PCs (heartbeats only, outbound mTLS).

pub mod backup;
pub mod ca;
pub mod error;
pub mod executor;
pub mod jobs;
pub mod licence;
pub mod machine;
pub mod main_node;
pub mod names;
pub mod protocol;
pub mod registry;
pub mod report;
pub mod robot_host;
pub mod satellite;
pub mod service;
pub mod session;
pub mod traces;

/// This service's version: the app restarts a service older than the one it carries.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// reqwest/rustls need a process-wide crypto provider (ring, no C toolchain).
pub fn init_crypto() {
    let _ = rustls::crypto::ring::default_provider().install_default();
}
