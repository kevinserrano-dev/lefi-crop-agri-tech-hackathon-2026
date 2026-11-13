//! The UI's choices → a validated `--answers` file for `scripts/install.sh` (ADR-028 format).
//! Nothing typed in the WebView reaches the file without being checked here first.

use serde::Deserialize;

use crate::error::{Result, SetupError};
use crate::models::SupportedModel;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    Ai,
    Core,
    Admin,
    /// Lefi Desktop, the dashboard app (ADR-034).
    Desktop,
}

impl Role {
    fn id(self) -> &'static str {
        match self {
            Role::Ai => "ai",
            Role::Core => "core",
            Role::Admin => "admin",
            Role::Desktop => "desktop",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ServiceMode {
    /// Linux system services as user `lefi`, start at boot (ADR-029).
    Systemd,
    /// Linux development mode — debug builds only.
    User,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub struct SetupAnswers {
    pub roles: Vec<Role>,
    /// `recommended` or a tag from `config/supported-models.tsv`.
    pub model: String,
    /// AI node URL, required when this PC is core without the ai role.
    #[serde(default)]
    pub ai_url: Option<String>,
    /// AI without core here: let Ollama listen on the LAN for the core node.
    #[serde(default)]
    pub ai_lan: bool,
    #[serde(default)]
    pub admin_https: bool,
    /// Stop another Ollama / a distribution service already holding a port Lefi Crop needs.
    #[serde(default)]
    pub stop_conflicting_services: bool,
    #[serde(default)]
    pub update_model: bool,
    /// Linux only; `None` = systemd.
    #[serde(default)]
    pub service_mode: Option<ServiceMode>,
    /// Development/CI override (ADR-028) — refused in release builds.
    #[serde(default)]
    pub dev_allow_no_ai: bool,
}

/// Facts the validation needs about this build and machine.
pub struct Target<'a> {
    pub linux: bool,
    pub debug_build: bool,
    pub models: &'a [SupportedModel],
}

fn invalid(message: impl Into<String>) -> SetupError {
    SetupError::new("ANSWERS_INVALID", message)
}

fn yes(v: bool) -> &'static str {
    if v {
        "yes"
    } else {
        "no"
    }
}

/// `http://host:port` with nothing else: the installer appends the API paths itself.
pub fn normalize_ai_url(raw: &str) -> Result<String> {
    let url =
        url::Url::parse(raw.trim()).map_err(|_| invalid("AI node address is not a valid URL"))?;
    if url.scheme() != "http" {
        return Err(invalid(
            "AI node address must start with http:// (Ollama on the LAN)",
        ));
    }
    let host = url
        .host_str()
        .filter(|h| !h.is_empty())
        .ok_or_else(|| invalid("AI node address has no host"))?;
    if url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
        || !url.username().is_empty()
    {
        return Err(invalid("AI node address must be only http://host:port"));
    }
    let port = url.port().unwrap_or(11434);
    Ok(format!("http://{host}:{port}"))
}

impl SetupAnswers {
    pub fn has(&self, role: Role) -> bool {
        self.roles.contains(&role)
    }

    pub fn validate(&self, target: &Target<'_>) -> Result<()> {
        if self.roles.is_empty() {
            return Err(invalid("Choose at least one role for this PC"));
        }
        for (i, r) in self.roles.iter().enumerate() {
            if self.roles[..i].contains(r) {
                return Err(invalid(format!("Role '{}' given twice", r.id())));
            }
        }
        if self.model != "recommended" && !target.models.iter().any(|m| m.tag == self.model) {
            return Err(invalid(format!(
                "Model '{}' is not in config/supported-models.tsv",
                self.model
            )));
        }
        if self.has(Role::Core) && !self.has(Role::Ai) {
            match &self.ai_url {
                Some(u) if !u.trim().is_empty() => {
                    normalize_ai_url(u)?;
                }
                _ => {
                    return Err(invalid(
                        "A core PC without the AI role needs the AI node's address",
                    ))
                }
            }
        }
        if self.dev_allow_no_ai && !target.debug_build {
            return Err(invalid(
                "The no-AI override exists only in development builds",
            ));
        }
        match self.service_mode {
            Some(_) if !target.linux => return Err(invalid("Service mode applies to Linux only")),
            Some(ServiceMode::User) if !target.debug_build => {
                return Err(invalid(
                    "Linux user mode is a development mode (debug builds only)",
                ))
            }
            _ => {}
        }
        Ok(())
    }

    /// The answers file. Call `validate` first.
    pub fn render(&self, target: &Target<'_>) -> Result<String> {
        self.validate(target)?;
        let roles: Vec<&str> = self.roles.iter().map(|r| r.id()).collect();
        let mut out = String::from(
            "# Written by Lefi Crop Helper (ADR-030). Format: deploy/install/answers.example\n",
        );
        let mut kv = |k: &str, v: &str| {
            out.push_str(k);
            out.push('=');
            out.push_str(v);
            out.push('\n');
        };
        kv("ROLES", &roles.join(","));
        if target.linux {
            kv(
                "SERVICE_MODE",
                match self.service_mode.unwrap_or(ServiceMode::Systemd) {
                    ServiceMode::Systemd => "systemd",
                    ServiceMode::User => "user",
                },
            );
        }
        kv("CONTINUE", "yes");
        if self.has(Role::Ai) {
            kv("MODEL", &self.model);
            kv("AI_LAN", yes(!self.has(Role::Core) && self.ai_lan));
            kv("INSTALL_OLLAMA", "yes");
            kv("STOP_FOREIGN_OLLAMA", yes(self.stop_conflicting_services));
            kv("UPDATE_MODEL", yes(self.update_model));
        }
        if self.has(Role::Core) {
            if !self.has(Role::Ai) {
                kv(
                    "AI_URL",
                    &normalize_ai_url(self.ai_url.as_deref().unwrap_or_default())?,
                );
            }
            // Empty = the installer generates the admin password into credentials/admin.txt (600).
            kv("ADMIN_PASSWORD_FILE", "");
            kv("STOP_VENDOR_SERVICES", yes(self.stop_conflicting_services));
        }
        if self.has(Role::Admin) {
            kv("ADMIN_HTTPS", yes(self.admin_https));
        }
        if !target.linux {
            kv("INSTALL_HOMEBREW", "yes");
        }
        kv("INSTALL_CLI", "yes");
        kv("DEV_ALLOW_NO_AI", yes(self.dev_allow_no_ai));
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn models() -> Vec<SupportedModel> {
        vec![SupportedModel {
            tag: "fake:model".into(),
            label: "Fake".into(),
            role: "default".into(),
            mem_gb: None,
            ctx: None,
            measured_on: None,
        }]
    }

    fn answers(roles: Vec<Role>) -> SetupAnswers {
        SetupAnswers {
            roles,
            model: "recommended".into(),
            ai_url: None,
            ai_lan: false,
            admin_https: false,
            stop_conflicting_services: true,
            update_model: false,
            service_mode: None,
            dev_allow_no_ai: false,
        }
    }

    #[test]
    fn all_in_one_on_macos() {
        let m = models();
        let t = Target {
            linux: false,
            debug_build: false,
            models: &m,
        };
        let out = answers(vec![Role::Ai, Role::Core, Role::Admin])
            .render(&t)
            .unwrap();
        assert!(out.contains("ROLES=ai,core,admin\n"));
        assert!(out.contains("MODEL=recommended\n"));
        assert!(out.contains("AI_LAN=no\n"));
        assert!(out.contains("INSTALL_HOMEBREW=yes\n"));
        assert!(!out.contains("SERVICE_MODE"));
        assert!(!out.contains("AI_URL"));
    }

    #[test]
    fn every_key_is_known_to_the_installer() {
        let common = include_str!("../../../../scripts/lib/common.sh");
        let keys_line = common
            .lines()
            .find(|l| l.starts_with("ANSWER_KEYS="))
            .unwrap();
        let known: Vec<&str> = keys_line
            .trim_start_matches("ANSWER_KEYS=")
            .trim_matches('"')
            .split_whitespace()
            .collect();
        let m = models();
        let t = Target {
            linux: true,
            debug_build: true,
            models: &m,
        };
        let mut a = answers(vec![Role::Core, Role::Admin]);
        a.ai_url = Some("http://192.0.2.10:11434".into());
        for out in [
            a.render(&t).unwrap(),
            answers(vec![Role::Ai]).render(&t).unwrap(),
        ] {
            for line in out.lines().filter(|l| !l.starts_with('#')) {
                let key = line.split('=').next().unwrap();
                assert!(known.contains(&key), "{key}");
            }
        }
    }

    #[test]
    fn core_without_ai_needs_a_clean_url() {
        let m = models();
        let t = Target {
            linux: true,
            debug_build: false,
            models: &m,
        };
        let mut a = answers(vec![Role::Core]);
        assert_eq!(a.validate(&t).unwrap_err().code, "ANSWERS_INVALID");
        a.ai_url = Some("http://192.0.2.10:11434/".into());
        assert!(a
            .render(&t)
            .unwrap()
            .contains("AI_URL=http://192.0.2.10:11434\n"));
        a.ai_url = Some("http://192.0.2.10/$(reboot)".into());
        assert!(a.validate(&t).is_err());
        a.ai_url = Some("https://192.0.2.10".into());
        assert!(a.validate(&t).is_err());
        a.ai_url = Some("http://192.0.2.10".into());
        assert!(a
            .render(&t)
            .unwrap()
            .contains("AI_URL=http://192.0.2.10:11434\n"));
    }

    #[test]
    fn refuses_unknown_model_duplicates_and_release_overrides() {
        let m = models();
        let t = Target {
            linux: true,
            debug_build: false,
            models: &m,
        };
        let mut a = answers(vec![Role::Ai]);
        a.model = "other:7b".into();
        assert!(a.validate(&t).is_err());
        a.model = "fake:model".into();
        assert!(a.validate(&t).is_ok());
        a.dev_allow_no_ai = true;
        assert!(a.validate(&t).is_err());
        a.dev_allow_no_ai = false;
        a.service_mode = Some(ServiceMode::User);
        assert!(a.validate(&t).is_err());
        assert!(answers(vec![Role::Ai, Role::Ai]).validate(&t).is_err());
        assert!(answers(vec![]).validate(&t).is_err());
    }

    #[test]
    fn rejects_unknown_fields_from_the_ui() {
        let r: std::result::Result<SetupAnswers, _> =
            serde_json::from_str(r#"{"roles":["ai"],"model":"recommended","extra":1}"#);
        assert!(r.is_err());
    }
}
