//! Commands from the main PC to satellites (ADR-033, slice 2): queued in the console, delivered
//! once in a heartbeat response, progress folded from the installer's own events.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::{Error, Result};
use crate::protocol::{
    is_newer, Command, CommandEvents, PairingOffer, ServiceUpdate, COMMAND_TTL_SECS,
};
use crate::registry::Registry;

/// Assigned components that the installer can put on a satellite (ADR-034: `desktop` = Lefi
/// Desktop, copied from the payload; macOS only for now).
pub const INSTALLABLE: &[&str] = &["ai", "robot", "firmware", "desktop"];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CommandRecord {
    pub command: Command,
    /// queued · delivered · running · ok · failed · cancelled · expired
    pub state: String,
    pub cancel_requested: bool,
    pub created_at: u64,
    pub updated_at: u64,
    pub steps_done: u64,
    pub steps_total: u64,
    pub current_step: Option<String>,
    pub exit_code: Option<i32>,
    pub error: Option<String>,
    /// rollback.done result (ok · partial · nothing), when the run rolled back.
    pub rollback_result: Option<String>,
    /// `erase`: what an administrator of that PC must still run (a root-owned boot service file).
    #[serde(default)]
    pub leftover: Option<String>,
}

impl CommandRecord {
    pub fn active(&self) -> bool {
        matches!(self.state.as_str(), "queued" | "delivered" | "running")
    }
}

fn random_id() -> String {
    let mut b = [0u8; 8];
    getrandom::getrandom(&mut b).expect("OS random source");
    format!(
        "cmd-{}",
        b.iter().map(|x| format!("{x:02x}")).collect::<String>()
    )
}

/// The first service version that understands `erase` (ADR-054).
pub const ERASE_MIN_VERSION: &str = "0.5.0";

/// The first service version that can replace itself with the main PC's program (ADR-062).
/// Older ones are updated once by hand with the `update.sh` command.
pub const SELF_UPDATE_MIN_VERSION: &str = "0.5.9";

/// `a.b.c` ≥ `min`, numerically; anything else is not.
pub fn version_at_least(v: &str, min: &str) -> bool {
    let parse = |s: &str| -> Option<Vec<u64>> {
        let p: Option<Vec<u64>> = s.split('.').map(|x| x.parse().ok()).collect();
        p.filter(|p| p.len() == 3)
    };
    matches!((parse(v), parse(min)), (Some(a), Some(b)) if a >= b)
}

/// The answers file for a satellite (format: deploy/install/answers.example). The Brain runs on
/// the main PC, so an AI satellite listens on the LAN for it.
pub fn render_answers(roles: &[String]) -> String {
    let mut out =
        String::from("# Rendered by the Lefi Crop Helper main PC for a satellite (ADR-033)\n");
    out.push_str(&format!("ROLES={}\nCONTINUE=yes\n", roles.join(",")));
    if roles.iter().any(|r| r == "ai") {
        out.push_str("MODEL=recommended\nAI_LAN=yes\nINSTALL_OLLAMA=yes\nSTOP_FOREIGN_OLLAMA=yes\nUPDATE_MODEL=no\n");
    }
    out.push_str("INSTALL_HOMEBREW=yes\nINSTALL_CLI=yes\nDEV_ALLOW_NO_AI=no\n");
    out
}

impl Registry {
    fn node_ok(&self, node_id: &str) -> Result<()> {
        let n = self
            .nodes
            .iter()
            .find(|n| n.id == node_id)
            .ok_or_else(|| Error::new("NODE_UNKNOWN", "No such PC."))?;
        if n.revoked {
            return Err(Error::new("NODE_REVOKED", "This PC was removed."));
        }
        Ok(())
    }

    pub fn active_command(&self, node_id: &str) -> Option<&CommandRecord> {
        self.commands
            .iter()
            .find(|c| c.command.node_id == node_id && c.active())
    }

    pub fn last_command(&self, node_id: &str) -> Option<&CommandRecord> {
        self.commands
            .iter()
            .rev()
            .find(|c| c.command.node_id == node_id)
    }

    /// The last real install on this PC, for "Undo": other commands may have run since.
    pub fn last_install(&self, node_id: &str) -> Option<&CommandRecord> {
        self.commands.iter().rev().find(|c| {
            c.command.node_id == node_id && c.command.kind == "install" && !c.command.dry_run
        })
    }

    pub fn queue(
        &mut self,
        node_id: &str,
        kind: &str,
        dry_run: bool,
        payload_sha256: &str,
        now: u64,
    ) -> Result<CommandRecord> {
        self.queue_spec(node_id, kind, dry_run, None, None, payload_sha256, now)
    }

    /// Queues a command from the allowlist (ADR-040): install the assigned components or only
    /// `only`, undo the last install, remove a component, control the AI service, or measure the
    /// AI. One active command per PC. There is no way to send anything else.
    #[allow(clippy::too_many_arguments)]
    pub fn queue_spec(
        &mut self,
        node_id: &str,
        kind: &str,
        dry_run: bool,
        only: Option<&[String]>,
        action: Option<&str>,
        payload_sha256: &str,
        now: u64,
    ) -> Result<CommandRecord> {
        self.node_ok(node_id)?;
        // An older service cannot load services nor understand the newer commands: an install
        // through it would stop a running AI and leave it stopped (seen on the owner's Mac).
        let node = self
            .nodes
            .iter()
            .find(|n| n.id == node_id)
            .expect("checked");
        if node
            .last_heartbeat
            .as_ref()
            .is_some_and(|h| h.report.is_none())
        {
            return Err(Error::new(
                "SERVICE_OUTDATED",
                "The Lefi Crop Helper service on this PC is older than this main PC. Update it first: its /setup page shows the command.",
            ));
        }
        if kind == "erase"
            && !node
                .last_heartbeat
                .as_ref()
                .is_some_and(|h| version_at_least(&h.helperd_version, ERASE_MIN_VERSION))
        {
            return Err(Error::new(
                "SERVICE_OUTDATED",
                "The Lefi Crop Helper service on this PC is too old to erase it. Update it first: its /setup page shows the command.",
            ));
        }
        if self.active_command(node_id).is_some() {
            return Err(Error::new(
                "COMMAND_BUSY",
                "This PC is already running a command.",
            ));
        }
        if payload_sha256.is_empty() {
            return Err(Error::new(
                "PAYLOAD_MISSING",
                "This main PC has no installer files to send (start the service with --payload-root).",
            ));
        }
        // A rollback undoes the PC's last real install command (every run it made).
        let target = if kind == "rollback" {
            self.commands
                .iter()
                .rev()
                .find(|c| {
                    c.command.node_id == node_id
                        && c.command.kind == "install"
                        && !c.command.dry_run
                })
                .map(|c| c.command.id.clone())
        } else {
            None
        };
        let (roles, answers) = match kind {
            "ai_bench" => (vec!["ai".to_string()], String::new()),
            "service" => {
                if !matches!(action, Some("start" | "stop" | "restart" | "off" | "on")) {
                    return Err(Error::new("BAD_REQUEST", "Unknown service action."));
                }
                (vec!["ai".to_string()], String::new())
            }
            "remove" => {
                let r = only.unwrap_or_default();
                if !matches!(r, [x] if x == "ai" || x == "desktop") {
                    return Err(Error::new(
                        "REMOVE_UNSUPPORTED",
                        "Only the AI node and Lefi Desktop can be removed from here for now.",
                    ));
                }
                (r.to_vec(), String::new())
            }
            "install" => {
                let node = self
                    .nodes
                    .iter()
                    .find(|n| n.id == node_id)
                    .expect("checked");
                let roles: Vec<String> = node
                    .assigned
                    .iter()
                    .filter(|r| INSTALLABLE.contains(&r.as_str()))
                    .filter(|r| only.is_none_or(|o| o.contains(r)))
                    .cloned()
                    .collect();
                if roles.is_empty() {
                    return Err(Error::new(
                        "NOTHING_TO_INSTALL",
                        "No component is assigned to this PC yet.",
                    ));
                }
                let answers = render_answers(&roles);
                (roles, answers)
            }
            "rollback" | "erase" => (vec![], String::new()),
            _ => return Err(Error::new("BAD_REQUEST", "Unknown command.")),
        };
        let rec = CommandRecord {
            command: Command {
                id: random_id(),
                node_id: node_id.to_string(),
                kind: kind.to_string(),
                roles,
                dry_run: dry_run && kind == "install",
                answers,
                payload_sha256: payload_sha256.to_string(),
                issued_at: now,
                expires_at: now + COMMAND_TTL_SECS,
                target_command: target,
                action: action.map(str::to_string),
                pairing: None,
                service_update: None,
            },
            state: "queued".into(),
            cancel_requested: false,
            created_at: now,
            updated_at: now,
            steps_done: 0,
            steps_total: 0,
            current_step: None,
            exit_code: None,
            error: None,
            rollback_result: None,
            leftover: None,
        };
        self.commands.push(rec.clone());
        // Keep the history bounded.
        if self.commands.len() > 200 {
            let drop = self.commands.len() - 200;
            self.commands.drain(..drop);
        }
        Ok(rec)
    }

    /// Hands this PC's Lefi Desktop a one-time pairing offer (ADR-050). Needs no installer payload.
    pub fn queue_desktop_pair(
        &mut self,
        node_id: &str,
        offer: PairingOffer,
        now: u64,
    ) -> Result<CommandRecord> {
        self.node_ok(node_id)?;
        if !offer.valid() {
            return Err(Error::new("BAD_REQUEST", "Invalid pairing offer."));
        }
        if self.active_command(node_id).is_some() {
            return Err(Error::new(
                "COMMAND_BUSY",
                "This PC is already running a command.",
            ));
        }
        let rec = CommandRecord {
            command: Command {
                id: random_id(),
                node_id: node_id.to_string(),
                kind: "desktop_pair".into(),
                roles: vec!["desktop".into()],
                dry_run: false,
                answers: String::new(),
                payload_sha256: String::new(),
                issued_at: now,
                expires_at: now + COMMAND_TTL_SECS,
                target_command: None,
                action: None,
                pairing: Some(offer),
                service_update: None,
            },
            state: "queued".into(),
            cancel_requested: false,
            created_at: now,
            updated_at: now,
            steps_done: 0,
            steps_total: 0,
            current_step: None,
            exit_code: None,
            error: None,
            rollback_result: None,
            leftover: None,
        };
        self.commands.push(rec.clone());
        Ok(rec)
    }

    /// Asks this PC's service to replace itself with the main PC's program (ADR-062). Only a
    /// service that understands the command gets it; an older one is updated once by hand.
    pub fn queue_service_update(
        &mut self,
        node_id: &str,
        update: ServiceUpdate,
        now: u64,
    ) -> Result<CommandRecord> {
        self.node_ok(node_id)?;
        if !update.valid() {
            return Err(Error::new(
                "BAD_REQUEST",
                "This main PC has no valid service program to share.",
            ));
        }
        let node = self
            .nodes
            .iter()
            .find(|n| n.id == node_id)
            .expect("checked");
        let Some(hb) = node.last_heartbeat.as_ref() else {
            return Err(Error::new(
                "NODE_OFFLINE",
                "This PC has not reported yet: its version is not known.",
            ));
        };
        if !is_newer(&update.version, &hb.helperd_version) {
            return Err(Error::new(
                "UP_TO_DATE",
                "The Lefi Crop Helper service on this PC is already up to date.",
            ));
        }
        if !version_at_least(&hb.helperd_version, SELF_UPDATE_MIN_VERSION) {
            return Err(Error::new(
                "SERVICE_OUTDATED",
                "The Lefi Crop Helper service on this PC is too old to update itself. Update it once on that PC: its page shows the command.",
            ));
        }
        if self.active_command(node_id).is_some() {
            return Err(Error::new(
                "COMMAND_BUSY",
                "This PC is already running a command.",
            ));
        }
        let rec = CommandRecord {
            command: Command {
                id: random_id(),
                node_id: node_id.to_string(),
                kind: "update_service".into(),
                roles: vec![],
                dry_run: false,
                answers: String::new(),
                payload_sha256: String::new(),
                issued_at: now,
                expires_at: now + COMMAND_TTL_SECS,
                target_command: None,
                action: None,
                pairing: None,
                service_update: Some(update),
            },
            state: "queued".into(),
            cancel_requested: false,
            created_at: now,
            updated_at: now,
            steps_done: 0,
            steps_total: 0,
            current_step: None,
            exit_code: None,
            error: None,
            rollback_result: None,
            leftover: None,
        };
        self.commands.push(rec.clone());
        Ok(rec)
    }

    /// The command to hand to this node in its heartbeat response (once).
    pub fn take_command(&mut self, node_id: &str, now: u64) -> Option<Command> {
        let rec = self
            .commands
            .iter_mut()
            .find(|c| c.command.node_id == node_id && c.state == "queued")?;
        if rec.command.expires_at <= now {
            rec.state = "expired".into();
            rec.updated_at = now;
            return None;
        }
        rec.state = "delivered".into();
        rec.updated_at = now;
        Some(rec.command.clone())
    }

    /// Progress from a satellite. Returns whether the console asked to cancel.
    pub fn record_events(
        &mut self,
        node_id: &str,
        cmd_id: &str,
        batch: &CommandEvents,
        now: u64,
    ) -> Result<bool> {
        let rec = self
            .commands
            .iter_mut()
            .find(|c| c.command.id == cmd_id)
            .ok_or_else(|| Error::new("COMMAND_UNKNOWN", "Unknown command."))?;
        if rec.command.node_id != node_id {
            return Err(Error::new(
                "COMMAND_UNKNOWN",
                "This command belongs to another PC.",
            ));
        }
        if !rec.active() {
            return Ok(false);
        }
        rec.state = "running".into();
        rec.updated_at = now;
        let mut plan_result: Option<String> = None;
        let mut bench: Option<Value> = None;
        let mut finished = false;
        for e in &batch.events {
            let kind = e.get("event").and_then(Value::as_str).unwrap_or("");
            if let Some(t) = e.get("steps_total").and_then(Value::as_u64) {
                rec.steps_total = t;
            }
            if let Some(d) = e.get("steps_done").and_then(Value::as_u64) {
                rec.steps_done = d;
            }
            match kind {
                "step.started" => {
                    rec.current_step = e.get("title").and_then(Value::as_str).map(str::to_string)
                }
                "plan.done" => {
                    plan_result = e.get("result").and_then(Value::as_str).map(str::to_string)
                }
                "rollback.done" => {
                    rec.rollback_result =
                        e.get("result").and_then(Value::as_str).map(str::to_string)
                }
                "erase.leftover" => {
                    rec.leftover = e.get("command").and_then(Value::as_str).map(str::to_string)
                }
                "ai.bench" => {
                    let mut b = e.clone();
                    b["at"] = serde_json::json!(now);
                    bench = Some(b);
                }
                _ => {}
            }
        }
        if let Some(f) = &batch.finished {
            rec.exit_code = f.exit_code;
            rec.error = f.error.clone();
            rec.current_step = None;
            finished = true;
            rec.state = if f.error.is_some() {
                "failed".into()
            } else if plan_result.as_deref() == Some("cancelled") || f.exit_code == Some(130) {
                "cancelled".into()
            } else if f.exit_code == Some(0) {
                "ok".into()
            } else {
                "failed".into()
            };
        }
        let cancel = rec.cancel_requested;
        // An erased PC no longer belongs to the installation: nothing more is sent to it.
        let erased = finished && rec.command.kind == "erase" && rec.state == "ok";
        if erased {
            if let Some(n) = self.nodes.iter_mut().find(|n| n.id == node_id) {
                n.revoked = true;
                n.assigned.clear();
                n.ai_link = None;
            }
        }
        let removed = (finished && rec.command.kind == "remove" && rec.state == "ok")
            .then(|| rec.command.roles.clone());
        if bench.is_some() || removed.is_some() {
            if let Some(n) = self.nodes.iter_mut().find(|n| n.id == node_id) {
                if bench.is_some() {
                    n.ai_bench = bench;
                }
                for r in removed.unwrap_or_default() {
                    n.assigned.retain(|x| x != &r);
                    if r == "ai" {
                        n.ai_link = None;
                        n.ai_bench = None;
                    }
                }
            }
        }
        Ok(cancel)
    }

    pub fn request_cancel(&mut self, cmd_id: &str, now: u64) -> Result<()> {
        let rec = self
            .commands
            .iter_mut()
            .find(|c| c.command.id == cmd_id)
            .ok_or_else(|| Error::new("COMMAND_UNKNOWN", "Unknown command."))?;
        if !rec.active() {
            return Err(Error::new(
                "COMMAND_FINISHED",
                "This command has already finished.",
            ));
        }
        if rec.state == "queued" {
            rec.state = "cancelled".into(); // never delivered: nothing to undo
        }
        rec.cancel_requested = true;
        rec.updated_at = now;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::CommandFinished;
    use serde_json::json;

    #[test]
    fn erase_needs_a_service_that_knows_it() {
        assert!(version_at_least("0.5.0", ERASE_MIN_VERSION));
        assert!(version_at_least("0.10.1", ERASE_MIN_VERSION));
        for old in ["0.4.3", "0.4", "", "x.y.z", "0.5.0-beta"] {
            assert!(!version_at_least(old, ERASE_MIN_VERSION), "{old}");
        }
    }

    fn reg_with_node(assigned: &[&str]) -> (Registry, String) {
        let mut r = Registry::default();
        let (c, _) = r.new_code(None, 5, 0).unwrap();
        let (n, _) = r
            .enroll(&c, "10.0.0.2", "h", "macos", "aarch64", 5, 0, |id| {
                Ok((format!("PEM-{id}"), format!("fp-{id}")))
            })
            .unwrap();
        let roles: Vec<String> = assigned.iter().map(|s| s.to_string()).collect();
        r.assign(&n.id, &roles).unwrap();
        (r, n.id)
    }

    fn service_program(version: &str) -> ServiceUpdate {
        ServiceUpdate {
            version: version.into(),
            platform: "macos-aarch64".into(),
            sha256: "a".repeat(64),
        }
    }

    fn reports_version(r: &mut Registry, id: &str, version: &str, report: bool) {
        let n = r.nodes.iter_mut().find(|n| n.id == id).unwrap();
        n.last_heartbeat = Some(crate::protocol::Heartbeat {
            helperd_version: version.into(),
            report: report.then(Default::default),
            ..Default::default()
        });
    }

    #[test]
    fn service_update_only_for_a_newer_program_and_a_service_that_understands_it() {
        let (mut r, id) = reg_with_node(&[]);
        // Version not known yet.
        let e = r
            .queue_service_update(&id, service_program("0.6.0"), 1)
            .unwrap_err();
        assert_eq!(e.code, "NODE_OFFLINE");
        // Older than self-update: updated once by hand.
        reports_version(&mut r, &id, "0.5.8", true);
        let e = r
            .queue_service_update(&id, service_program("0.6.0"), 1)
            .unwrap_err();
        assert_eq!(e.code, "SERVICE_OUTDATED");
        // Same or older program: nothing to do (never a downgrade).
        reports_version(&mut r, &id, SELF_UPDATE_MIN_VERSION, true);
        for v in [SELF_UPDATE_MIN_VERSION, "0.5.1", "0.6", "x"] {
            let e = r
                .queue_service_update(&id, service_program(v), 1)
                .unwrap_err();
            assert!(
                matches!(e.code, "UP_TO_DATE" | "BAD_REQUEST"),
                "{v}: {}",
                e.code
            );
        }
        let rec = r
            .queue_service_update(&id, service_program("0.6.0"), 1)
            .unwrap();
        assert_eq!(rec.command.kind, "update_service");
        assert!(rec.command.roles.is_empty() && rec.command.answers.is_empty());
        assert_eq!(
            rec.command.service_update.as_ref().unwrap().version,
            "0.6.0"
        );
        let e = r
            .queue_service_update(&id, service_program("0.6.0"), 2)
            .unwrap_err();
        assert_eq!(e.code, "COMMAND_BUSY");
    }

    #[test]
    fn install_queues_only_installable_components_once() {
        let (mut r, id) = reg_with_node(&["ai", "desktop"]);
        let rec = r.queue(&id, "install", false, "sha", 10).unwrap();
        assert_eq!(
            rec.command.roles,
            vec!["ai".to_string(), "desktop".to_string()]
        );
        assert!(
            rec.command.answers.contains("ROLES=ai,desktop\n")
                && rec.command.answers.contains("AI_LAN=yes")
        );
        assert_eq!(
            r.queue(&id, "install", false, "sha", 11).unwrap_err().code,
            "COMMAND_BUSY"
        );
        let (mut r2, id2) = reg_with_node(&[]);
        assert_eq!(
            r2.queue(&id2, "install", false, "sha", 0).unwrap_err().code,
            "NOTHING_TO_INSTALL"
        );
        assert_eq!(
            r2.queue(&id2, "install", false, "", 0).unwrap_err().code,
            "PAYLOAD_MISSING"
        );
    }

    #[test]
    fn an_outdated_service_gets_no_commands_and_only_the_allowlist_exists() {
        let (mut r, id) = reg_with_node(&["ai"]);
        r.nodes[0].last_heartbeat = Some(crate::protocol::Heartbeat::default());
        assert_eq!(
            r.queue(&id, "install", false, "sha", 1).unwrap_err().code,
            "SERVICE_OUTDATED"
        );
        r.nodes[0].last_heartbeat.as_mut().unwrap().report = Some(Default::default());
        assert_eq!(
            r.queue(&id, "shell", false, "sha", 1).unwrap_err().code,
            "BAD_REQUEST"
        );
        assert_eq!(
            r.queue_spec(&id, "service", false, None, Some("rm"), "sha", 1)
                .unwrap_err()
                .code,
            "BAD_REQUEST"
        );
        let robot = ["robot".to_string()];
        assert_eq!(
            r.queue_spec(&id, "remove", false, Some(&robot), None, "sha", 1)
                .unwrap_err()
                .code,
            "REMOVE_UNSUPPORTED"
        );
    }

    #[test]
    fn a_finished_removal_unassigns_and_a_bench_is_kept() {
        let (mut r, id) = reg_with_node(&["ai", "desktop"]);
        let bench = r.queue(&id, "ai_bench", false, "sha", 1).unwrap();
        let done = |events| CommandEvents {
            events,
            output: vec![],
            finished: Some(CommandFinished {
                exit_code: Some(0),
                error: None,
            }),
        };
        r.record_events(
            &id,
            &bench.command.id,
            &done(vec![json!({"event":"ai.bench","tokens_per_s":32.0})]),
            2,
        )
        .unwrap();
        assert_eq!(r.nodes[0].ai_bench.as_ref().unwrap()["tokens_per_s"], 32.0);
        let ai = ["ai".to_string()];
        let rm = r
            .queue_spec(&id, "remove", false, Some(&ai), None, "sha", 3)
            .unwrap();
        r.record_events(&id, &rm.command.id, &done(vec![]), 4)
            .unwrap();
        assert_eq!(r.nodes[0].assigned, vec!["desktop".to_string()]);
        assert!(r.nodes[0].ai_bench.is_none());
    }

    #[test]
    fn delivered_once_expires_and_progress_is_folded() {
        let (mut r, id) = reg_with_node(&["ai"]);
        let rec = r.queue(&id, "install", true, "sha", 10).unwrap();
        assert!(rec.command.dry_run);
        assert_eq!(r.take_command(&id, 11).unwrap().id, rec.command.id);
        assert!(r.take_command(&id, 12).is_none(), "delivered only once");
        let batch = CommandEvents {
            events: vec![
                json!({"event":"plan.started","steps_total":5}),
                json!({"event":"step.started","title":"Install Ollama","steps_done":1,"steps_total":5}),
            ],
            output: vec![],
            finished: None,
        };
        assert!(!r.record_events(&id, &rec.command.id, &batch, 13).unwrap());
        assert_eq!(
            r.active_command(&id).unwrap().current_step.as_deref(),
            Some("Install Ollama")
        );
        assert_eq!(
            r.record_events("pc-other", &rec.command.id, &batch, 13)
                .unwrap_err()
                .code,
            "COMMAND_UNKNOWN"
        );
        r.request_cancel(&rec.command.id, 14).unwrap();
        assert!(
            r.record_events(&id, &rec.command.id, &CommandEvents::default(), 15)
                .unwrap(),
            "cancel is relayed"
        );
        let done = CommandEvents {
            events: vec![
                json!({"event":"rollback.done","result":"ok"}),
                json!({"event":"plan.done","result":"cancelled"}),
            ],
            output: vec![],
            finished: Some(CommandFinished {
                exit_code: Some(130),
                error: None,
            }),
        };
        r.record_events(&id, &rec.command.id, &done, 16).unwrap();
        let last = r.last_command(&id).unwrap();
        assert_eq!(
            (last.state.as_str(), last.rollback_result.as_deref()),
            ("cancelled", Some("ok"))
        );

        let late = r.queue(&id, "install", false, "sha", 100).unwrap();
        assert!(r.take_command(&id, 100 + COMMAND_TTL_SECS).is_none());
        assert_eq!(r.last_command(&id).unwrap().state, "expired");
        assert_eq!(late.state, "queued");
    }
}
