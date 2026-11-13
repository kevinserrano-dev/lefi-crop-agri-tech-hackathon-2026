//! The main PC's list of satellites and join codes (`<data>/fleet/registry.json`, mode 600).

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::error::{io, Error, Result};
use crate::protocol::{Heartbeat, ONLINE_SECS, STALE_SECS};

pub const CODE_TTL_SECS: u64 = 30 * 60;

/// Components a satellite may run. The Brain (`core`) and its gateway (`admin`) exist only on
/// the main PC (ADR-031), so they are never assignable here.
pub const SATELLITE_ROLES: &[&str] = &["ai", "desktop", "robot", "firmware"];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Node {
    pub id: String,
    /// The name Lefi gives this PC (`lefi-node-N`, ADR-042, ADR-050). `hostname` stays the computer's own.
    #[serde(default)]
    pub name: String,
    pub hostname: String,
    pub ip: String,
    pub os: String,
    pub arch: String,
    pub cert_fp: String,
    pub enrolled_at: u64,
    pub last_seen: Option<u64>,
    pub last_heartbeat: Option<Heartbeat>,
    pub assigned: Vec<String>,
    pub revoked: bool,
    /// Whether the main PC's Brain uses this PC's AI (set after its AI component is installed).
    #[serde(default)]
    pub ai_link: Option<AiLink>,
    /// When the main PC last sent this PC's Lefi Desktop a pairing offer (ADR-050).
    #[serde(default)]
    pub desktop_pair_at: Option<u64>,
    /// The last speed test of this PC's AI (a real generation, on request).
    #[serde(default)]
    pub ai_bench: Option<serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AiLink {
    pub url: String,
    /// linking · ok · failed
    pub state: String,
    pub code: Option<String>,
    pub model: Option<String>,
    pub gpu_pct: Option<u64>,
    pub message: String,
    pub at: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct JoinCode {
    pub hash: String,
    pub hint: String,
    pub created_at: u64,
    pub expires_at: u64,
    pub expected_ip: Option<String>,
    pub used_by: Option<String>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct Registry {
    pub nodes: Vec<Node>,
    pub codes: Vec<JoinCode>,
    #[serde(default)]
    pub commands: Vec<crate::jobs::CommandRecord>,
    #[serde(skip)]
    path: PathBuf,
}

/// online · stale · offline · never — computed from the main PC's clock (ADR-008).
pub fn connectivity(node: &Node, now: u64) -> &'static str {
    if node.revoked {
        return "revoked";
    }
    match node.last_seen {
        None => "never",
        Some(t) if now.saturating_sub(t) <= ONLINE_SECS => "online",
        Some(t) if now.saturating_sub(t) <= STALE_SECS => "stale",
        Some(_) => "offline",
    }
}

const CROCKFORD: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

fn random_bytes<const N: usize>() -> [u8; N] {
    let mut b = [0u8; N];
    getrandom::getrandom(&mut b).expect("OS random source");
    b
}

pub fn normalize_code(raw: &str) -> String {
    raw.chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| match c.to_ascii_uppercase() {
            'O' => '0',
            'I' | 'L' => '1',
            o => o,
        })
        .collect()
}

fn hash_code(normalized: &str) -> String {
    Sha256::digest(normalized.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

impl Registry {
    pub fn load(data_dir: &Path) -> Result<Self> {
        let path = data_dir.join("fleet").join("registry.json");
        let mut reg: Registry = match std::fs::read_to_string(&path) {
            Ok(text) => serde_json::from_str(&text)
                .map_err(|e| Error::new("REGISTRY_CORRUPT", e.to_string()))?,
            Err(_) => Registry::default(),
        };
        reg.path = path;
        let renamed = reg.rename_legacy();
        reg.name_unnamed();
        if renamed {
            reg.save()?;
        }
        Ok(reg)
    }

    /// `lefi-core-N` becomes `lefi-node-N` with the same number (ADR-050). True when one changed.
    fn rename_legacy(&mut self) -> bool {
        let mut changed = false;
        for n in &mut self.nodes {
            if let Some(new) = crate::names::renamed(&n.name) {
                n.name = new;
                changed = true;
            }
        }
        changed
    }

    /// PCs that joined before names existed get theirs in the order they joined.
    fn name_unnamed(&mut self) {
        for i in 0..self.nodes.len() {
            if self.nodes[i].name.is_empty() {
                let name = crate::names::next_node_name(self.nodes.iter().map(|n| n.name.as_str()));
                self.nodes[i].name = name;
            }
        }
    }

    pub fn save(&self) -> Result<()> {
        let dir = self.path.parent().expect("registry has a folder");
        std::fs::create_dir_all(dir).map_err(io("REGISTRY_WRITE"))?;
        let tmp = self.path.with_extension("json.tmp");
        let text = serde_json::to_vec_pretty(self)
            .map_err(|e| Error::new("REGISTRY_WRITE", e.to_string()))?;
        {
            use std::io::Write;
            let mut opts = std::fs::OpenOptions::new();
            opts.write(true).create(true).truncate(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                opts.mode(0o600);
            }
            let mut f = opts.open(&tmp).map_err(io("REGISTRY_WRITE"))?;
            f.write_all(&text).map_err(io("REGISTRY_WRITE"))?;
            f.sync_all().map_err(io("REGISTRY_WRITE"))?;
        }
        std::fs::rename(&tmp, &self.path).map_err(io("REGISTRY_WRITE"))
    }

    fn active_nodes(&self) -> usize {
        self.nodes.iter().filter(|n| !n.revoked).count()
    }

    /// A one-time join code `XXXX-XXXX` (40 bits, 30 minutes, single use; stored hashed).
    /// `max_pcs` is the licence limit including the main PC.
    pub fn new_code(
        &mut self,
        expected_ip: Option<String>,
        max_pcs: u32,
        now: u64,
    ) -> Result<(String, JoinCode)> {
        if self.active_nodes() + 1 >= max_pcs as usize {
            return Err(Error::new(
                "LICENCE_PC_LIMIT",
                format!(
                    "The licence covers {max_pcs} PC(s), the main PC included; all are in use."
                ),
            ));
        }
        let b = random_bytes::<5>();
        let mut bits: u64 = 0;
        for x in b {
            bits = (bits << 8) | u64::from(x);
        }
        let plain: String = (0..8)
            .rev()
            .map(|i| CROCKFORD[((bits >> (i * 5)) & 31) as usize] as char)
            .collect();
        let shown = format!("{}-{}", &plain[..4], &plain[4..]);
        let code = JoinCode {
            hash: hash_code(&plain),
            hint: plain[..2].to_string(),
            created_at: now,
            expires_at: now + CODE_TTL_SECS,
            expected_ip,
            used_by: None,
        };
        self.codes
            .retain(|c| c.used_by.is_none() && c.expires_at > now);
        self.codes.push(code.clone());
        Ok((shown, code))
    }

    /// Redeems a code for a PC at `peer_ip` and registers it. Wrong, expired, reused and
    /// wrong-PC codes all fail; the PC limit is checked again.
    #[allow(clippy::too_many_arguments)]
    pub fn enroll(
        &mut self,
        code: &str,
        peer_ip: &str,
        hostname: &str,
        os: &str,
        arch: &str,
        max_pcs: u32,
        now: u64,
        cert_for: impl FnOnce(&str) -> Result<(String, String)>,
    ) -> Result<(Node, String)> {
        let h = hash_code(&normalize_code(code));
        let idx = self
            .codes
            .iter()
            .position(|c| c.hash == h)
            .ok_or_else(|| Error::new("CODE_INVALID", "This join code is not valid."))?;
        let c = self.codes[idx].clone();
        if c.used_by.is_some() {
            return Err(Error::new("CODE_USED", "This join code was already used."));
        }
        if c.expires_at <= now {
            return Err(Error::new(
                "CODE_EXPIRED",
                "This join code has expired; create a new one on the main PC.",
            ));
        }
        if let Some(ip) = &c.expected_ip {
            if ip != peer_ip {
                return Err(Error::new(
                    "CODE_WRONG_PC",
                    format!("This code was created for the PC at {ip}."),
                ));
            }
        }
        if self.active_nodes() + 1 >= max_pcs as usize {
            return Err(Error::new(
                "LICENCE_PC_LIMIT",
                format!("The licence covers {max_pcs} PC(s); all are in use."),
            ));
        }
        let id = format!(
            "pc-{}",
            random_bytes::<3>()
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect::<String>()
        );
        let (cert_pem, cert_fp) = cert_for(&id)?;
        let node = Node {
            name: crate::names::next_node_name(self.nodes.iter().map(|n| n.name.as_str())),
            id: id.clone(),
            hostname: hostname.chars().take(64).collect(),
            ip: peer_ip.to_string(),
            os: os.chars().take(32).collect(),
            arch: arch.chars().take(16).collect(),
            cert_fp,
            enrolled_at: now,
            last_seen: None,
            last_heartbeat: None,
            assigned: vec![],
            revoked: false,
            ai_link: None,
            desktop_pair_at: None,
            ai_bench: None,
        };
        self.codes[idx].used_by = Some(id);
        self.nodes.push(node.clone());
        Ok((node, cert_pem))
    }

    /// A heartbeat from the PC holding the certificate `cert_fp`.
    pub fn heartbeat(
        &mut self,
        cert_fp: &str,
        peer_ip: &str,
        hb: Heartbeat,
        now: u64,
    ) -> Result<Node> {
        let node = self
            .nodes
            .iter_mut()
            .find(|n| n.cert_fp == cert_fp)
            .ok_or_else(|| {
                Error::new("NODE_UNKNOWN", "This PC is not registered on the main PC.")
            })?;
        if node.revoked {
            return Err(Error::new(
                "NODE_REVOKED",
                "This PC was removed on the main PC.",
            ));
        }
        node.last_seen = Some(now);
        node.ip = peer_ip.to_string();
        node.hostname = hb.hostname.chars().take(64).collect();
        node.last_heartbeat = Some(hb);
        Ok(node.clone())
    }

    pub fn revoke(&mut self, id: &str) -> Result<()> {
        let n = self
            .nodes
            .iter_mut()
            .find(|n| n.id == id)
            .ok_or_else(|| Error::new("NODE_UNKNOWN", "No such PC."))?;
        n.revoked = true;
        n.assigned.clear();
        Ok(())
    }

    /// Records which components a satellite should run. `core`/`admin` are main-PC only; the
    /// AI may be assigned to one satellite at most (the Brain uses a single AI node).
    pub fn assign(&mut self, id: &str, roles: &[String]) -> Result<Node> {
        for r in roles {
            if r == "core" || r == "admin" {
                return Err(Error::new(
                    "BRAIN_ONLY_ON_MAIN",
                    "Lefi Brain and its gateway run only on the main PC.",
                ));
            }
            if !SATELLITE_ROLES.contains(&r.as_str()) {
                return Err(Error::new(
                    "ROLE_UNKNOWN",
                    format!("Unknown component '{r}'."),
                ));
            }
        }
        if roles.iter().any(|r| r == "ai")
            && self
                .nodes
                .iter()
                .any(|n| n.id != id && !n.revoked && n.assigned.iter().any(|r| r == "ai"))
        {
            return Err(Error::new(
                "AI_ALREADY_ASSIGNED",
                "Another PC already has the AI component.",
            ));
        }
        let n = self
            .nodes
            .iter_mut()
            .find(|n| n.id == id)
            .ok_or_else(|| Error::new("NODE_UNKNOWN", "No such PC."))?;
        if n.revoked {
            return Err(Error::new("NODE_REVOKED", "This PC was removed."));
        }
        let mut uniq: Vec<String> = Vec::new();
        for r in roles {
            if !uniq.contains(r) {
                uniq.push(r.clone());
            }
        }
        n.assigned = uniq;
        Ok(n.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reg() -> Registry {
        Registry {
            path: std::env::temp_dir().join("unused.json"),
            ..Default::default()
        }
    }
    fn fake_cert(id: &str) -> Result<(String, String)> {
        Ok((format!("PEM-{id}"), format!("fp-{id}")))
    }
    fn join(r: &mut Registry, code: &str, ip: &str, now: u64) -> Result<(Node, String)> {
        r.enroll(code, ip, "fake-host", "macos", "aarch64", 3, now, fake_cert)
    }

    #[test]
    fn codes_are_single_use_expire_and_can_be_bound_to_an_ip() {
        let mut r = reg();
        let (code, _) = r.new_code(None, 3, 1000).unwrap();
        assert_eq!(code.len(), 9);
        assert_eq!(
            join(&mut r, "WRONG-CODE", "10.0.0.2", 1001)
                .unwrap_err()
                .code,
            "CODE_INVALID"
        );
        let (node, pem) = join(&mut r, &code.to_lowercase(), "10.0.0.2", 1001).unwrap();
        assert_eq!(pem, format!("PEM-{}", node.id));
        assert_eq!(
            join(&mut r, &code, "10.0.0.3", 1002).unwrap_err().code,
            "CODE_USED"
        );

        let (late, _) = r.new_code(None, 3, 2000).unwrap();
        assert_eq!(
            join(&mut r, &late, "10.0.0.4", 2000 + CODE_TTL_SECS)
                .unwrap_err()
                .code,
            "CODE_EXPIRED"
        );

        let (bound, _) = r.new_code(Some("10.0.0.9".into()), 3, 3000).unwrap();
        assert_eq!(
            join(&mut r, &bound, "10.0.0.8", 3001).unwrap_err().code,
            "CODE_WRONG_PC"
        );
        assert!(join(&mut r, &bound, "10.0.0.9", 3002).is_ok());
    }

    #[test]
    fn each_pc_gets_a_lefi_name_and_a_removed_number_is_not_reused() {
        let mut r = reg();
        let (c1, _) = r.new_code(None, 5, 0).unwrap();
        let (a, _) = join(&mut r, &c1, "10.0.0.2", 1).unwrap();
        let (c2, _) = r.new_code(None, 5, 2).unwrap();
        let (b, _) = join(&mut r, &c2, "10.0.0.3", 3).unwrap();
        assert_eq!(
            (a.name.as_str(), b.name.as_str()),
            ("lefi-node-1", "lefi-node-2")
        );
        r.revoke(&b.id).unwrap();
        let (c3, _) = r.new_code(None, 5, 4).unwrap();
        let (d, _) = join(&mut r, &c3, "10.0.0.4", 5).unwrap();
        assert_eq!(d.name, "lefi-node-3");
        assert_eq!(a.hostname, "fake-host", "the computer's own name stays");
    }

    #[test]
    fn a_registry_from_before_names_gets_them_on_load() {
        let d = tempfile::tempdir().unwrap();
        let mut r = Registry::load(d.path()).unwrap();
        let (c, _) = r.new_code(None, 3, 0).unwrap();
        join(&mut r, &c, "10.0.0.2", 0).unwrap();
        r.nodes[0].name.clear();
        r.save().unwrap();
        assert_eq!(
            Registry::load(d.path()).unwrap().nodes[0].name,
            "lefi-node-1"
        );
    }

    #[test]
    fn old_core_names_become_node_names_with_the_same_number() {
        let d = tempfile::tempdir().unwrap();
        let mut r = Registry::load(d.path()).unwrap();
        let (c, _) = r.new_code(None, 3, 0).unwrap();
        join(&mut r, &c, "10.0.0.2", 0).unwrap();
        r.nodes[0].name = "lefi-core-4".into();
        r.save().unwrap();
        let again = Registry::load(d.path()).unwrap();
        assert_eq!(again.nodes[0].name, "lefi-node-4");
        // Saved, so the next load reads the new name directly.
        let text = std::fs::read_to_string(d.path().join("fleet/registry.json")).unwrap();
        assert!(text.contains("lefi-node-4") && !text.contains("lefi-core-4"));
    }

    #[test]
    fn licence_limit_counts_the_main_pc() {
        let mut r = reg();
        let (c1, _) = r.new_code(None, 2, 0).unwrap();
        join(&mut r, &c1, "10.0.0.2", 1).unwrap();
        assert_eq!(r.new_code(None, 2, 2).unwrap_err().code, "LICENCE_PC_LIMIT");
        let id = r.nodes[0].id.clone();
        r.revoke(&id).unwrap();
        assert!(
            r.new_code(None, 2, 3).is_ok(),
            "a removed PC frees its place"
        );
    }

    #[test]
    fn heartbeats_connectivity_and_revocation() {
        let mut r = reg();
        let (c, _) = r.new_code(None, 3, 0).unwrap();
        let (n, _) = join(&mut r, &c, "10.0.0.2", 0).unwrap();
        assert_eq!(connectivity(&r.nodes[0], 5), "never");
        let hb = Heartbeat {
            hostname: "renamed".into(),
            ..Default::default()
        };
        r.heartbeat(&n.cert_fp, "10.0.0.5", hb.clone(), 100)
            .unwrap();
        assert_eq!(r.nodes[0].ip, "10.0.0.5");
        assert_eq!(connectivity(&r.nodes[0], 100 + ONLINE_SECS), "online");
        assert_eq!(connectivity(&r.nodes[0], 100 + STALE_SECS), "stale");
        assert_eq!(connectivity(&r.nodes[0], 100 + STALE_SECS + 1), "offline");
        assert_eq!(
            r.heartbeat("fp-unknown", "x", hb.clone(), 101)
                .unwrap_err()
                .code,
            "NODE_UNKNOWN"
        );
        r.revoke(&n.id).unwrap();
        assert_eq!(
            r.heartbeat(&n.cert_fp, "x", hb, 102).unwrap_err().code,
            "NODE_REVOKED"
        );
    }

    #[test]
    fn the_brain_stays_on_the_main_pc_and_the_ai_on_one_pc() {
        let mut r = reg();
        let (c1, _) = r.new_code(None, 4, 0).unwrap();
        let (a, _) = join(&mut r, &c1, "10.0.0.2", 0).unwrap();
        let (c2, _) = r.new_code(None, 4, 0).unwrap();
        let (b, _) = join(&mut r, &c2, "10.0.0.3", 0).unwrap();
        assert_eq!(
            r.assign(&a.id, &["core".into()]).unwrap_err().code,
            "BRAIN_ONLY_ON_MAIN"
        );
        assert_eq!(
            r.assign(&a.id, &["admin".into()]).unwrap_err().code,
            "BRAIN_ONLY_ON_MAIN"
        );
        assert_eq!(
            r.assign(&a.id, &["shell".into()]).unwrap_err().code,
            "ROLE_UNKNOWN"
        );
        r.assign(&a.id, &["ai".into(), "ai".into()]).unwrap();
        assert_eq!(r.nodes[0].assigned, vec!["ai".to_string()]);
        assert_eq!(
            r.assign(&b.id, &["ai".into()]).unwrap_err().code,
            "AI_ALREADY_ASSIGNED"
        );
        assert!(r.assign(&b.id, &["desktop".into()]).is_ok());
    }

    #[test]
    fn registry_round_trips_on_disk_with_private_mode() {
        let dir = tempfile::tempdir().unwrap();
        let mut r = Registry::load(dir.path()).unwrap();
        let (c, _) = r.new_code(None, 3, 0).unwrap();
        join(&mut r, &c, "10.0.0.2", 0).unwrap();
        r.save().unwrap();
        let back = Registry::load(dir.path()).unwrap();
        assert_eq!(back.nodes, r.nodes);
        assert!(
            !std::fs::read_to_string(dir.path().join("fleet/registry.json"))
                .unwrap()
                .contains(&normalize_code(&c))
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let m = std::fs::metadata(dir.path().join("fleet/registry.json"))
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(m & 0o777, 0o600);
        }
    }
}
