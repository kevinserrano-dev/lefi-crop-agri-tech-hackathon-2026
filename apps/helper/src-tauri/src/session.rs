//! The installation in progress on this PC (ADR-039). Kept on disk so that closing or losing Lefi
//! Crop Helper mid-run loses nothing: on reopening it can continue with the same answers (the
//! installer is idempotent) or undo every run of it. Nothing is ever undone by itself.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::activation::private_file;
use crate::answers::SetupAnswers;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum Stored {
    Running,
    Ok,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Session {
    state: Stored,
    answers: Value,
    /// Install journals of every run of this installation, oldest first.
    journals: Vec<String>,
    /// The installer of the run in progress.
    pid: Option<u32>,
}

/// What the app tells the user about the last installation.
#[derive(Debug, Clone, Serialize)]
pub struct SessionView {
    /// `none` · `ok` · `failed` · `interrupted` (the app was gone before it ended) ·
    /// `still_running` (the installer outlived the app and is still working).
    pub state: &'static str,
    pub answers: Option<Value>,
    pub runs: usize,
}

pub struct Sessions {
    path: PathBuf,
}

/// The installer that wrote this journal wrote `logs/install-<stamp>.events.ndjson`; its last
/// `plan.done` says how the run ended even if the app was not there to see it.
fn run_result(journal: &str) -> Option<String> {
    let j = Path::new(journal);
    let stamp = j.file_stem()?.to_str()?.strip_prefix("run-")?;
    let state = j.parent()?.parent()?.parent()?;
    let events = state
        .join("logs")
        .join(format!("install-{stamp}.events.ndjson"));
    fs::read_to_string(events)
        .ok()?
        .lines()
        .rev()
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .find(|e| e["event"] == "plan.done")
        .and_then(|e| e["result"].as_str().map(str::to_string))
}

/// Is this process still that installer? The command line guards against a reused process id.
fn installer_alive(pid: u32) -> bool {
    std::process::Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "command="])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).contains("install.sh"))
        .unwrap_or(false)
}

impl Sessions {
    pub fn new(dir: &Path) -> Self {
        Self {
            path: dir.join("install-session.json"),
        }
    }

    fn load(&self) -> Option<Session> {
        serde_json::from_str(&fs::read_to_string(&self.path).ok()?).ok()
    }

    /// Losing this file only loses the offer to continue, so a write problem never stops a run.
    fn save(&self, s: &Session) {
        if let Ok(text) = serde_json::to_vec_pretty(s) {
            if let Some(dir) = self.path.parent() {
                let _ = fs::create_dir_all(dir);
            }
            let _ = private_file(&self.path, &text);
        }
    }

    fn update(&self, f: impl FnOnce(&mut Session)) {
        if let Some(mut s) = self.load() {
            f(&mut s);
            self.save(&s);
        }
    }

    /// A run starts. After an unfinished one it continues the same installation, so "undo" still
    /// covers every run.
    pub fn begin(&self, answers: &SetupAnswers) {
        let journals = match self.load() {
            Some(s) if s.state != Stored::Ok => s.journals,
            _ => Vec::new(),
        };
        self.save(&Session {
            state: Stored::Running,
            answers: serde_json::to_value(answers).unwrap_or(Value::Null),
            journals,
            pid: None,
        });
    }

    pub fn started(&self, pid: Option<u32>) {
        self.update(|s| s.pid = pid);
    }

    pub fn journal(&self, path: &str) {
        self.update(|s| {
            if !s.journals.iter().any(|j| j == path) {
                s.journals.push(path.to_string());
            }
        });
    }

    /// The run ended. Exit 130 = cancelled: that run undid itself, so only earlier runs remain.
    pub fn finish(&self, exit_code: Option<i32>) {
        let Some(mut s) = self.load() else { return };
        s.pid = None;
        match exit_code {
            Some(0) => s.state = Stored::Ok,
            Some(130) => {
                s.journals.pop();
                if s.journals.is_empty() {
                    return self.clear();
                }
                s.state = Stored::Failed;
            }
            _ => s.state = Stored::Failed,
        }
        self.save(&s);
    }

    pub fn journals(&self) -> Vec<String> {
        self.load().map(|s| s.journals).unwrap_or_default()
    }

    pub fn clear(&self) {
        let _ = fs::remove_file(&self.path);
    }

    pub fn view(&self) -> SessionView {
        let Some(s) = self.load() else {
            return SessionView {
                state: "none",
                answers: None,
                runs: 0,
            };
        };
        let state = match s.state {
            Stored::Ok => "ok",
            Stored::Failed => "failed",
            Stored::Running if s.pid.is_some_and(installer_alive) => "still_running",
            Stored::Running => match s.journals.last().and_then(|j| run_result(j)).as_deref() {
                Some("ok") => "ok",
                Some(_) => "failed",
                None => "interrupted",
            },
        };
        SessionView {
            state,
            runs: s.journals.len(),
            answers: Some(s.answers),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir(name: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let d = std::env::temp_dir().join(format!(
            "lefi-session-{name}-{}-{nanos}",
            std::process::id()
        ));
        fs::create_dir_all(&d).unwrap();
        d
    }

    fn answers() -> SetupAnswers {
        serde_json::from_value(serde_json::json!({
            "roles": ["core", "admin"],
            "model": "recommended",
            "ai_url": "http://192.0.2.1:11434",
            "ai_lan": false,
            "admin_https": false,
            "stop_conflicting_services": true,
            "update_model": false,
            "service_mode": null,
            "dev_allow_no_ai": false
        }))
        .unwrap()
    }

    #[test]
    fn nothing_recorded_is_none() {
        assert_eq!(Sessions::new(&dir("none")).view().state, "none");
    }

    #[test]
    fn an_app_lost_mid_run_is_interrupted_with_its_answers_and_journal() {
        let d = dir("lost");
        let s = Sessions::new(&d);
        s.begin(&answers());
        s.started(Some(1)); // launchd: alive, but not an installer
        s.journal("/x/install/journal/run-1.tsv");
        let again = Sessions::new(&d); // the app was reopened
        let v = again.view();
        assert_eq!(v.state, "interrupted");
        assert_eq!(v.answers.unwrap()["roles"][0], "core");
        assert_eq!(again.journals(), vec!["/x/install/journal/run-1.tsv"]);
    }

    #[test]
    fn the_events_file_says_how_a_run_ended_without_the_app() {
        let d = dir("events");
        let s = Sessions::new(&d);
        let state = d.join("state");
        fs::create_dir_all(state.join("logs")).unwrap();
        let j = state.join("install/journal/run-7.tsv");
        s.begin(&answers());
        s.journal(j.to_str().unwrap());
        let ev = state.join("logs/install-7.events.ndjson");
        fs::write(&ev, "{\"event\":\"step.started\"}\n").unwrap();
        assert_eq!(s.view().state, "interrupted");
        fs::write(&ev, "{\"event\":\"plan.done\",\"result\":\"ok\"}\n").unwrap();
        assert_eq!(s.view().state, "ok");
        fs::write(&ev, "{\"event\":\"plan.done\",\"result\":\"failed\"}\n").unwrap();
        assert_eq!(s.view().state, "failed");
    }

    #[test]
    fn a_living_installer_is_still_running() {
        let d = dir("alive");
        let script = d.join("install.sh");
        fs::write(&script, "#!/bin/sh\nwhile :; do sleep 1; done\n").unwrap();
        let mut child = std::process::Command::new("/bin/sh")
            .arg(&script)
            .spawn()
            .unwrap();
        let s = Sessions::new(&d);
        s.begin(&answers());
        s.started(Some(child.id()));
        assert_eq!(s.view().state, "still_running");
        child.kill().unwrap();
        child.wait().unwrap();
        assert_eq!(s.view().state, "interrupted");
    }

    #[test]
    fn continuing_keeps_every_journal_and_success_starts_afresh() {
        let s = Sessions::new(&dir("runs"));
        s.begin(&answers());
        s.journal("/j/run-1.tsv");
        s.finish(Some(1));
        assert_eq!(s.view().state, "failed");
        s.begin(&answers());
        s.journal("/j/run-2.tsv");
        assert_eq!(s.journals(), vec!["/j/run-1.tsv", "/j/run-2.tsv"]);
        s.finish(Some(0));
        assert_eq!(s.view().state, "ok");
        s.begin(&answers());
        assert!(s.journals().is_empty());
    }

    #[test]
    fn cancelling_leaves_only_the_runs_it_did_not_undo() {
        let s = Sessions::new(&dir("cancel"));
        s.begin(&answers());
        s.journal("/j/run-1.tsv");
        s.finish(Some(130));
        assert_eq!(s.view().state, "none");
        s.begin(&answers());
        s.journal("/j/run-2.tsv");
        s.finish(Some(1));
        s.begin(&answers());
        s.journal("/j/run-3.tsv");
        s.finish(Some(130));
        assert_eq!(s.view().state, "failed");
        assert_eq!(s.journals(), vec!["/j/run-2.tsv"]);
    }

    #[test]
    fn a_damaged_file_only_loses_the_offer() {
        let d = dir("bad");
        fs::write(d.join("install-session.json"), "not json").unwrap();
        assert_eq!(Sessions::new(&d).view().state, "none");
    }
}
