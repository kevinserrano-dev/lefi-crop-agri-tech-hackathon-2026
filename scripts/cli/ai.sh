# shellcheck shell=bash
# AI commands: status, emergency kill switch, cancel/unload, models, test, connections, requests.
# Resources, benchmark, performance history and diagnosis live in aiops.sh.

# Clients expected to use Ollama (anything else is flagged). Override in .env.
ai_allowed() { local a; a="$(env_get LEFI_AI_ALLOWED_CLIENTS)"; echo "${a:-127.0.0.1}"; }

flag_unexpected_ips() {  # stdin: one IP per line
  local ip allowed; allowed=" $(ai_allowed) "
  sort -u | while read -r ip; do
    [ -n "$ip" ] || continue
    case "$allowed" in *" $ip "*) ;; *) warn "Unexpected AI client $ip (allowed: $(ai_allowed)) — check who is using the model." ;; esac
  done
}

ai_url() {
  if [ "$HAS_AI" = 1 ]; then echo "http://127.0.0.1:11434"; else env_get OLLAMA_BASE_URL; fi
}

ollama_cli() { local b; b="$(ollama_bin)"; [ -n "$b" ] || die "ollama binary not found"; OLLAMA_HOST=127.0.0.1:11434 "$b" "$@"; }

cmd_ai() {
  local sub="${1:-status}"; [ $# -gt 0 ] && shift
  # `use` answers for itself, also on a PC with nothing installed yet (NO_BRAIN, as JSON).
  if [ "$sub" = use ]; then ai_use "$@"; exit $?; fi
  [ "$HAS_AI" = 1 ] || [ "$HAS_CORE" = 1 ] || require_role AI "The AI node"
  case "$sub" in
    status) ai_status ;;
    off|kill|disable) ai_off "$@" ;;
    on|enable) ai_on ;;
    cancel) require_role AI "The AI node"; ai_cancel ;;
    unload) require_role AI "The AI node"; ai_unload ;;
    models) require_role AI "The AI node"; ai_models ;;
    test) ai_test ;;
    health) ai_health "$@"; exit $? ;;
    bench|benchmark) ai_bench "$@" ;;
    perf|performance) require_role AI "The AI node"; ai_perf "$@" ;;
    resources|top) require_role AI "The AI node"; ai_resources "$@" ;;
    diagnose|doctor|errors) require_role AI "The AI node"; ai_diagnose "$@" ;;
    events) parse_n 40 "$@"; [ -f "$AI_EVENTS_LOG" ] || die "No AI events yet ($AI_EVENTS_LOG)"; tail -n "$NLINES" "$AI_EVENTS_LOG" ;;
    connections|conn) require_role AI "The AI node"; ai_connections ;;
    requests|req) require_role AI "The AI node"; ai_requests "$@" ;;
    *) die "Unknown: lefi ai $sub (status, health, off, on, cancel, unload, models, test, bench, perf, resources, diagnose, events, connections, requests, use)" ;;
  esac
}

ai_status() {
  local url model bind; url="$(ai_url)"; model="$(env_get OLLAMA_MODEL)"; bind="$(env_get LEFI_AI_BIND)"
  header "AI status"
  if [ -f "$AI_KILL_FLAG" ]; then printf '  %sKILL SWITCH ON%s — %s\n' "$C_RED" "$C_RESET" "$(cat "$AI_KILL_FLAG")"
  else ok "Kill switch off (AI allowed)"; fi
  [ "$HAS_AI" = 1 ] && info "Service:    $(svc_state ai) (PID $(svc_pid ai | sed 's/^$/-/')) · bind ${bind:-127.0.0.1:11434}"
  info "Endpoint:   $url"
  info "Model:      ${model:-<not configured>}"
  local ver; ver="$(curl -fsS -m 3 "$url/api/version" 2>/dev/null | json_field version)"
  if [ -z "$ver" ]; then warn "Ollama API not reachable at $url"; return 0; fi
  ok "Ollama $ver responding"
  local models; models="$(ps_models "$url")"
  if [ -n "$models" ]; then
    info "Loaded in memory:"
    printf '%s\n' "$models" | while IFS= read -r m; do
      printf '    %s · %s\n' "$(printf '%s' "$m" | json_field name)" "$(model_line_info "$m")"
    done
    if [ -n "$model" ]; then
      if [ -n "$(ps_model_line "$url" "$model")" ]; then ok "Configured model $model is loaded and ready"
      else warn "Configured model $model is NOT the one in memory — free it with: lefi ai unload"; fi
    fi
  else
    info "No model loaded right now: Ollama loads ${model:-the model} on the next request"
    info "(the first answer after that takes longer). Load it now with: lefi ai test"
  fi
}

# Emergency stop. Never asks for confirmation: stopping the AI must always be immediate.
ai_off() {
  local who; who="$CLI_OPERATOR@$(hostname -s 2>/dev/null) at $(date '+%Y-%m-%d %H:%M:%S')"
  header "AI EMERGENCY STOP"
  mkdir -p "$FLAG_DIR"; printf 'disabled by %s\n' "$who" >"$AI_KILL_FLAG"; chmod 600 "$AI_KILL_FLAG"
  ai_event WARN killsw "kill switch ON by $who"
  ok "Kill switch set ($AI_KILL_FLAG)"
  if [ "$HAS_CORE" = 1 ]; then
    env_set LEFI_AI_ENABLED false
    ok "Brain configured to not use AI (LEFI_AI_ENABLED=false; the Brain also honours the kill-switch file)"
  fi
  if [ "$HAS_AI" = 1 ]; then
    svc_stop ai 1 >/dev/null 2>&1
    local p; for p in $(procs_of_kind ai-runner) $(procs_of_kind ai); do terminate_pid "$p"; done
    if port_listening 11434; then
      err "Something still listens on 11434 — check: lefi ps"
    else
      ok "Ollama stopped; autostart disabled until 'lefi ai on'"
    fi
  else
    local url; url="$(env_get OLLAMA_BASE_URL)"
    warn "The AI runs on another machine ($url). This Brain will not use it,"
    warn "but to stop the model itself run 'lefi ai off' on that machine."
  fi
}

ai_on() {
  header "Re-enabling AI"
  rm -f "$AI_KILL_FLAG"; ok "Kill switch removed"; ai_event INFO killsw "kill switch OFF by $CLI_OPERATOR"
  [ "$HAS_CORE" = 1 ] && { env_set LEFI_AI_ENABLED true; ok "LEFI_AI_ENABLED=true"; }
  if [ "$HAS_AI" = 1 ]; then
    svc_start ai || return 1
    local i=0; until http_ok "http://127.0.0.1:11434/api/version" 2; do
      i=$((i + 1)); [ "$i" -ge 15 ] && { warn "Ollama API not answering yet: lefi logs ai"; return 1; }; sleep 1
    done
    ok "AI available"
  fi
}

# Ollama has no cancel API: killing the runner aborts in-flight generations; the server
# starts a fresh runner on the next request.
ai_cancel() {
  local pids; pids="$(procs_of_kind ai-runner)"
  [ -n "$pids" ] || { info "No model runner active — nothing to cancel."; return 0; }
  local p; for p in $pids; do terminate_pid "$p"; done
  ai_event WARN cancel "runner(s) $(echo "$pids" | tr '\n' ' ')killed by $CLI_OPERATOR (in-flight requests aborted)"
  ok "In-flight AI generations aborted (model unloaded; it reloads on the next request)"
}

ai_unload() {
  local ps names n; ps="$(curl -fsS -m 3 http://127.0.0.1:11434/api/ps 2>/dev/null)" || die "Ollama not reachable"
  names="$(ps_models http://127.0.0.1:11434 | while IFS= read -r m; do printf '%s' "$m" | json_field name; done)"
  [ -n "$names" ] || { info "No model loaded."; return 0; }
  for n in $names; do
    curl -fsS -m 10 http://127.0.0.1:11434/api/generate -d "{\"model\":\"$n\",\"keep_alive\":0}" >/dev/null 2>&1 \
      && { ok "Unloaded $n"; ai_event INFO unload "model=$n by $CLI_OPERATOR"; } || warn "Could not unload $n"
  done
}

ai_models() {
  header "Models"
  local installed; installed="$(ollama_cli list 2>/dev/null)"
  printf '  %-14s %-10s %-10s %s\n' MODEL SUPPORTED INSTALLED SIZE
  models_rows | while IFS="$(printf '\t')" read -r tag _ _ role _; do
    local line; line="$(echo "$installed" | awk -v m="$tag" '$1==m')"
    printf '  %-14s %-10s %-10s %s\n' "$tag" "yes ($role)" "$( [ -n "$line" ] && echo yes || echo no)" \
      "$(echo "$line" | awk '{print $3" "$4}')"
  done
  local extra; extra="$(echo "$installed" | awk 'NR>1{print $1}' | while read -r m; do model_is_supported "$m" || echo "$m"; done)"
  [ -n "$extra" ] && warn "Installed but NOT supported (not used by Lefi Crop AI): $(echo "$extra" | tr '\n' ' ')"
  info "Configured: $(env_get OLLAMA_MODEL)"
}

ai_test() {
  local url model body t0 t1 resp ev evd; url="$(ai_url)"; model="$(env_get OLLAMA_MODEL)"
  [ -f "$AI_KILL_FLAG" ] && die "AI is disabled by the kill switch (lefi ai on)."
  [ -n "$model" ] || die "OLLAMA_MODEL not configured"
  header "AI inference test · $model @ $url"
  t0="$(date +%s)"
  ollama_generate "$url" "$model" "In one short sentence: what does a greenhouse soil moisture sensor measure?" 80 \
    || { gen_failed test "$model" "$url"; return 1; }
  t1="$(date +%s)"; body="$GEN_BODY"; resp="$GEN_RESPONSE"
  gen_metrics "$body"
  ok "Answered in $((t1 - t0)) s"
  info "Speed: $M_GEN_TPS tokens/s ($M_GEN_N tokens) → $(speed_verdict "$M_GEN_TPS")"
  info "First token after $M_TTFT_MS ms (model load $M_LOAD_MS ms + prompt)"
  info "Reply: $resp"
  perf_record test "$model" "$(model_gpu_pct "$url" "$model")"
  ai_event INFO test "model=$model gen_tps=$M_GEN_TPS ttft_ms=$M_TTFT_MS total_s=$((t1 - t0))"
}

ai_connections() {
  header "Ollama TCP connections (port 11434)"
  have lsof || die "lsof not available"
  local est; est="$(lsof -nP -iTCP:11434 -sTCP:ESTABLISHED 2>/dev/null | awk 'NR>1 && $1 ~ /ollama/ {print $9}')"
  if [ -z "$est" ]; then info "No client connected right now."; else
    echo "$est" | sed 's/.*->//; s/:[0-9]*$//' | sort | uniq -c | awk '{printf "  %-16s %s connection(s)\n", $2, $1}'
    echo "$est" | sed 's/.*->//; s/:[0-9]*$//' | flag_unexpected_ips
  fi
  info "Listening on: $(lsof -nP -iTCP:11434 -sTCP:LISTEN 2>/dev/null | awk 'NR>1{print $9}' | sort -u | tr '\n' ' ')"
}

# Ollama writes one access line per request to its log:
# [GIN] 2026/11/01 - 10:00:00 | 200 |  1.234s |  192.168.8.10 | POST  "/api/chat"
ai_requests() {
  parse_n 5000 "$@"
  local log; log="$(svc_log ai)"
  [ -f "$log" ] || die "No Ollama log yet ($log)"
  header "AI requests (last $NLINES log lines of $log)"
  local data; data="$(tail -n "$NLINES" "$log" | grep '^\[GIN\]')"
  [ -n "$data" ] || { info "No requests logged yet."; return 0; }
  echo "$data" | awk -F'|' '
    function ms(s){ gsub(/ /,"",s); if (s ~ /ms$/) return s+0; if (s ~ /µs$/) return (s+0)/1000; if (s ~ /m[0-9.]+s$/){split(s,a,"m"); return a[1]*60000+a[2]*1000} if (s ~ /s$/) return (s+0)*1000; return 0 }
    { st=$2; gsub(/ /,"",st); ip=$4; gsub(/ /,"",ip); ep=$5; gsub(/^ +| +$/,"",ep); gsub(/ +/," ",ep)
      n++; byip[ip]++; byst[st]++; byep[ep]++; t=ms($3); tot+=t; if (t>max) max=t; if (st+0>=500) err++ }
    END {
      printf "  Total: %d · errors (5xx): %d · avg %.0f ms · max %.0f ms\n\n  By client IP:\n", n, err, tot/n, max
      for (k in byip) printf "    %-18s %d\n", k, byip[k]
      print "  By endpoint:"; for (k in byep) printf "    %-30s %d\n", k, byep[k]
      print "  By status:"; for (k in byst) printf "    %-6s %d\n", k, byst[k] }'
  echo; echo "$data" | awk -F'|' '{ip=$4; gsub(/ /,"",ip); print ip}' | flag_unexpected_ips
  info "Last 5:"; echo "$data" | tail -n 5 | sed 's/^/    /'
}

# lefi ai use URL [--json] — point this PC's Brain at the AI node URL (ADR-033), after the same
# check as the installer (ADR-028): a supported model answers a real generation and runs fully
# on that node's GPU. Only then OLLAMA_BASE_URL / OLLAMA_MODEL / LEFI_AI_GATE change, and a
# running Brain is restarted to use it. --json: one result object on stdout (Lefi Crop Helper).
ai_use() {
  local url="" json=0 a models model
  for a in "$@"; do case "$a" in --json) json=1 ;; *) url="$a" ;; esac; done
  url="${url%/}"
  AI_USE_JSON="$json"
  if [ "$json" = 1 ]; then exec 3>&1 1>&2; fi
  if ! printf '%s' "$url" | grep -Eq '^http://[A-Za-z0-9.-]+:[0-9]{1,5}$'; then
    ai_use_result failed BAD_URL "$url" "" "" "Use the AI node address as http://IP:PORT"; return 1
  fi
  if [ "$HAS_CORE" != 1 ]; then
    ai_use_result failed NO_BRAIN "$url" "" "" "The Brain (core role) is not installed on this PC."; return 1
  fi
  if ! http_ok "$url/api/version" 5; then
    ai_use_result failed AI_UNREACHABLE "$url" "" "" "No answer from the AI node at $url."; return 1
  fi
  models="$(remote_supported_models "$url")"; model="$(printf '%s\n' "$models" | head -n1)"
  if [ -z "$model" ]; then
    ai_use_result failed NO_SUPPORTED_MODEL "$url" "" "" "The AI node serves no model from config/supported-models.tsv."; return 1
  fi
  info "Checking $model on $url (real generation and GPU share)…"
  if ! ai_measure "$url" "$model"; then
    ai_use_result failed AI_NOT_VIABLE "$url" "$model" "" "$model did not answer: $GEN_ERROR"; return 1
  fi
  if ! ai_share_ok "$AI_GPU_PCT"; then
    ai_use_result failed AI_NOT_VIABLE "$url" "$model" "$AI_GPU_PCT" "$model runs only ${AI_GPU_PCT:-?}% on that node's GPU; Lefi Crop requires 100%."; return 1
  fi
  env_set OLLAMA_BASE_URL "$url"
  env_set OLLAMA_MODEL "$model"
  env_set LEFI_AI_GATE "passed $(date -u +%Y-%m-%dT%H:%M:%SZ): remote $url $model ${AI_GPU_PCT}% GPU ${AI_SIZE_GB} GB ctx ${AI_CTX:-?}"
  if svc_running brain; then
    info "Restarting the Brain to use the new AI node"
    svc_stop brain; svc_start brain || warn "The Brain did not restart; run: lefi start brain"
  fi
  ai_use_result ok OK "$url" "$model" "$AI_GPU_PCT" "The Brain now uses $model on $url (${AI_GPU_PCT}% on GPU)."
}

ai_use_result() {  # ai_use_result STATE CODE URL MODEL GPU_PCT MESSAGE
  if [ "$1" = ok ]; then ok "$6"; else err "$6"; fi
  [ "${AI_USE_JSON:-0}" = 1 ] || return 0
  printf '{"result":%s,"code":%s,"url":%s,"model":%s,"gpu_pct":%s,"message":%s}\n' \
    "$(_evq "$1")" "$(_evq "$2")" "$(_evq "$3")" "$(_evq "$4")" "${5:-null}" "$(_evq "$6")" >&3
}
