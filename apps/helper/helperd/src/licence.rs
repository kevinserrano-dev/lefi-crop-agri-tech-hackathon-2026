//! The main PC runs only when Lefi Crop Helper has activated it (ADR-027/031): same keys, same check.

use std::path::Path;

use lefi_license::{installation_id, parse_public_key, verify, Licence};

use crate::ca::der_from_pem;
use crate::error::{Error, Result};

const PRODUCTION_PUB: &str = include_str!("../../src-tauri/keys/production.pub");
const DEV_PUB: &str = include_str!("../../../../tools/lefi-license/dev-key/dev-signing.pub");

pub fn trusted_keys() -> Vec<lefi_license::VerifyingKey> {
    let mut keys: Vec<_> = parse_public_key(PRODUCTION_PUB).into_iter().collect();
    // Debug builds and the hackathon build (its Lefi Crop Helper activates with this key).
    if cfg!(debug_assertions) || cfg!(feature = "hackathon") {
        keys.extend(parse_public_key(DEV_PUB));
    }
    keys
}

/// The installation id and the verified licence of the Lefi Crop Helper data folder `data_dir`.
pub fn load(data_dir: &Path, root_ca_pem: &str) -> Result<(String, Licence)> {
    let id = installation_id(&der_from_pem(root_ca_pem)?);
    let code = std::fs::read_to_string(data_dir.join("licence.code")).map_err(|_| {
        Error::new(
            "NOT_ACTIVATED",
            "This PC is not activated: open Lefi Crop Helper and enter the activation code.",
        )
    })?;
    let licence =
        verify(&code, &trusted_keys(), &id).map_err(|e| Error::new(e.code(), e.to_string()))?;
    Ok((id, licence))
}
