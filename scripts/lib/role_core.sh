# shellcheck shell=bash
# Role: Core node — Brain backend (Python/uv) + Mosquitto + SQLite data directory.

# Service accounts only. Each ESP32 gets its own account from Lefi Brain when it is added in
# Lefi Desktop (ADR-052); lefi-selftest exists only for the ACL check in `lefi check`.
MQTT_USERS="lefi-brain lefi-sim lefi-robot lefi-selftest"
CRED_DIR="$LEFI_STATE_DIR/credentials"
MQTT_CRED_FILE="$CRED_DIR/mqtt.env"

BRAIN_DIR="$LEFI_ROOT/services/brain"
# systemd mode: the Brain runs from a root-owned, non-editable environment in /opt/lefi-crop, so
# the service user never needs to read the git checkout (ADR-029).
if [ "$LEFI_SERVICE_MODE" = systemd ]; then
  BRAIN_VENV="$LEFI_RUNTIME_DIR/brain-venv"
elif [ "$LEFI_PACKAGED" = 1 ]; then
  BRAIN_VENV="$LEFI_STATE_DIR/runtime/brain-venv"   # never inside the signed app (ADR-034)
else
  BRAIN_VENV="$BRAIN_DIR/.venv"
fi
BRAIN_PY="$BRAIN_VENV/bin/python"

# lefi_uv ARGS... — uv with the Python runtime and Brain environment of this layout.
lefi_uv() {
  if [ "$LEFI_SERVICE_MODE" = systemd ]; then
    env UV_PYTHON_INSTALL_DIR="$LEFI_RUNTIME_DIR/python" UV_PROJECT_ENVIRONMENT="$BRAIN_VENV" uv "$@"
  elif [ "$LEFI_PACKAGED" = 1 ]; then env UV_PROJECT_ENVIRONMENT="$BRAIN_VENV" uv "$@"
  else uv "$@"; fi
}

# brain_py ARGS... — run the Brain's operations CLI (python -m lefi_brain) with this node's
# .env and state dir, so the CLI and the Brain always look at the same database.
brain_py() {
  [ -x "$BRAIN_PY" ] || { err "Lefi Brain environment missing ($BRAIN_PY). Run: lefi setup (core role)"; return 2; }
  as_service_user env LEFI_ENV_FILE="$ENV_FILE" LEFI_STATE_DIR="$LEFI_STATE_DIR" \
    LEFI_CLI_USER="${LEFI_CLI_USER:-${SUDO_USER:-$(id -un)}}" "$BRAIN_PY" -m lefi_brain "$@"
}

cred_get() { [ -f "$MQTT_CRED_FILE" ] && grep -E "^$1=" "$MQTT_CRED_FILE" | tail -n1 | cut -d= -f2-; }

ensure_mqtt_credentials() {
  [ "$DRY_RUN" = "1" ] && { info "[dry-run] generate MQTT passwords for: $MQTT_USERS"; return 0; }
  _j j_mkdir "$CRED_DIR"; _j j_file "$MQTT_CRED_FILE"
  mkdir -p "$CRED_DIR"; chmod 700 "$CRED_DIR"
  [ -f "$MQTT_CRED_FILE" ] || { : >"$MQTT_CRED_FILE"; }
  chmod 600 "$MQTT_CRED_FILE"
  local u
  for u in $MQTT_USERS; do
    [ -n "$(cred_get "$u")" ] || printf '%s=%s\n' "$u" "$(gen_secret 32)" >>"$MQTT_CRED_FILE"
  done
  ok "MQTT service credentials in $MQTT_CRED_FILE (chmod 600; devices get theirs from Lefi Brain)"
}

# Creates the file on a first install; afterwards only the service accounts are (re)written, so the
# device accounts Lefi Brain added (ADR-052) survive a re-install or an update.
build_mosquitto_passwd() {
  local pw="$LEFI_STATE_DIR/mosquitto/passwd" u
  [ "$DRY_RUN" = "1" ] && { run mosquitto_passwd -b "$pw" "<service user>" "<password>"; return 0; }
  _j j_file "$pw"
  [ -f "$pw" ] || { : >"$pw"; }
  chmod 600 "$pw"
  for u in $MQTT_USERS; do
    mosquitto_passwd -b "$pw" "$u" "$(cred_get "$u")" >>"$LOG_FILE" 2>&1 || return 1
  done
  chmod 600 "$pw"
}

# Supported models served by an Ollama URL (intersection of /api/tags and the TSV).
remote_supported_models() {
  curl -fsS -m 5 "$1/api/tags" 2>/dev/null | awk '{gsub(/"name":/, "\n\"name\":"); print}' \
    | sed -n 's/^"name":"\([^"]*\)".*/\1/p' | while read -r m; do model_is_supported "$m" && echo "$m"; done
}

# Core without the ai role: Lefi Crop needs a viable AI node on the LAN (ADR-028, option A).
configure_ai_endpoint() {
  if roles_has ai; then
    env_set OLLAMA_BASE_URL "http://127.0.0.1:11434"
    step_skip core.ai "the AI runs on this machine (verified in ai.verify)"
    return 0
  fi
  step_begin core.ai
  local cur; cur="$(env_get OLLAMA_BASE_URL)"
  ask "URL of the AI node running Ollama" "${cur:-http://192.168.8.20:11434}" AI_URL
  local url="${REPLY%/}" models want
  if [ "$DRY_RUN" = 1 ]; then
    info "[dry-run] would verify that $url serves a supported model fully on its GPU"
    env_set OLLAMA_BASE_URL "$url"; return 0
  fi
  if ! http_ok "$url/api/version" 5; then
    ai_gate_fail "AI node not reachable at $url. Lefi Crop requires a working AI node." \
      "Install the AI role first on a PC with a supported GPU (./scripts/install.sh --roles ai), then re-run here."
    env_set OLLAMA_BASE_URL "$url"; return 0
  fi
  ok "AI node reachable at $url"
  models="$(remote_supported_models "$url")"
  answer_get MODEL && [ "$ANSWER" != recommended ] && want="$ANSWER"
  if [ -n "$want" ]; then
    printf '%s\n' "$models" | grep -qx "$want" || models=""
    [ -n "$models" ] && models="$want"
  fi
  AI_MODEL="$(printf '%s\n' "$models" | head -n1)"
  if [ -z "$AI_MODEL" ]; then
    ai_gate_fail "The AI node at $url serves no supported model${want:+ ($want)}." \
      "Finish the AI role on that PC (lefi check there), then re-run here."
    env_set OLLAMA_BASE_URL "$url"; return 0
  fi
  [ "$(printf '%s\n' "$models" | grep -c .)" -gt 1 ] && info "Several supported models served; using $AI_MODEL (set MODEL= in the answers file to choose)"
  step "Verifying that $AI_MODEL runs fully on the AI node's GPU (real generation)"
  if ! ai_measure "$url" "$AI_MODEL"; then
    ai_gate_fail "The AI node could not run $AI_MODEL: $GEN_ERROR" "Run 'lefi ai diagnose' on the AI node."
  elif ! ai_share_ok "$AI_GPU_PCT"; then
    ai_gate_fail "$AI_MODEL runs only ${AI_GPU_PCT:-?}% on the AI node's GPU (100% required: CPU inference is not supported)." \
      "Use a PC with a supported GPU for the AI role, or the lighter model."
  else
    ok "$AI_MODEL: ${AI_GPU_PCT}% on GPU · ${AI_SIZE_GB} GB · ctx ${AI_CTX:-?} (measured now)"
    env_set LEFI_AI_GATE "passed $(date -u +%Y-%m-%dT%H:%M:%SZ): remote $url $AI_MODEL ${AI_GPU_PCT}% GPU"
  fi
  env_set OLLAMA_BASE_URL "$url"
  env_set OLLAMA_MODEL "$AI_MODEL"
}

configure_admin_password() {
  # The first password was shown once and removed from disk (ADR-043): a new one here would not match
  # the account in the database, and the Brain does not create the account twice.
  if [ "$(env_get LEFI_ADMIN_SEALED)" = 1 ]; then info "Administrator account already created (kept)"; return 0; fi
  if [ -n "$(env_get LEFI_BOOTSTRAP_ADMIN_PASSWORD)" ]; then info "Bootstrap admin password already set (kept)"; return 0; fi
  local p1="" p2=""
  if answer_get ADMIN_PASSWORD_FILE && [ -n "$ANSWER" ]; then
    [ -r "$ANSWER" ] || die "ADMIN_PASSWORD_FILE not readable: $ANSWER"
    p1="$(head -n1 "$ANSWER" | tr -d '\r\n')"
    [ ${#p1} -ge 10 ] || die "The password in ADMIN_PASSWORD_FILE is shorter than 10 characters."
    info "Bootstrap admin password read from ADMIN_PASSWORD_FILE (not logged)"
  elif [ "$ASSUME_YES" != "1" ] && confirm "Type the first administrator password yourself? (No = generate one)" n ADMIN_TYPE_PASSWORD; then
    while :; do
      ask_secret "Admin password (min 10 chars)"; p1="$REPLY"
      ask_secret "Repeat password"; p2="$REPLY"
      [ "$p1" = "$p2" ] && [ ${#p1} -ge 10 ] && break
      warn "Passwords differ or are shorter than 10 characters."
    done
  else
    p1="$(gen_secret 20)"
  fi
  env_set LEFI_BOOTSTRAP_ADMIN_USERNAME admin
  env_set LEFI_BOOTSTRAP_ADMIN_PASSWORD "$p1"
  if [ "$DRY_RUN" != "1" ]; then
    _j j_mkdir "$CRED_DIR"; _j j_file "$CRED_DIR/admin.txt"
    mkdir -p "$CRED_DIR"; chmod 700 "$CRED_DIR"
    printf 'username=admin\npassword=%s\n' "$p1" >"$CRED_DIR/admin.txt"; chmod 600 "$CRED_DIR/admin.txt"
    ok "Admin credentials stored in $CRED_DIR/admin.txt (chmod 600) — change after first login"
  fi
}

role_core_install() {
  header "Core node · Lefi Brain backend + MQTT broker + database"
  step_begin core.packages
  [ "$LEFI_SERVICE_MODE" = systemd ] && ensure_epel
  local mosq_new=0
  have mosquitto || [ -x /usr/sbin/mosquitto ] || mosq_new=1
  if [ -x /usr/sbin/mosquitto ] && ! have mosquitto; then ok "mosquitto present (/usr/sbin)"
  else pkg_install mosquitto mosquitto "mosquitto mosquitto-clients" "mosquitto" || die "Mosquitto required."; fi
  have mosquitto_passwd || [ "$DRY_RUN" = "1" ] || die "mosquitto_passwd missing (Linux: mosquitto package)."
  have mosquitto_pub || pkg_install mosquitto_pub mosquitto "mosquitto-clients" "mosquitto" || die "mosquitto clients required."
  vendor_service_off mosquitto.service "$mosq_new"
  install_uv || die "uv required."
  step "Ensuring Python 3.12+ via uv"
  local pydir had_py=0; pydir="$(lefi_uv python dir 2>/dev/null)"
  ls -d "$pydir"/cpython-3.12* >/dev/null 2>&1 && had_py=1
  run lefi_uv python install 3.12 || die_known "uv could not install Python 3.12."
  [ "$had_py" = 1 ] || [ "$LEFI_SERVICE_MODE" = systemd ] || _j j_add uv_python 3.12   # systemd: inside $LEFI_RUNTIME_DIR
  ok "Python 3.12 available to uv$( [ "$LEFI_SERVICE_MODE" = systemd ] && echo " ($LEFI_RUNTIME_DIR/python)")"

  configure_ai_endpoint

  step_begin core.mqtt
  step "Configuring Mosquitto"
  local bind="0.0.0.0" port
  port="$(env_get LEFI_MQTT_PORT)"; port="${port:-1883}"
  info "ESP32 nodes reach the broker over Wi-Fi, so it listens on the LAN (port $port)."
  if [ "$DRY_RUN" != "1" ]; then
    _j j_mkdir "$LEFI_STATE_DIR/mosquitto/data"; _j j_mkdir "$LEFI_STATE_DIR/mosquitto/log"; _j j_mkdir "$LEFI_STATE_DIR/data"
    mkdir -p "$LEFI_STATE_DIR/mosquitto/data" "$LEFI_STATE_DIR/mosquitto/log" "$LEFI_STATE_DIR/data"
  fi
  render "$LEFI_ROOT/deploy/mosquitto/mosquitto.conf.template" "$LEFI_STATE_DIR/mosquitto/mosquitto.conf" \
    "STATE_DIR=$LEFI_STATE_DIR" "MQTT_PORT=$port" "MQTT_BIND=$bind" \
    "RUN_USER=$( [ "$LEFI_SERVICE_MODE" = systemd ] && echo "$SERVICE_USER" || id -un)"
  render "$LEFI_ROOT/deploy/mosquitto/acl.template" "$LEFI_STATE_DIR/mosquitto/acl" "STATE_DIR=$LEFI_STATE_DIR"
  [ "$DRY_RUN" = "1" ] || chmod 600 "$LEFI_STATE_DIR/mosquitto/acl"
  ensure_mqtt_credentials
  build_mosquitto_passwd || die "Could not build the Mosquitto password file."
  local mosq; mosq="$(command -v mosquitto || echo mosquitto)"
  [ -x "$mosq" ] || { [ -x /usr/sbin/mosquitto ] && mosq=/usr/sbin/mosquitto; }
  start_service mosquitto "$LOG_DIR/mosquitto.log" "" "$mosq" -c "$LEFI_STATE_DIR/mosquitto/mosquitto.conf" \
    || die "Could not start Mosquitto."
  wait_for_port "$port" 15 || die "Mosquitto is not listening on $port (see $LEFI_STATE_DIR/mosquitto/log/)."
  ok "Mosquitto listening on $port (anonymous access disabled, per-device ACL)"

  step_begin core.config
  step "Writing Lefi Brain configuration ($ENV_FILE)"
  env_set LEFI_ENV production
  # With the gateway on this PC, the Brain answers only through it: otherwise anyone on the network
  # could skip HTTPS and reach port 8000 directly (ADR-042). A gateway on another PC still needs the LAN.
  if roles_has admin; then env_set LEFI_API_HOST 127.0.0.1; else env_set LEFI_API_HOST 0.0.0.0; fi
  env_set LEFI_API_PORT 8000
  env_set LEFI_DATABASE_URL "sqlite+aiosqlite:///$LEFI_STATE_DIR/data/lefi.db"
  env_set LEFI_MQTT_HOST 127.0.0.1
  env_set LEFI_MQTT_PORT "$port"
  env_set LEFI_MQTT_USERNAME lefi-brain
  env_set LEFI_MQTT_PASSWORD "$(cred_get lefi-brain)"
  env_ensure_secret LEFI_JWT_SECRET 64
  env_set LEFI_CORS_ORIGINS "http://$LAN_IP:8080,http://localhost:8080,http://localhost:3000"
  configure_admin_password

  step_begin core.brain
  if [ -f "$BRAIN_DIR/pyproject.toml" ]; then
    step "Installing Lefi Brain dependencies"
    _j j_tree "$BRAIN_VENV"
    if [ "$LEFI_SERVICE_MODE" = systemd ] || [ "$LEFI_PACKAGED" = 1 ]; then
      run lefi_uv sync --project "$BRAIN_DIR" --python 3.12 --locked --no-dev --no-editable --reinstall-package lefi-brain || die_known "uv sync failed."
    else
      run uv sync --project "$BRAIN_DIR" --python 3.12 --locked --no-dev || die_known "uv sync failed."
    fi
    runtime_fix_perms
    ok "Lefi Brain dependencies installed ($BRAIN_VENV)"
    step "Creating / migrating the database"
    if [ "$DRY_RUN" = "1" ]; then info "[dry-run] python -m lefi_brain db migrate"
    else
      local db="$LEFI_STATE_DIR/data/lefi.db" dbcopy
      if [ -f "$db" ]; then   # an existing database: keep a consistent copy for the rollback
        dbcopy="$(brain_py db backup 2>>"$LOG_FILE" | tail -n1)" && [ -f "$dbcopy" ] && _j j_add db_backup "$db" "$dbcopy" \
          || _j j_add manual "The existing database could not be copied before migrating; a rollback cannot restore it."
      else _j j_file "$db"; _j j_file "$db-wal"; _j j_file "$db-shm"; fi
      brain_py db migrate >>"$LOG_FILE" 2>&1 || die "Database migration failed (see $LOG_FILE)."
      ok "Database ready: $(brain_py db path)"; fi
    core_issuing_ca
    core_start_brain
  else
    warn "Lefi Brain application code is not implemented yet (services/brain) — prerequisites are ready."
  fi
}

# Lefi Brain's issuing CA for Lefi Desktop devices (ADR-048). Created once, kept across re-installs
# (paired devices depend on it). Self-signed here; Lefi Crop Helper replaces its certificate with one
# signed by the LEFI root (same key, so paired devices stay valid).
core_issuing_ca() {
  step "Preparing Lefi Brain's certificate authority for Lefi Desktop"
  if [ "$DRY_RUN" = "1" ]; then info "[dry-run] python -m lefi_brain ca self-sign (only if missing)"; return 0; fi
  if brain_py ca status >/dev/null 2>&1; then ok "Issuing CA already set up (kept)"; return 0; fi
  [ -d "$LEFI_STATE_DIR/ca" ] || _j j_tree "$LEFI_STATE_DIR/ca"
  brain_py ca self-sign >>"$LOG_FILE" 2>&1 || die "Could not create Lefi Brain's issuing CA (see $LOG_FILE)."
  ok "Issuing CA created (key stays on this PC, mode 600)"
}

core_start_brain() {
  step "Starting Lefi Brain"
  start_service brain "$LOG_DIR/brain.log" "LEFI_ENV_FILE=$ENV_FILE LEFI_STATE_DIR=$LEFI_STATE_DIR" \
    "$BRAIN_PY" -m lefi_brain serve || die "Could not start Lefi Brain."
  wait_for_port "$(env_get LEFI_API_PORT | sed 's/^$/8000/')" 20 \
    && ok "Lefi Brain listening on port $(env_get LEFI_API_PORT | sed 's/^$/8000/')" \
    || warn "Lefi Brain started but its port is not open yet — see: lefi logs brain"
}
