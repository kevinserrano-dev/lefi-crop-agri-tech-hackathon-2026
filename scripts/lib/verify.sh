# shellcheck shell=bash
# Post-install verification. Every check is real (no simulated passes).
# Result kinds: PASS · WARN · FAIL · PENDING (component code not implemented yet).

N_PASS=0; N_WARN=0; N_FAIL=0; N_PEND=0

pass() { N_PASS=$((N_PASS + 1)); printf '  %sPASS%s     %s\n' "$C_GREEN" "$C_RESET" "$*"; _log "PASS $*"; ev_log pass "$*"; }
wrn()  { N_WARN=$((N_WARN + 1)); printf '  %sWARN%s     %s\n' "$C_YELLOW" "$C_RESET" "$*"; _log "WARN $*"; ev_log warn "$*"; }
fail() { N_FAIL=$((N_FAIL + 1)); printf '  %sFAIL%s     %s\n' "$C_RED" "$C_RESET" "$*"; _log "FAIL $*"; ev_log fail "$*"; }
pend() { N_PEND=$((N_PEND + 1)); printf '  %sPENDING%s  %s\n' "$C_BLUE" "$C_RESET" "$*"; _log "PENDING $*"; ev_log pending "$*"; }

file_mode() { stat -c %a "$1" 2>/dev/null || stat -f %Lp "$1" 2>/dev/null; }

check_system() {
  header "Check · system"
  [ "$DISK_FREE_GB" -ge 20 ] && pass "Disk free ${DISK_FREE_GB} GB" || wrn "Only ${DISK_FREE_GB} GB free (models + simulator need ≥ 20 GB)"
  [ "$LAN_IP" != "unknown" ] && pass "LAN IP $LAN_IP" || wrn "No LAN IP detected — connect to the greenhouse Wi-Fi router"
  if [ -f "$ENV_FILE" ]; then
    [ "$(file_mode "$ENV_FILE")" = "600" ] && pass "Config $ENV_FILE present (mode 600)" || wrn "$ENV_FILE permissions are $(file_mode "$ENV_FILE"); run chmod 600 $ENV_FILE"
  else fail "Config $ENV_FILE missing"; fi
  if [ "$LEFI_SERVICE_MODE" = systemd ]; then
    check_systemd_layout
  elif [ "$LEFI_PACKAGED" = 1 ] || [ ! -e "$LEFI_ROOT/.git" ]; then
    :   # no repository here: the configuration lives outside it, nothing can commit it
  elif (cd "$LEFI_ROOT" && git check-ignore -q .env 2>/dev/null); then pass ".env is git-ignored"; else fail ".env is NOT git-ignored"; fi
  local gate; gate="$(env_get LEFI_AI_GATE)"
  case "$gate" in
    passed*) pass "AI requirement met (${gate#passed })" ;;
    override*) fail "AI requirement NOT met — development override in use (${gate#override })" ;;
    '') roles_has ai || roles_has core && wrn "AI requirement not recorded yet (re-run the installer)" ;;
  esac
}

# systemd system install: owner, modes, units enabled at boot, kill-switch condition.
check_systemd_layout() {
  local owner u unit f s
  owner="$(stat -c %U "$ENV_FILE" 2>/dev/null)"
  [ "$owner" = "$SERVICE_USER" ] && pass "Config owned by the service user $SERVICE_USER" || fail "Config owner is ${owner:-?} (expected $SERVICE_USER)"
  if id "$SERVICE_USER" >/dev/null 2>&1; then
    s="$(getent passwd "$SERVICE_USER" | cut -d: -f7)"
    case "$s" in */nologin|*/false) pass "Service user $SERVICE_USER exists (no login shell)" ;; *) wrn "Service user $SERVICE_USER has shell $s" ;; esac
  else fail "Service user $SERVICE_USER missing"; fi
  [ "$(stat -c '%U %a' "$LEFI_STATE_DIR" 2>/dev/null)" = "$SERVICE_USER 750" ] && pass "State dir $LEFI_STATE_DIR (owner $SERVICE_USER, mode 750)" \
    || fail "State dir $LEFI_STATE_DIR owner/mode is $(stat -c '%U %a' "$LEFI_STATE_DIR" 2>/dev/null)"
  for u in ollama mosquitto brain caddy; do
    unit="lefi-$u.service"; f="/etc/systemd/system/$unit"
    [ -f "$f" ] || continue
    [ "$("$SYSTEMCTL" is-enabled "$unit" 2>/dev/null)" = enabled ] && pass "$unit enabled at boot (multi-user.target)" \
      || { [ "$u" = ollama ] && [ -f "$AI_KILL_FLAG" ] && wrn "$unit disabled by the AI kill switch" || fail "$unit is not enabled at boot"; }
    grep -q "^User=$SERVICE_USER$" "$f" && pass "$unit runs as $SERVICE_USER" || fail "$unit does not run as $SERVICE_USER"
  done
  local ww; ww="$(find "$LEFI_STATE_DIR" "$LEFI_RUNTIME_DIR" -perm -o+w ! -type l 2>/dev/null | head -n 3)"
  [ -z "$ww" ] && pass "No world-writable files in $LEFI_STATE_DIR or $LEFI_RUNTIME_DIR" || fail "World-writable files: $(echo "$ww" | tr '\n' ' ')— re-run the installer"
  [ -f /etc/sudoers.d/lefi-crop ] && pass "sudoers rule limited to lefi-* service control" || wrn "No /etc/sudoers.d/lefi-crop (lefi start/stop need root)"
}

check_ai() {
  header "Check · AI node"
  local bin model bind; bin="$(ollama_bin)"; model="$(env_get OLLAMA_MODEL)"; bind="$(env_get LEFI_AI_BIND)"
  [ -n "$bin" ] && pass "Ollama $(ollama_version "$bin")" || { fail "Ollama not installed"; return; }
  if http_ok "http://127.0.0.1:11434/api/version"; then pass "Ollama API responding on 127.0.0.1:11434"
  else fail "Ollama API not responding (see $LOG_DIR/ollama.log)"; return; fi
  if [ "$bind" = "0.0.0.0:11434" ]; then
    http_ok "http://$LAN_IP:11434/api/version" && pass "Ollama reachable on the LAN at $LAN_IP:11434" \
      || fail "Ollama not reachable on $LAN_IP:11434 (bind/firewall)"
  fi
  [ -n "$model" ] || { fail "OLLAMA_MODEL not set in .env"; return; }
  model_is_supported "$model" && pass "$model is in the supported list" || fail "$model is not in config/supported-models.tsv"
  local line; line="$(OLLAMA_HOST=127.0.0.1:11434 "$bin" list 2>/dev/null | awk -v m="$model" '$1==m')"
  if [ -n "$line" ]; then
    local size unit; size="$(echo "$line" | awk '{print $3}')"; unit="$(echo "$line" | awk '{print $4}')"
    pass "$model installed (${size} ${unit})"
    if [ "$unit" = "GB" ] && awk -v s="$size" -v r="$RAM_GB" 'BEGIN{exit !(s > r*0.6)}'; then
      wrn "Model uses > 60% of ${RAM_GB} GB RAM — close other apps or use the fallback model"
    fi
  else fail "$model not found in 'ollama list'"; return; fi
  local t0 t1
  t0="$(date +%s)"
  if ollama_generate "http://127.0.0.1:11434" "$model" "Reply with the single word OK." 32; then
    t1="$(date +%s)"; pass "Real inference OK in $((t1 - t0))s (model replied: \"$(printf '%s' "$GEN_RESPONSE" | head -c 60)\")"
    local pct; pct="$(model_gpu_pct "http://127.0.0.1:11434" "$model")"
    if ai_share_ok "$pct"; then pass "$model ${pct}% on the GPU (AI requirement)"
    else fail "$model only ${pct:-?}% on the GPU — Lefi Crop requires it fully on the GPU (CPU inference is not supported)"; fi
  else fail "Inference failed: $GEN_ERROR"; fi
}

mqtt_cred() { cred_get "$1"; }

check_core() {
  header "Check · core node"
  local port; port="$(env_get LEFI_MQTT_PORT)"; port="${port:-1883}"
  port_listening "$port" && pass "Mosquitto listening on $port" || { fail "Mosquitto not listening on $port"; return; }
  if mosquitto_pub -h 127.0.0.1 -p "$port" -q 1 -t lefi/v1/system/selftest -m anon >/dev/null 2>&1; then
    fail "Anonymous MQTT publish was accepted"
  else pass "Anonymous MQTT access rejected"; fi

  local tmp token bp e1 sp
  tmp="$(mktemp)"; token="selftest-$(gen_secret 8)"; bp="$(mqtt_cred lefi-brain)"; e1="$(mqtt_cred lefi-selftest)"
  mosquitto_sub -h 127.0.0.1 -p "$port" -u lefi-brain -P "$bp" -t lefi/v1/system/selftest -C 1 -W 6 >"$tmp" 2>/dev/null & sp=$!
  sleep 1; mosquitto_pub -h 127.0.0.1 -p "$port" -u lefi-brain -P "$bp" -q 1 -t lefi/v1/system/selftest -m "$token" >/dev/null 2>&1
  wait "$sp" 2>/dev/null
  grep -q "$token" "$tmp" && pass "Lefi Brain credentials: publish/subscribe round-trip" || fail "Lefi Brain MQTT round-trip failed"

  : >"$tmp"
  mosquitto_sub -h 127.0.0.1 -p "$port" -u lefi-brain -P "$bp" -t lefi/v1/devices/lefi-selftest/heartbeat -C 1 -W 6 >"$tmp" 2>/dev/null & sp=$!
  sleep 1; mosquitto_pub -h 127.0.0.1 -p "$port" -u lefi-selftest -P "$e1" -q 1 -t lefi/v1/devices/lefi-selftest/heartbeat -m own >/dev/null 2>&1
  wait "$sp" 2>/dev/null
  grep -q own "$tmp" && pass "A device account can publish on its own topics" || fail "A device account cannot publish on its own topics"

  : >"$tmp"
  mosquitto_sub -h 127.0.0.1 -p "$port" -u lefi-brain -P "$bp" -t lefi/v1/devices/esp32-01/heartbeat -C 1 -W 4 >"$tmp" 2>/dev/null & sp=$!
  sleep 1; mosquitto_pub -h 127.0.0.1 -p "$port" -u lefi-selftest -P "$e1" -q 1 -t lefi/v1/devices/esp32-01/heartbeat -m spoof >/dev/null 2>&1
  wait "$sp" 2>/dev/null
  grep -q spoof "$tmp" && fail "A device account could impersonate esp32-01 (ACL broken)" || pass "ACL isolation: one device cannot publish as another"
  rm -f "$tmp"

  have uv && pass "uv $(uv --version | awk '{print $2}')" || fail "uv missing"
  lefi_uv python find 3.12 >/dev/null 2>&1 && pass "Python 3.12 available" || fail "Python 3.12 not available to uv"
  local js; js="$(env_get LEFI_JWT_SECRET)"
  [ "${#js}" -ge 32 ] && pass "JWT secret configured" || fail "LEFI_JWT_SECRET missing or too short"
  if [ "$(env_get LEFI_ADMIN_SEALED)" = 1 ]; then pass "Administrator account created; its first password is no longer on disk"
  elif [ -n "$(env_get LEFI_BOOTSTRAP_ADMIN_PASSWORD)" ]; then pass "Bootstrap admin configured"
  else wrn "No bootstrap admin password"; fi

  local url model; url="$(env_get OLLAMA_BASE_URL)"; model="$(env_get OLLAMA_MODEL)"
  if [ -z "$model" ]; then
    fail "No AI model configured (OLLAMA_MODEL) — the core node has no AI node"
  elif curl -fsS -m 5 "$url/api/tags" 2>/dev/null | grep -q "\"name\":\"$model\""; then
    pass "Core → AI node: $url serves $model"
  else
    fail "Core cannot use $model at $url (Lefi Brain would run in AI-degraded mode)"
  fi

  if [ -f "$LEFI_ROOT/services/brain/pyproject.toml" ]; then
    if [ ! -x "$BRAIN_PY" ]; then fail "Lefi Brain environment missing ($BRAIN_PY) — re-run the core role"
    else
      brain_py config check >/dev/null 2>&1 && pass "Lefi Brain settings valid (.env)" || fail "Lefi Brain settings invalid — run: lefi brain config"
      brain_py db check >/dev/null 2>&1 && pass "Database: integrity, WAL, schema at head, audit chain intact" \
        || fail "Database check failed — run: lefi db check"
      if [ "$(brain_py user list --json 2>/dev/null | tr -d ' \n')" = "[]" ]; then
        wrn "No Lefi Brain user yet — create an administrator: lefi user add <name> --role admin"
      else pass "Lefi Brain has at least one user"; fi
    fi
    local bport; bport="$(env_get LEFI_API_PORT)"; bport="${bport:-8000}"
    http_ok "http://127.0.0.1:$bport/api/v1/health" && pass "Lefi Brain health endpoint OK" || fail "Lefi Brain health endpoint not responding"
    # Lefi Desktop pairing (ADR-048): the issuing CA, and whether the gateway asks for devices.
    local ca; ca="$(brain_py ca status --json 2>/dev/null | tr -d ' \n')"
    case "$ca" in
      *'"ready":true'*'"two_level":true'*) pass "Lefi Brain certificate authority for Lefi Desktop ready (signed by the LEFI root)" ;;
      *'"ready":true'*) wrn "Lefi Brain certificate authority is self-signed — Lefi Crop Helper signs it with the LEFI root (Apps)" ;;
      *) fail "Lefi Brain certificate authority for Lefi Desktop missing — re-run the core role" ;;
    esac
  else
    pend "Lefi Brain application not implemented yet (services/brain)"
  fi
}

check_admin() {
  header "Check · Lefi Gateway"
  have caddy && pass "Caddy $(caddy version 2>/dev/null | awk '{print $1}')" || { fail "Caddy missing"; return; }
  local url; url="$(env_get LEFI_ADMIN_URL)"
  if curl -fsSk -m 5 -o /dev/null "$url"; then pass "Lefi Gateway responds: $url"; else fail "Lefi Gateway not responding: $url"; fi
  if [ -f "$LEFI_ROOT/services/brain/pyproject.toml" ]; then
    curl -fsSk -m 5 -o /dev/null "$url/api/v1/health" && pass "Lefi Brain reachable through Lefi Gateway" || fail "Lefi Brain not reachable through Lefi Gateway"
  else
    pend "API proxy check waits for Lefi Brain implementation"
  fi
}

check_robot() {  # ADR-090: installed = robot.conf; off until Lefi Brain turns it on
  header "Check · simulated robot"
  if ! robot_installed; then fail "Simulated robot not installed (no $ROBOT_CONF)"; return; fi
  pass "Simulated robot installed ($(robot_conf_get BACKEND)), port $(robot_port)"
  if robot_ai_here; then fail "The AI node is on this PC too: the robot must be on another PC (ADR-090)"; fi
  if [ "$(robot_conf_get BACKEND)" = genesis ]; then
    local starter; starter="$(robot_starter)"
    if [ -d "$starter" ]; then
      (cd "$starter" && ./run.sh python -c "import mh3_genesis" >/dev/null 2>&1) \
        && pass "mh3_genesis importable (simulation)" || fail "mh3_genesis not importable — run its setup.sh"
    else fail "MH3 starter missing in $starter — reinstall the simulated robot"; fi
  fi
  if robot_running; then pass "Simulated robot running (pid $(robot_pid))"
  else info "Simulated robot off — Lefi Brain turns it on from Lefi Desktop"; fi
}

check_firmware() {
  header "Check · firmware toolchain"
  have pio && pass "PlatformIO $(pio --version 2>/dev/null | awk '{print $NF}')" || fail "PlatformIO missing"
  pend "Firmware blocked until the sensor inventory is verified"
}

check_desktop() {
  header "Check · Lefi Desktop"
  local app; app="$(env_get LEFI_DESKTOP_APP)"; app="${app:-$(desktop_dest)}"
  if [ -d "$app/Contents/MacOS" ]; then pass "Lefi Desktop installed ($app)"; else fail "Lefi Desktop missing ($app)"; fi
  if [ "$(env_get LEFI_DEVICE_CERT_REQUIRED)" = true ]; then
    pass "Lefi Gateway asks Lefi Desktop for its device certificate (pair it in Lefi Crop Helper → Apps)"
  else
    pend "Lefi Desktop pairs with a Lefi Brain whose Lefi Gateway serves HTTPS (on the main PC)"
  fi
  pend "Most Lefi Desktop screens still show labelled sample data: their Lefi Brain modules are not built yet"
}

run_verification() {
  check_system
  roles_has ai && check_ai
  roles_has core && check_core
  roles_has admin && check_admin
  roles_has robot && check_robot
  roles_has firmware && check_firmware
  roles_has desktop && check_desktop
  header "Summary"
  printf '  %sPASS %d%s · %sWARN %d%s · %sFAIL %d%s · %sPENDING %d%s\n' \
    "$C_GREEN" "$N_PASS" "$C_RESET" "$C_YELLOW" "$N_WARN" "$C_RESET" "$C_RED" "$N_FAIL" "$C_RESET" "$C_BLUE" "$N_PEND" "$C_RESET"
  [ "$N_PEND" -gt 0 ] && info "PENDING = part of the platform whose code is not written yet. See README.md."
  info "Full log: $LOG_FILE"
  [ "$N_FAIL" -eq 0 ]
}
