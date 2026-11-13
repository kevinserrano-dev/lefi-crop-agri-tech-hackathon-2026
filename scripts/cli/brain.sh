# shellcheck shell=bash
# Brain (backend API) commands. Contract with the Brain implementation (services/brain):
#  - health:     GET /api/v1/health · local status: GET /api/v1/status (loopback only)
#  - access log: $LEFI_STATE_DIR/logs/brain-access.log, JSON lines with "ip","method","path","status","ms"
#  - AI kill switch: refuse AI calls when $LEFI_STATE_DIR/flags/ai.disabled exists or LEFI_AI_ENABLED=false
#  - operations: python -m lefi_brain (probe, config check, db …, audit …) via brain_py

cmd_brain() {
  require_role BRAIN "The Brain (backend API)"
  local sub="${1:-status}"; [ $# -gt 0 ] && shift
  case "$sub" in
    status) brain_status ;;
    check) brain_check ;;
    config) _jhdr "Brain settings" "$@"; brain_py config check "$@" ;;
    run) brain_run "$@" ;;
    version) brain_py --version ;;
    requests|req) parse_n 5000 "$@"; http_requests_report "$LOG_DIR/brain-access.log" "ip" "path" ;;
    *) die "Unknown: lefi brain $sub (status, check, config, run, version, requests)" ;;
  esac
}

brain_status() {
  local port pid; port="$(svc_port brain)"; pid="$(svc_pid brain)"
  header "Brain"
  info "Service:    $(svc_state brain) (PID ${pid:--}) · port $port"
  if http_ok "http://127.0.0.1:$port/api/v1/health" 3; then
    brain_py probe --url "http://127.0.0.1:$port"
  else
    warn "Health endpoint not responding — start it with: lefi start brain"
  fi
  [ -f "$AI_KILL_FLAG" ] && warn "AI kill switch is ON — the Brain must not call the AI"
  return 0
}

# Full validation of this node's Brain: settings, database, running API. Exit 1 on any failure.
brain_check() {
  local port rc=0; port="$(svc_port brain)"
  header "Brain · settings"
  brain_py config check || rc=1
  header "Brain · database"
  brain_py db check || rc=1
  header "Brain · running API"
  if svc_running brain || port_listening "$port"; then
    brain_py probe --url "http://127.0.0.1:$port" || rc=1
  else
    err "The Brain is not running (lefi start brain)"; rc=1
  fi
  printf '\n'
  if [ "$rc" = 0 ]; then ok "Brain check passed"; else err "Brain check found problems (details above)"; fi
  return "$rc"
}

# Foreground run for troubleshooting (logs on the terminal, Ctrl-C to stop).
brain_run() {
  if svc_running brain; then die "The Brain service is already running (PID $(svc_pid brain)). Stop it first: lefi stop brain"; fi
  info "Running the Brain in the foreground — Ctrl-C to stop"
  brain_py serve "$@"
}
