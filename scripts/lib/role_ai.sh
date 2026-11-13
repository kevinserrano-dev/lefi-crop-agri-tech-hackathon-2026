# shellcheck shell=bash
# Role: AI node — Ollama + one owner-approved model (config/supported-models.tsv).

OLLAMA_LOCAL="127.0.0.1:11434"

models_rows() { grep -vE '^[[:space:]]*(#|$)' "$MODELS_FILE"; }

model_is_supported() { models_rows | cut -f1 | grep -qx "$1"; }

# select_model -> sets AI_MODEL. Only models that can run on this machine's GPU (fit gpu) or
# whose fit cannot be predicted (unknown → verified after install) are offered (ADR-028).
select_model() {
  local i=0 rec=1 tag label fit
  [ -f "$MODELS_FILE" ] || die "Missing $MODELS_FILE"
  [ -n "$HW_SCANNED_AT" ] || hw_scan
  recommend_models
  recommend_print
  if [ "$REC_VERDICT" = not_viable ]; then
    ai_gate_fail "This PC cannot run the Lefi Crop AI: $REC_REASON." \
      "Lefi Crop requires the local AI. Install the ai role on a PC with a supported GPU (NVIDIA/AMD with enough VRAM, or Apple Silicon); this PC can still be the core node."
    AI_MODEL="$(models_rows | head -n1 | cut -f1)"; AI_FIT=no; return 0
  fi
  info "Models this PC may install:"
  while IFS="$(printf '\t')" read -r tag _ label _; do
    fit="$(model_fit "$tag")"; [ "$fit" = no ] && continue
    i=$((i + 1)); eval "MODEL_OPT_$i=\$tag"
    [ "$tag" = "$REC_TAG" ] && rec="$i"
    printf '    %d) %-12s %s · fit: %s%s\n' "$i" "$tag" "$label" "$fit" "$( [ "$tag" = "$REC_TAG" ] && printf ' %s(recommended)%s' "$C_GREEN" "$C_RESET")"
  done <<ROWS
$(models_rows)
ROWS
  local cur; cur="$(env_get OLLAMA_MODEL)"
  [ -n "$cur" ] && model_is_supported "$cur" && info "Currently configured: $cur"
  if answer_get MODEL; then
    if [ "$ANSWER" = recommended ] || [ -z "$ANSWER" ]; then AI_MODEL="$REC_TAG"
    else
      model_is_supported "$ANSWER" || { DIE_CODE=ANSWERS_INVALID; die "MODEL=$ANSWER is not in config/supported-models.tsv"; }
      [ "$(model_fit "$ANSWER")" = no ] && ai_gate_fail "MODEL=$ANSWER cannot run on this PC's GPU." "Use MODEL=recommended ($REC_TAG)."
      AI_MODEL="$ANSWER"
    fi
    info "Model (answers file: MODEL=$ANSWER) → $AI_MODEL"
  elif [ -n "$ANSWERS_FILE" ] || [ "$ASSUME_YES" = 1 ]; then
    AI_MODEL="$REC_TAG"; info "Model → $AI_MODEL (recommended; default)"
  else
    while :; do
      ask "Model number" "$rec"
      case "$REPLY" in ''|*[!0-9]*) warn "Enter a number between 1 and $i"; continue ;; esac
      if [ "$REPLY" -ge 1 ] && [ "$REPLY" -le "$i" ]; then eval "AI_MODEL=\$MODEL_OPT_$REPLY"; break; fi
      warn "Enter a number between 1 and $i"
    done
  fi
  AI_FIT="$(model_fit "$AI_MODEL")"
  ok "Model selected: $AI_MODEL (fit: $AI_FIT)"
}

ollama_bin() {
  if have ollama; then command -v ollama
  elif [ -x /Applications/Ollama.app/Contents/Resources/ollama ]; then echo /Applications/Ollama.app/Contents/Resources/ollama
  fi
}

ollama_version() { "$1" --version 2>/dev/null | awk '{v=$NF} END{print v}'; }

# json_str KEY — first JSON string value of KEY on stdin (handles escaped quotes; \n -> space).
json_str() {
  tr -d '\n' | sed -nE "s/.*\"$1\":[[:space:]]*\"(([^\"\\\\]|\\\\.)*)\".*/\1/p" | head -n1 \
    | sed -e 's/\\n/ /g' -e 's/\\"/"/g' -e 's/\\t/ /g'
}

# ollama_generate URL MODEL PROMPT [NUM_PREDICT] [EXTRA_OPTIONS_JSON]
#   -> GEN_BODY, GEN_HTTP (000 = no connection), GEN_RESPONSE, GEN_ERROR (empty on success).
# Reasoning models (e.g. Gemma 4) first write a hidden "thinking" trace; with a small token
# budget the visible "response" stays empty. Smoke tests only need a short answer, so thinking
# is switched off ("think": false); models that reject the flag are retried without it.
ollama_generate() {
  local url="$1" model="$2" prompt="$3" n="${4:-64}" extra="${5:+,$5}" think=',"think":false' out thinking reason
  GEN_BODY=""; GEN_HTTP=""; GEN_RESPONSE=""; GEN_ERROR=""
  while :; do
    out="$(curl -sS -m 300 -w '\nHTTP:%{http_code}' "$url/api/generate" \
      -d "{\"model\":\"$model\",\"prompt\":\"$prompt\",\"stream\":false$think,\"options\":{\"num_predict\":$n$extra}}" 2>&1)"
    GEN_HTTP="$(printf '%s\n' "$out" | sed -n 's/^HTTP:\([0-9]*\)$/\1/p' | tail -n1)"
    GEN_BODY="$(printf '%s\n' "$out" | grep -v '^HTTP:[0-9]*$')"
    if [ -n "$think" ] && printf '%s' "$GEN_BODY" | grep -q '"error"' \
       && printf '%s' "$GEN_BODY" | grep -qi 'think'; then think=""; continue; fi
    break
  done
  GEN_RESPONSE="$(printf '%s' "$GEN_BODY" | json_str response)"
  [ -n "$GEN_RESPONSE" ] && return 0
  GEN_ERROR="$(printf '%s' "$GEN_BODY" | json_str error)"
  if [ -n "$GEN_ERROR" ]; then GEN_ERROR="HTTP ${GEN_HTTP:-?}: $GEN_ERROR"
  elif [ "${GEN_HTTP:-000}" = 000 ]; then
    GEN_ERROR="no connection to $url ($(printf '%s' "$GEN_BODY" | tr '\n' ' ' | head -c 120))"
  else
    thinking="$(printf '%s' "$GEN_BODY" | json_str thinking)"
    reason="$(printf '%s' "$GEN_BODY" | json_str done_reason)"
    if [ -n "$thinking" ]; then
      GEN_ERROR="model only produced reasoning (\"thinking\") and no answer within $n tokens (done_reason: ${reason:-?})"
    else GEN_ERROR="HTTP ${GEN_HTTP:-?}, empty answer: $(printf '%s' "$GEN_BODY" | tr -d '\n' | head -c 160)"; fi
  fi
  return 1
}

# --- Ollama /api/ps helpers (shared by the installer and the CLI)
json_field() {  # json_field KEY  (first string/number value of KEY on stdin; good enough for Ollama replies)
  sed -n "s/.*\"$1\":[[:space:]]*\"\{0,1\}\([^\",}]*\).*/\1/p" | head -n1
}

ps_models() {
  curl -fsS -m 3 "$1/api/ps" 2>/dev/null | awk '{gsub(/\{"name":/, "\n{\"name\":"); print}' | grep '^{"name"'
}

ps_model_line() {  # ps_model_line URL MODEL -> that model's /api/ps entry if it is loaded
  ps_models "$1" | while IFS= read -r m; do [ "$(printf '%s' "$m" | json_field name)" = "$2" ] && printf '%s\n' "$m"; done
  return 0
}

model_gpu_pct() {  # model_gpu_pct URL MODEL -> percent of the model in GPU memory, or empty
  local m; m="$(ps_model_line "$1" "$2" | head -n1)"
  [ -n "$m" ] || return 0
  awk -v s="$(printf '%s' "$m" | json_field size)" -v v="$(printf '%s' "$m" | json_field size_vram)" \
    'BEGIN{ if (s>0) printf "%.0f", v*100/s }'
}

install_ollama() {
  if [ -n "$(ollama_bin)" ]; then ok "Ollama present: $(ollama_version "$(ollama_bin)")"; return 0; fi
  if is_macos; then
    pkg_install ollama ollama
  else
    # Ollama is not in the Ubuntu/RHEL repositories: its official Linux installer is used.
    warn "Ollama is not installed."
    confirm "Run the official Linux installer (curl https://ollama.com/install.sh | sh)?" \
      "$( [ "$LEFI_SERVICE_MODE" = systemd ] && echo y || echo n)" INSTALL_OLLAMA \
      || die "Install Ollama from https://ollama.com/download and re-run."
    # The official script unpacks a .tar.zst archive (found on a real Ubuntu 24.04 run, 2026-11-05).
    [ "$LEFI_SERVICE_MODE" = systemd ] && { have zstd || pkg_install zstd zstd || die "zstd required by the Ollama installer."; }
    [ "$DRY_RUN" = "1" ] && { run sh -c "curl -fsSL https://ollama.com/install.sh | sh"; return 0; }
    _j j_add ollama_script
    curl -fsSL https://ollama.com/install.sh | sh >>"$LOG_FILE" 2>&1 || die "Ollama installation failed (see $LOG_FILE)."
    OLLAMA_INSTALLED_NOW=1
    record_component ollama "$(ollama_version "$(ollama_bin)")" "ollama.com installer"
  fi
}

# PIDs whose executable is ollama and first argument is "serve" (never matches free text).
ollama_serve_pids() {
  ps -axo pid=,command= 2>/dev/null | awk '{b=$2; sub(/.*\//,"",b); if (b=="ollama" && $3=="serve") print $1}'
}

lefi_agent_loaded() { is_macos && lefi_launchctl print "gui/$(id -u)/com.lefi-crop.ollama" >/dev/null 2>&1; }

# Another Ollama server (desktop app, brew service, manual `ollama serve`) would hold port
# 11434 and ignore the LEFI settings (bind address, keep-alive). Detect it and offer to stop it.
stop_foreign_ollama() {
  if ! is_macos; then
    vendor_service_off ollama.service "${OLLAMA_INSTALLED_NOW:-0}"
    if [ "$DRY_RUN" != "1" ] && port_listening 11434 && [ "$LEFI_SERVICE_MODE" = systemd ] \
       && [ "$("$SYSTEMCTL" is-active lefi-ollama.service 2>/dev/null)" != active ]; then
      DIE_CODE=PORT_BUSY; die "Port 11434 is used by another program; stop it and re-run."
    fi
    return 0
  fi
  if pgrep -xq Ollama 2>/dev/null; then
    warn "The Ollama desktop app is running; LEFI CROP manages Ollama as a LaunchAgent instead."
    info "Your downloaded models are kept (both use ~/.ollama)."
    if confirm "Quit the Ollama app now (and remove it from Login Items afterwards)?" y STOP_FOREIGN_OLLAMA; then
      run osascript -e 'quit app "Ollama"'; sleep 2
      _j j_add foreign_ollama_app
    else
      die "Two Ollama servers cannot share port 11434. Quit the app and re-run."
    fi
  fi
  if have brew && brew services list 2>/dev/null | awk '$1=="ollama" && $2=="started"{f=1} END{exit !f}'; then
    warn "Ollama is running as a Homebrew service (brew services)."
    confirm "Stop it so the LEFI CROP service can manage Ollama? (models are kept)" y STOP_FOREIGN_OLLAMA \
      && run brew services stop ollama && _j j_add foreign_brew_service ollama || die "Stop it with: brew services stop ollama"
    sleep 1
  fi
  if [ "$DRY_RUN" != "1" ] && port_listening 11434 && ! lefi_agent_loaded; then
    warn "Another process already listens on port 11434 (e.g. a manual 'ollama serve')."
    confirm "Stop that Ollama server? Models are kept." y STOP_FOREIGN_OLLAMA \
      && { for _p in $(ollama_serve_pids); do kill "$_p" 2>/dev/null; done; sleep 2
           _j j_add manual "A manual 'ollama serve' process was stopped; start it again yourself if you need it."; } \
      || die "Free port 11434 and re-run."
    port_listening 11434 && die "Port 11434 is still in use; stop that process and re-run."
  fi
  return 0
}

# pull_progress — reads the Ollama /api/pull NDJSON stream on stdin and emits step.progress with
# the real byte counters (sum over layers). Prints "error: ..." or "success" as the last line.
pull_progress() {
  local line digest total completed status last=0 now sum_total sum_done
  : >"$PULL_STATE"
  while IFS= read -r line; do
    # Cancel during the download: stop reading (curl ends on the closed pipe); the caller rolls back.
    if command -v cancel_requested >/dev/null 2>&1 && cancel_requested; then echo cancelled; return 1; fi
    case "$line" in *'"error"'*) printf 'error: %s\n' "$(printf '%s' "$line" | json_str error)"; return 1 ;; esac
    status="$(printf '%s' "$line" | json_field status)"
    digest="$(printf '%s' "$line" | json_field digest)"
    total="$(printf '%s' "$line" | json_field total)"; completed="$(printf '%s' "$line" | json_field completed)"
    if [ -n "$digest" ] && [ -n "$total" ]; then
      awk -v d="$digest" -v t="$total" -v c="${completed:-0}" -F'\t' 'BEGIN{OFS="\t"} $1!=d{print} END{print d, t, c}' "$PULL_STATE" >"$PULL_STATE.n" \
        && mv "$PULL_STATE.n" "$PULL_STATE"
      now="$(date +%s)"
      if [ "$now" != "$last" ]; then
        last="$now"
        sum_total="$(awk -F'\t' '{s+=$2} END{printf "%d", s}' "$PULL_STATE")"; sum_done="$(awk -F'\t' '{s+=$3} END{printf "%d", s}' "$PULL_STATE")"
        step_progress "$sum_done" "$sum_total" bytes
      fi
    fi
    if [ "$status" = success ]; then
      sum_total="$(awk -F'\t' '{s+=$2} END{printf "%d", s}' "$PULL_STATE")"
      step_progress "$sum_total" "$sum_total" bytes; echo success; return 0
    fi
  done
  echo "error: the pull stream ended without success"; return 1
}

# Skip the download when the exact tag is already installed (works offline).
ensure_model() {
  local bin="$1" line res
  line="$(OLLAMA_HOST="$OLLAMA_LOCAL" "$bin" list 2>/dev/null | awk -v m="$AI_MODEL" '$1==m')"
  if [ -n "$line" ] && [ "$DRY_RUN" != "1" ]; then
    ok "$AI_MODEL already downloaded ($(echo "$line" | awk '{print $3" "$4}')) — skipping download"
    confirm "Check online for an updated version of $AI_MODEL? (needs internet)" n UPDATE_MODEL || return 0
  else
    step "Downloading $AI_MODEL (large download, needs internet once)"
  fi
  if [ "$DRY_RUN" = 1 ]; then run "$bin" pull "$AI_MODEL"; return 0; fi
  [ -n "$line" ] || _j j_add model_pulled "$AI_MODEL"   # recorded before: a cancelled download is undone too
  if [ "$EVENTS" = 1 ]; then
    # Machine-readable progress: the pull API reports real bytes per layer.
    PULL_STATE="$(mktemp)"
    res="$(curl -sS -N -m 7200 "http://$OLLAMA_LOCAL/api/pull" -d "{\"model\":\"$AI_MODEL\",\"stream\":true}" 2>>"$LOG_FILE" | pull_progress | tail -n1)"
    rm -f "$PULL_STATE" "$PULL_STATE.n"
    _log "PULL $AI_MODEL -> $res"
    [ "$res" = cancelled ] && _j check_cancel
  elif OLLAMA_HOST="$OLLAMA_LOCAL" run_visible "$bin" pull "$AI_MODEL"; then res=success
  else res="error: ollama pull failed"; fi
  if [ "$res" != success ]; then
    err "Could not pull '$AI_MODEL' ($res). The tag may not exist in the Ollama library or the network failed."
    [ -n "$line" ] && { warn "Keeping the copy already installed."; return 0; }
    DIE_CODE=MODEL_PULL_FAILED; die "Fix config/supported-models.tsv or your connection; nothing was substituted."
  fi
  local model_id; model_id="$(OLLAMA_HOST="$OLLAMA_LOCAL" "$bin" list 2>/dev/null | awk -v m="$AI_MODEL" '$1==m{print $2}')"
  # The rollback deletes a model only with this proof that this run downloaded this exact copy.
  [ -n "$line" ] || [ -z "$model_id" ] || _j j_add model_ready "$AI_MODEL" "$model_id"
  record_component "model:$AI_MODEL" "$model_id" "ollama pull"
  ok "$AI_MODEL ready"
}

# ai_verify_local — the AI requirement after install: a real generation, then the share of the
# model in GPU memory (Ollama /api/ps). Below MIN_GPU_SHARE_PCT the AI role is refused.
ai_verify_local() {
  [ "$DRY_RUN" = 1 ] && { info "[dry-run] would run a real generation and require the model 100% on the GPU"; return 0; }
  local mem
  step "Real generation with $AI_MODEL and GPU share check"
  if ! ai_measure "http://$OLLAMA_LOCAL" "$AI_MODEL"; then
    ai_gate_fail "$AI_MODEL does not run on this PC: $GEN_ERROR" "See: lefi ai diagnose"; return 0
  fi
  mem="$(model_field "$AI_MODEL" 5)"
  info "Measured now: ${AI_SIZE_GB} GB at ctx ${AI_CTX:-?}, ${AI_GPU_PCT}% on GPU (config/supported-models.tsv: ${mem:-?} GB)"
  [ "$mem" = "?" ] && info "Record this measurement in config/supported-models.tsv (mem_gb, ctx, measured_on) once confirmed."
  if ! ai_share_ok "$AI_GPU_PCT"; then
    ai_gate_fail "$AI_MODEL runs only ${AI_GPU_PCT}% on the GPU here; Lefi Crop requires it fully on the GPU (CPU inference is not supported)." \
      "Use the lighter model if it fits, or install the ai role on a PC with a supported GPU."
    return 0
  fi
  ok "$AI_MODEL runs fully on the GPU — this PC meets the AI requirement"
  env_set LEFI_AI_GATE "passed $(date -u +%Y-%m-%dT%H:%M:%SZ): local $AI_MODEL ${AI_GPU_PCT}% GPU ${AI_SIZE_GB} GB ctx ${AI_CTX:-?}"
}

role_ai_install() {
  header "AI node · Ollama + local model"
  step_begin ai.model_choice
  # ADR-090: the AI node and the simulated robot never share a PC (one GPU for both).
  if robot_installed || roles_has robot; then
    DIE_CODE=AI_ON_ROBOT_PC
    DIE_HINT="Remove the simulated robot from this PC first (Devices & Health in Lefi Desktop), or install the AI node on another PC."
    die "The simulated robot is installed on this PC: the AI node is not installed here, so both keep their performance."
  fi
  select_model

  local bind="$OLLAMA_LOCAL"
  if roles_has core; then
    info "Lefi Brain runs on this machine → Ollama stays bound to localhost."
  elif confirm "Will Lefi Brain (core node) run on a DIFFERENT machine on the LAN?" y AI_LAN; then
    bind="0.0.0.0:11434"
    warn "Ollama has no authentication. Allow only the core node's IP to reach TCP 11434"
    warn "(macOS firewall / router rules). See README.md (local network)."
  fi

  step_begin ai.ollama
  install_ollama
  local bin; bin="$(ollama_bin)"; [ -n "$bin" ] || bin="ollama"

  stop_foreign_ollama

  step_begin ai.service
  step "Starting Ollama service (bind $bind)"
  local envs="OLLAMA_HOST=$bind OLLAMA_KEEP_ALIVE=24h OLLAMA_NUM_PARALLEL=1 OLLAMA_MAX_LOADED_MODELS=1"
  local ctx; ctx="$(model_field "$AI_MODEL" 6)"
  # Pin the context of the measurement so the footprint matches config/supported-models.tsv.
  case "$ctx" in ''|*[!0-9]*) ;; *) envs="$envs OLLAMA_CONTEXT_LENGTH=$ctx" ;; esac
  [ "$LEFI_SERVICE_MODE" = systemd ] && envs="$envs OLLAMA_MODELS=$LEFI_STATE_DIR/ollama/models"
  if [ "$LEFI_SERVICE_MODE" = user ] && port_listening 11434 && [ "$DRY_RUN" != "1" ]; then
    warn "Something already listens on 11434 (probably the systemd ollama service); keeping it."
    [ "$bind" != "$OLLAMA_LOCAL" ] && warn "Set OLLAMA_HOST=0.0.0.0:11434 in that service: sudo systemctl edit ollama"
  else
    [ "$LEFI_SERVICE_MODE" = systemd ] && [ "$DRY_RUN" != 1 ] && { _j j_mkdir "$LEFI_STATE_DIR/ollama/models"; mkdir -p "$LEFI_STATE_DIR/ollama/models"; }
    start_service ollama "$LOG_DIR/ollama.log" "$envs" "$bin" serve || die "Could not start Ollama."
  fi
  wait_for_port 11434 30 || die "Ollama did not open port 11434 (see $LOG_DIR/ollama.log)."
  if [ "$DRY_RUN" != "1" ]; then
    local i=0; sleep 2
    until http_ok "http://$OLLAMA_LOCAL/api/version" 3; do
      i=$((i + 1)); [ "$i" -ge 15 ] && die "Ollama API not responding (see $LOG_DIR/ollama.log)."; sleep 1
    done
  fi
  ok "Ollama API is up"

  step_begin ai.model
  ensure_model "$bin"

  env_set LEFI_AI_BIND "$bind"
  env_set OLLAMA_MODEL "$AI_MODEL"
  roles_has core && env_set OLLAMA_BASE_URL "http://$OLLAMA_LOCAL"

  step_begin ai.verify
  ai_verify_local
  if [ "$bind" != "$OLLAMA_LOCAL" ]; then
    info "Give this URL to the core node installer: ${C_BOLD}http://$LAN_IP:11434${C_RESET}"
  fi
}
