//! Lefi names on the network (ADR-042, ADR-050): the main PC is `lefi-main`, the others `lefi-node-N`. The
//! computer's own name is never changed: `dns-sd -P` announces `<name>.local` for this PC's address
//! while the service runs, and needs no privileges. Announcing opens no port on this PC.

use std::process::Stdio;

pub const MAIN_NAME: &str = "lefi-main";
const SERVICE: &str = "_lefi._tcp";
/// Lefi Brain's gateway, announced by the main PC only when Lefi Gateway serves HTTPS there (ADR-047).
/// Lefi Desktop browses for it; the answer is never trusted by itself (pairing pins the CA).
pub const BRAIN_SERVICE: &str = "_lefi-brain._tcp";
pub const BRAIN_INSTANCE: &str = "Lefi Brain";

const NODE_PREFIX: &str = "lefi-node-";
/// Names given before ADR-050 ("core" is the Brain's role, which never runs on these PCs).
const LEGACY_PREFIX: &str = "lefi-core-";

fn number(name: &str) -> Option<u32> {
    name.strip_prefix(NODE_PREFIX)
        .or_else(|| name.strip_prefix(LEGACY_PREFIX))?
        .parse()
        .ok()
}

/// `lefi-node-N`, N one more than any name given before (old `lefi-core-N` included): a removed
/// PC's number is never reused, so old logs and audit records keep pointing at one PC.
pub fn next_node_name<'a>(existing: impl Iterator<Item = &'a str>) -> String {
    let max = existing.filter_map(number).max().unwrap_or(0);
    format!("{NODE_PREFIX}{}", max + 1)
}

/// `lefi-core-N` → `lefi-node-N`, same number (ADR-050). `None` for any other name.
pub fn renamed(name: &str) -> Option<String> {
    let n: u32 = name.strip_prefix(LEGACY_PREFIX)?.parse().ok()?;
    Some(format!("{NODE_PREFIX}{n}"))
}

pub fn valid_name(n: &str) -> bool {
    !n.is_empty()
        && n.len() <= 63
        && n.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

pub fn dns_sd_args(name: &str, ip: &str, port: u16) -> Vec<String> {
    vec![
        "-P".into(),
        name.into(),
        SERVICE.into(),
        "local".into(),
        port.to_string(),
        format!("{name}.local"),
        ip.into(),
    ]
}

/// `_lefi-brain._tcp` on the main PC's Lefi name: same host record as [`dns_sd_args`].
pub fn brain_dns_sd_args(ip: &str, port: u16) -> Vec<String> {
    vec![
        "-P".into(),
        BRAIN_INSTANCE.into(),
        BRAIN_SERVICE.into(),
        "local".into(),
        port.to_string(),
        format!("{MAIN_NAME}.local"),
        ip.into(),
        "v=1".into(),
        "health=/api/v1/health".into(),
    ]
}

/// The port of Lefi Gateway when this PC runs Lefi Brain behind it over HTTPS (core + admin roles and
/// an `https://` `LEFI_ADMIN_URL` in the installation's configuration). `None` otherwise: nothing to announce.
pub fn brain_gateway_port(env_text: &str) -> Option<u16> {
    let last = |key: &str| {
        env_text
            .lines()
            .filter_map(|l| l.strip_prefix(key)?.strip_prefix('='))
            .next_back()
            .map(|v| v.trim().trim_matches('"').to_string())
    };
    let roles = last("LEFI_ROLES")?;
    let has = |r: &str| roles.split(',').any(|x| x.trim() == r);
    if !(has("core") && has("admin")) {
        return None;
    }
    let url = last("LEFI_ADMIN_URL")?;
    let authority = url.strip_prefix("https://")?.split('/').next()?;
    match authority.rsplit_once(':') {
        Some((_, port)) if !port.is_empty() && port.bytes().all(|b| b.is_ascii_digit()) => {
            port.parse().ok()
        }
        _ => Some(443),
    }
}

/// Keeps one `dns-sd` running for this PC's current name and address.
#[derive(Default)]
pub struct Publisher {
    child: Option<tokio::process::Child>,
    current: Option<Vec<String>>,
}

impl Publisher {
    /// Starts or restarts the announcement if the name or address changed, or if it stopped.
    pub fn publish(&mut self, name: &str, ip: &str, port: u16) {
        if !valid_name(name) {
            return;
        }
        self.run(dns_sd_args(name, ip, port));
    }

    /// Announces Lefi Brain's gateway, or stops announcing it (`port: None`).
    pub fn publish_brain(&mut self, ip: &str, port: Option<u16>) {
        match port {
            Some(port) => self.run(brain_dns_sd_args(ip, port)),
            None => {
                self.child = None; // kill_on_drop ends the announcement
                self.current = None;
            }
        }
    }

    fn run(&mut self, args: Vec<String>) {
        if !cfg!(target_os = "macos") {
            return;
        }
        let name = args.get(1).cloned().unwrap_or_default();
        let want = args.clone();
        let alive = self
            .child
            .as_mut()
            .is_some_and(|c| matches!(c.try_wait(), Ok(None)));
        if alive && self.current.as_ref() == Some(&want) {
            return;
        }
        self.child = tokio::process::Command::new("dns-sd")
            .args(&args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| eprintln!("cannot announce {name}: {e}"))
            .ok();
        self.current = Some(want);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lefi_brain_is_announced_only_with_an_https_gateway_next_to_it() {
        let env = "LEFI_ROLES=ai,core,admin\nLEFI_ADMIN_URL=https://192.0.2.10:8443\n";
        assert_eq!(brain_gateway_port(env), Some(8443));
        assert_eq!(
            brain_gateway_port("LEFI_ROLES=core,admin\nLEFI_ADMIN_URL=http://192.0.2.10:8080"),
            None
        );
        assert_eq!(
            brain_gateway_port("LEFI_ROLES=ai,admin\nLEFI_ADMIN_URL=https://192.0.2.10:8443"),
            None
        );
        assert_eq!(brain_gateway_port("LEFI_ROLES=core\n"), None);
        assert_eq!(brain_gateway_port(""), None);
        assert_eq!(
            brain_dns_sd_args("10.0.0.2", 8443),
            [
                "-P",
                "Lefi Brain",
                "_lefi-brain._tcp",
                "local",
                "8443",
                "lefi-main.local",
                "10.0.0.2",
                "v=1",
                "health=/api/v1/health"
            ]
        );
    }

    #[test]
    fn numbers_grow_and_are_never_reused() {
        assert_eq!(next_node_name([].into_iter()), "lefi-node-1");
        assert_eq!(
            next_node_name(["lefi-node-1", "lefi-core-5", "x", ""].into_iter()),
            "lefi-node-6"
        );
        assert_eq!(renamed("lefi-core-12").as_deref(), Some("lefi-node-12"));
        assert_eq!(renamed("lefi-main"), None);
        assert_eq!(renamed("lefi-core-x"), None);
    }

    #[test]
    fn only_safe_names_reach_the_command() {
        assert!(valid_name("lefi-node-12"));
        assert!(!valid_name("a b"));
        assert!(!valid_name("-P;x"));
        assert_eq!(
            dns_sd_args("lefi-main", "10.0.0.2", 8790),
            [
                "-P",
                "lefi-main",
                "_lefi._tcp",
                "local",
                "8790",
                "lefi-main.local",
                "10.0.0.2"
            ]
        );
    }
}
