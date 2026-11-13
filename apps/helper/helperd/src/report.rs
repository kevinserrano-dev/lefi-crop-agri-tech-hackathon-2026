//! What a satellite measures about itself for the main PC (ADR-040): the PC, its load, the Lefi
//! Crop components really present and, when the AI answers on this PC, what it serves. Only
//! measured facts; `None` when something cannot be measured here. Nothing here loads a model:
//! a generation only runs on an explicit request (`ai_bench`).

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde_json::{json, Value};

use crate::error::{Error, Result};
use crate::executor::ExecOptions;
use crate::protocol::{AiLoaded, AiModel, AiReport, ComponentState, Metrics, NodeReport, PcFacts};

pub const AI_PORT: u16 = 11434;
const GB: f64 = 1024.0 * 1024.0 * 1024.0;

fn round1(v: f64) -> f64 {
    (v * 10.0).round() / 10.0
}

fn output(cmd: &str, args: &[&str]) -> Option<String> {
    let o = std::process::Command::new(cmd).args(args).output().ok()?;
    o.status
        .success()
        .then(|| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty())
}

fn sysctl(key: &str) -> Option<String> {
    output("sysctl", &["-n", key])
}

fn home(opts: &ExecOptions) -> PathBuf {
    opts.home
        .clone()
        .or_else(|| std::env::var_os("HOME").map(PathBuf::from))
        .unwrap_or_default()
}

fn ai_port(opts: &ExecOptions) -> u16 {
    opts.ai_port.unwrap_or(AI_PORT)
}

/// Facts that do not change while the service runs.
pub fn pc_facts() -> PcFacts {
    PcFacts {
        model: sysctl("hw.model"),
        chip: sysctl("machdep.cpu.brand_string"),
        cores: sysctl("hw.ncpu").and_then(|v| v.parse().ok()),
        memory_gb: sysctl("hw.memsize")
            .and_then(|v| v.parse::<f64>().ok())
            .map(|b| round1(b / GB)),
        os_version: output("sw_vers", &["-productVersion"]),
    }
}

/// The number after `"key"=` in `ioreg` output.
pub fn ioreg_number(text: &str, key: &str) -> Option<f64> {
    let rest = text.split(&format!("\"{key}\"=")).nth(1)?;
    let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
    digits.parse().ok()
}

/// Memory in use (active + wired + compressed) from `vm_stat` output, in GB.
pub fn vm_stat_used_gb(text: &str) -> Option<f64> {
    let page: f64 = text
        .split("page size of ")
        .nth(1)?
        .split_whitespace()
        .next()?
        .parse()
        .ok()?;
    let pages = |label: &str| -> Option<f64> {
        let line = text.lines().find(|l| l.starts_with(label))?;
        line.split(':')
            .nth(1)?
            .trim()
            .trim_end_matches('.')
            .parse()
            .ok()
    };
    let used = pages("Pages active")?
        + pages("Pages wired down")?
        + pages("Pages occupied by compressor")?;
    Some(round1(used * page / GB))
}

/// Load now. The GPU figures come from the accelerator's own statistics and need no privileges.
pub fn metrics() -> Metrics {
    let io = output("ioreg", &["-r", "-d", "1", "-c", "IOAccelerator"]).unwrap_or_default();
    Metrics {
        load_1m: sysctl("vm.loadavg").and_then(|s| {
            s.trim_matches(|c: char| c == '{' || c == '}' || c.is_whitespace())
                .split_whitespace()
                .next()
                .and_then(|v| v.parse().ok())
        }),
        memory_used_gb: output("vm_stat", &[]).as_deref().and_then(vm_stat_used_gb),
        gpu_utilization_pct: ioreg_number(&io, "Device Utilization %"),
        gpu_memory_in_use_gb: ioreg_number(&io, "In use system memory").map(|b| round1(b / GB)),
    }
}

fn http() -> Option<reqwest::Client> {
    reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(2))
        .build()
        .ok()
}

async fn get_json(c: &reqwest::Client, port: u16, path: &str) -> Option<Value> {
    c.get(format!("http://127.0.0.1:{port}{path}"))
        .send()
        .await
        .ok()?
        .json()
        .await
        .ok()
}

/// Share of a loaded model in GPU memory, as Ollama reports it.
pub fn gpu_pct(size: f64, size_vram: f64) -> Option<u64> {
    (size > 0.0).then(|| (size_vram / size * 100.0).round() as u64)
}

fn loaded_models(ps: &Value) -> Vec<AiLoaded> {
    ps["models"]
        .as_array()
        .map(|a| {
            a.iter()
                .map(|m| {
                    let size = m["size"].as_f64().unwrap_or(0.0);
                    AiLoaded {
                        name: m["name"].as_str().unwrap_or("").to_string(),
                        size_gb: round1(size / GB),
                        gpu_pct: gpu_pct(size, m["size_vram"].as_f64().unwrap_or(0.0)),
                        context_length: m["context_length"].as_u64(),
                    }
                })
                .collect()
        })
        .unwrap_or_default()
}

/// The AI on this PC, asked on loopback. `None`: nothing answers.
pub async fn probe_ai(port: u16) -> Option<AiReport> {
    let c = http()?;
    let version = get_json(&c, port, "/api/version").await?;
    let tags = get_json(&c, port, "/api/tags").await.unwrap_or(Value::Null);
    let ps = get_json(&c, port, "/api/ps").await.unwrap_or(Value::Null);
    Some(AiReport {
        version: version["version"].as_str().map(str::to_string),
        models: tags["models"]
            .as_array()
            .map(|a| {
                a.iter()
                    .map(|m| AiModel {
                        name: m["name"].as_str().unwrap_or("").to_string(),
                        size_gb: round1(m["size"].as_f64().unwrap_or(0.0) / GB),
                    })
                    .collect()
            })
            .unwrap_or_default(),
        loaded: loaded_models(&ps),
        lan: None,
        kill_switch: false,
    })
}

pub fn bundle_version(app: &Path) -> Option<String> {
    output(
        "plutil",
        &[
            "-extract",
            "CFBundleShortVersionString",
            "raw",
            &app.join("Contents/Info.plist").display().to_string(),
        ],
    )
}

fn component(id: &str, installed: bool, state: &str) -> ComponentState {
    ComponentState {
        id: id.into(),
        installed,
        state: state.into(),
        version: None,
        detail: None,
        path: None,
        paired: None,
    }
}

fn recorded_roles(h: &Path) -> Vec<String> {
    let text = std::fs::read_to_string(h.join(".lefi-crop/lefi.env")).unwrap_or_default();
    text.lines()
        .filter_map(|l| l.strip_prefix("LEFI_ROLES="))
        .next_back()
        .map(|v| v.split(',').map(|r| r.trim().to_string()).collect())
        .unwrap_or_default()
}

/// Lefi Desktop's data folder (its Tauri app data dir, identifier `ai.leficrop.desktop`).
pub fn desktop_data_dir(home: &Path) -> PathBuf {
    if cfg!(target_os = "macos") {
        home.join("Library/Application Support/ai.leficrop.desktop")
    } else {
        home.join(".local/share/ai.leficrop.desktop")
    }
}

/// Which components are really on this PC, from what exists here (never from what was asked for).
pub fn components(h: &Path, ai: Option<&AiReport>) -> Vec<ComponentState> {
    let plist = h.join("Library/LaunchAgents/com.lefi-crop.ollama.plist");
    let killed = h.join(".lefi-crop/flags/ai.disabled").exists();
    let managed = plist.is_file();
    let mut a = component(
        "ai",
        managed,
        match (ai.is_some(), managed, killed) {
            (_, _, true) => "disabled",
            (true, true, _) => "running",
            (true, false, _) => "external",
            (false, true, _) => "stopped",
            (false, false, _) => "not_installed",
        },
    );
    a.version = ai.and_then(|r| r.version.clone());
    if ai.is_some() && !managed {
        a.detail = Some("Ollama runs on this PC, but not as a Lefi Crop service.".into());
    }
    let mut d = component("desktop", false, "not_installed");
    for dir in [PathBuf::from("/Applications"), h.join("Applications")] {
        let app = dir.join("Lefi Crop.app");
        if app.join("Contents").is_dir() {
            d = component("desktop", true, "installed");
            d.version = bundle_version(&app);
            d.path = Some(app.display().to_string());
            d.paired = Some(desktop_data_dir(h).join("pairing.json").is_file());
            break;
        }
    }
    let roles = recorded_roles(h);
    let flag = |id: &str| {
        let on = roles.iter().any(|r| r == id);
        component(id, on, if on { "installed" } else { "not_installed" })
    };
    vec![a, d, flag("robot"), flag("firmware")]
}

/// Whether the AI service was set to listen on the network (from its launch spec).
fn ai_listens_on_lan(h: &Path) -> Option<bool> {
    let spec = std::fs::read_to_string(h.join(".lefi-crop/services/ollama.svc")).ok()?;
    let envs = spec.lines().find_map(|l| l.strip_prefix("ENVS="))?;
    Some(envs.contains("OLLAMA_HOST=0.0.0.0"))
}

pub async fn collect(opts: &ExecOptions, pc: &PcFacts) -> NodeReport {
    let h = home(opts);
    let mut ai = probe_ai(ai_port(opts)).await;
    if let Some(r) = ai.as_mut() {
        r.lan = ai_listens_on_lan(&h);
        r.kill_switch = h.join(".lefi-crop/flags/ai.disabled").exists();
    }
    NodeReport {
        pc: pc.clone(),
        metrics: metrics(),
        components: components(&h, ai.as_ref()),
        ai,
    }
}

const BENCH_PROMPT: &str = "Explain in one short paragraph why plants need water.";
const BENCH_TOKENS: u32 = 64;

/// One real, short generation, on request. The model is the one already loaded, else the first
/// installed model of `supported` (`config/supported-models.tsv`), never a fixed name.
pub async fn ai_bench(opts: &ExecOptions, supported: &[String]) -> Result<Value> {
    let port = ai_port(opts);
    let fail = |m: String| Error::new("AI_BENCH", m);
    let c = http().ok_or_else(|| fail("No HTTP client".into()))?;
    let report = probe_ai(port)
        .await
        .ok_or_else(|| fail("The AI service does not answer on this PC.".into()))?;
    let model = report
        .loaded
        .iter()
        .map(|m| m.name.clone())
        .find(|n| supported.contains(n))
        .or_else(|| {
            supported
                .iter()
                .find(|s| report.models.iter().any(|m| &m.name == *s))
                .cloned()
        })
        .ok_or_else(|| fail("This PC has no supported AI model installed.".into()))?;
    let long = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|e| fail(e.to_string()))?;
    let v: Value = long
        .post(format!("http://127.0.0.1:{port}/api/generate"))
        .json(&json!({
            "model": model, "prompt": BENCH_PROMPT, "stream": false, "think": false,
            "options": { "num_predict": BENCH_TOKENS },
        }))
        .send()
        .await
        .map_err(|e| fail(format!("The generation failed: {e}")))?
        .json()
        .await
        .map_err(|e| fail(format!("Unreadable answer from the AI: {e}")))?;
    if let Some(e) = v["error"].as_str() {
        return Err(fail(format!("The AI refused: {e}")));
    }
    let ms = |k: &str| v[k].as_f64().map(|n| (n / 1e6).round() as u64);
    let eval_count = v["eval_count"].as_u64().unwrap_or(0);
    let eval_ns = v["eval_duration"].as_f64().unwrap_or(0.0);
    if eval_count == 0 || eval_ns <= 0.0 {
        return Err(fail("The AI generated no tokens.".into()));
    }
    let ps = get_json(&c, port, "/api/ps").await.unwrap_or(Value::Null);
    let loaded = loaded_models(&ps);
    let share = loaded.iter().find(|m| m.name == model);
    Ok(json!({
        "event": "ai.bench",
        "model": model,
        "tokens_per_s": round1(eval_count as f64 / (eval_ns / 1e9)),
        "eval_count": eval_count,
        "load_ms": ms("load_duration"),
        "prompt_ms": ms("prompt_eval_duration"),
        "total_ms": ms("total_duration"),
        "gpu_pct": share.and_then(|m| m.gpu_pct),
        "size_gb": share.map(|m| m.size_gb),
        "context_length": share.and_then(|m| m.context_length),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_accelerator_and_memory_statistics() {
        let io = r#"| "PerformanceStatistics" = {"Alloc system memory"=2698592256,"Device Utilization %"=29,"In use system memory"=2147483648}"#;
        assert_eq!(ioreg_number(io, "Device Utilization %"), Some(29.0));
        assert_eq!(ioreg_number(io, "In use system memory"), Some(2147483648.0));
        assert_eq!(ioreg_number(io, "Nope"), None);
        let vm = "Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages free: 10.\nPages active: 65536.\nPages wired down: 65536.\nPages occupied by compressor: 0.\n";
        assert_eq!(vm_stat_used_gb(vm), Some(2.0));
        assert_eq!(vm_stat_used_gb("garbage"), None);
        assert_eq!(gpu_pct(8.0, 8.0), Some(100));
        assert_eq!(gpu_pct(0.0, 0.0), None);
    }

    #[test]
    fn components_come_from_what_exists_on_the_pc() {
        let d = tempfile::tempdir().unwrap();
        let h = d.path();
        let ai = AiReport::default();
        let c = components(h, None);
        assert_eq!(c[0].state, "not_installed");
        assert!(!c[2].installed);
        // Ollama answers, but Lefi Crop did not install it.
        assert_eq!(components(h, Some(&ai))[0].state, "external");
        std::fs::create_dir_all(h.join("Library/LaunchAgents")).unwrap();
        std::fs::write(
            h.join("Library/LaunchAgents/com.lefi-crop.ollama.plist"),
            "x",
        )
        .unwrap();
        assert_eq!(components(h, None)[0].state, "stopped");
        assert_eq!(components(h, Some(&ai))[0].state, "running");
        std::fs::create_dir_all(h.join(".lefi-crop/flags")).unwrap();
        std::fs::write(h.join(".lefi-crop/flags/ai.disabled"), "x").unwrap();
        assert_eq!(components(h, Some(&ai))[0].state, "disabled");
        std::fs::write(h.join(".lefi-crop/lefi.env"), "LEFI_ROLES=ai,robot\n").unwrap();
        let c = components(h, None);
        assert!(c[2].installed && !c[3].installed);
    }
}
