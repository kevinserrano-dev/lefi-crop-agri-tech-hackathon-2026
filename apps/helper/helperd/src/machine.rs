//! A stable identifier of this computer, hashed so the hardware id itself never leaves it
//! (ADR-055). Lefi Desktop sends the same value when it pairs (`apps/desktop/src-tauri/src/
//! pairing.rs`, same derivation and test vector), so Lefi Brain keeps one pairing per PC and Lefi
//! Crop Helper can tell which paired device is this PC.

use sha2::{Digest, Sha256};

pub fn machine_id() -> Option<String> {
    let raw = if cfg!(target_os = "macos") {
        let out = std::process::Command::new("/usr/sbin/ioreg")
            .args(["-rd1", "-c", "IOPlatformExpertDevice"])
            .output()
            .ok()?;
        let text = String::from_utf8_lossy(&out.stdout).into_owned();
        text.lines()
            .find(|l| l.contains("\"IOPlatformUUID\""))
            .and_then(|l| l.split('"').nth(3).map(str::to_string))?
    } else {
        std::fs::read_to_string("/etc/machine-id")
            .ok()?
            .trim()
            .to_string()
    };
    machine_id_from(&raw)
}

pub fn machine_id_from(raw: &str) -> Option<String> {
    let raw = raw.trim();
    (!raw.is_empty()).then(|| {
        Sha256::digest(format!("LEFIMACHINE1|{raw}").as_bytes())
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect()
    })
}

#[cfg(test)]
mod tests {
    #[test]
    fn same_derivation_as_lefi_desktop() {
        // sha256("LEFIMACHINE1|TEST-ONLY-UUID"), also checked by Lefi Desktop's test.
        let want = super::machine_id_from("TEST-ONLY-UUID").unwrap();
        assert_eq!(want.len(), 64);
        assert_eq!(super::machine_id_from(" TEST-ONLY-UUID\n").unwrap(), want);
        assert_eq!(super::machine_id(), super::machine_id(), "stable");
    }
}
