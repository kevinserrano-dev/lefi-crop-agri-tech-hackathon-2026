"""Brain settings from the environment / `.env` (pydantic-settings).

The installer writes `.env` (`scripts/lib/role_core.sh`); the `lefi` CLI and the service
launcher point the Brain at it with `LEFI_ENV_FILE`. Invalid values make startup fail
loudly instead of running with a guess.
"""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_STATE_DIR = Path.home() / ".lefi-crop"


def _env_file() -> str | None:
    value = os.environ.get("LEFI_ENV_FILE")
    return value or None


class Settings(BaseSettings):
    """Every field maps to an upper-case `LEFI_*` variable (except the `OLLAMA_*` ones)."""

    model_config = SettingsConfigDict(
        env_prefix="LEFI_",
        extra="ignore",
        case_sensitive=False,
        frozen=True,
    )

    env: Literal["development", "test", "production"] = "development"
    state_dir: Path = DEFAULT_STATE_DIR

    api_host: str = "127.0.0.1"
    api_port: int = Field(default=8000, ge=1, le=65535)

    # Empty means "<state_dir>/data/lefi.db" (same default as `lefi db path`).
    database_url: str = ""
    db_auto_migrate: bool = True
    db_busy_timeout_ms: int = Field(default=5000, ge=0)

    # MQTT is configured by the installer (user lefi-brain). Ingestion (ADR-052) starts when a
    # username is set, unless LEFI_MQTT_ENABLED=false.
    mqtt_host: str = "127.0.0.1"
    mqtt_port: int = Field(default=1883, ge=1, le=65535)
    mqtt_username: str | None = None
    mqtt_password: SecretStr | None = None
    mqtt_enabled: bool | None = None
    # The rules engine checks every few seconds in the background (ADR-071); tests drive it by hand.
    rules_engine_loop: bool = True
    # Scheduled zone photos (ADR-088): on, except in tests (they drive it by hand).
    camera_scan_loop: bool | None = None
    # Zone health reviews every 30 min (ADR-089): on, except in tests (they drive it by hand).
    review_loop: bool | None = None
    mqtt_client_id: str = "lefi-brain"
    # Robot Mission Center (ADR-091): the MH3 simulation bridge (`simulators/robot-mh3`). Empty =
    # no robot. The token file is shared with the bridge (it creates it, 600); empty =
    # "<state>/robot-sim/token". Everything a robot does here is SIMULATED.
    robot_sim_url: str = ""
    robot_sim_id: str = "mh3-sim"
    robot_sim_token_file: Path | None = None
    robot_mission_timeout_s: int = Field(default=300, ge=30, le=3600)
    robot_inspect_head_pitch: float = Field(default=0.45, ge=-0.4, le=1.0)
    robot_loop: bool | None = None
    # Where Lefi Crop Helper's service says how to reach it for the robot (ADR-090); empty =
    # "<state>/helper/link.json", written by `lefi-helperd main`.
    helper_link_file: Path | None = None
    # Accounts for field devices (ADR-052): Lefi Brain adds/removes one Mosquitto user per ESP32
    # in this file, then asks Mosquitto to reload it. Empty = "<state>/mosquitto/passwd".
    mqtt_passwd_file: Path | None = None
    # What a device is told to connect to (the main PC on the LAN, ADR-042), and the port.
    mqtt_device_host: str = "lefi-main.local"
    mqtt_device_port: int | None = Field(default=None, ge=1, le=65535)
    # Boards may send every second (ADR-059). Current values update on every message; history
    # keeps one reading per sensor variable every this many seconds, plus every change between a
    # value and an error. 0 = keep every reading.
    readings_history_every_s: int = Field(default=10, ge=0, le=3600)

    @property
    def camera_scan_on(self) -> bool:
        if self.camera_scan_loop is not None:
            return self.camera_scan_loop
        return self.env != "test"

    @property
    def review_loop_on(self) -> bool:
        if self.review_loop is not None:
            return self.review_loop
        return self.env != "test"

    @property
    def robot_loop_on(self) -> bool:
        if self.robot_loop is not None:
            return self.robot_loop
        return self.env != "test"

    @property
    def resolved_helper_link_file(self) -> Path:
        return self.helper_link_file or self.state_dir / "helper" / "link.json"

    @property
    def resolved_robot_token_file(self) -> Path:
        return self.robot_sim_token_file or self.state_dir / "robot-sim" / "token"

    @property
    def mqtt_ingestion_on(self) -> bool:
        if self.mqtt_enabled is not None:
            return self.mqtt_enabled
        return bool(self.mqtt_username)

    # AI node (ADR-018/019). Never hard-coded: unset means "AI unavailable".
    ollama_base_url: str | None = Field(default=None, validation_alias="OLLAMA_BASE_URL")
    ollama_model: str | None = Field(default=None, validation_alias="OLLAMA_MODEL")
    ai_enabled: bool = True  # LEFI_AI_ENABLED=false is a second, env-level kill switch
    # Lefi AI assistant (ADR-067): answers using the model at once (ADR-003) and the limit of one
    # model call. A local model on one GPU: keep 1 unless the AI node was measured for more.
    ai_concurrency: int = Field(default=1, ge=1, le=4)
    ai_timeout_s: float = Field(default=180.0, ge=10, le=900)

    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"

    # Identity (milestone 2). The installer writes the bootstrap admin; it is used only
    # while the database has no user at all.
    bootstrap_admin_username: str | None = None
    bootstrap_admin_password: SecretStr | None = None
    session_idle_minutes: int = Field(default=480, ge=5, le=7 * 24 * 60)
    session_max_hours: int = Field(default=24, ge=1, le=30 * 24)
    session_cookie_secure: bool = False  # true once the clients reach the Brain over TLS
    login_max_failures: int = Field(default=5, ge=1, le=100)
    login_lock_minutes: int = Field(default=15, ge=1, le=24 * 60)
    # Client devices (ADR-048). With the HTTPS gateway on this PC the installer turns this on: every
    # request through Lefi Gateway then needs a paired device's certificate (verified by Caddy).
    device_cert_required: bool = False
    # Caddy's own local CA (ADR-042): what a paired Lefi Desktop pins for HTTPS to the gateway.
    gateway_ca_file: Path | None = None

    @field_validator("database_url")
    @classmethod
    def _known_driver(cls, value: str) -> str:
        if value and not value.startswith(("sqlite+aiosqlite:///", "postgresql+asyncpg://")):
            raise ValueError(
                "LEFI_DATABASE_URL must start with sqlite+aiosqlite:/// "
                "(or postgresql+asyncpg:// once ADR-011's PostgreSQL path exists)"
            )
        return value

    @property
    def resolved_database_url(self) -> str:
        if self.database_url:
            return self.database_url
        return f"sqlite+aiosqlite:///{self.state_dir / 'data' / 'lefi.db'}"

    @property
    def log_dir(self) -> Path:
        return self.state_dir / "logs"

    @property
    def backup_dir(self) -> Path:
        return self.state_dir / "backups"

    @property
    def ca_dir(self) -> Path:
        """The Brain's issuing CA (key 600, folder 700). Never in the database or `.env`."""
        return self.state_dir / "ca"

    @property
    def resolved_mqtt_passwd_file(self) -> Path:
        return self.mqtt_passwd_file or self.state_dir / "mosquitto" / "passwd"

    @property
    def ai_kill_flag(self) -> Path:
        """ADR-021: `lefi ai off` creates this file; the Brain must honour it."""
        return self.state_dir / "flags" / "ai.disabled"

    def redacted(self) -> dict[str, object]:
        data = self.model_dump(mode="json")
        for secret in ("mqtt_password", "bootstrap_admin_password"):
            if data.get(secret):
                data[secret] = "***"
        data["resolved_database_url"] = self.resolved_database_url
        return data


def load_settings() -> Settings:
    """Build settings from the process environment plus `LEFI_ENV_FILE` (if set)."""
    return Settings(_env_file=_env_file())


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return load_settings()
