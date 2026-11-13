# shellcheck shell=bash
# Lefi Crop AI CLI — dispatcher, role detection, dynamic help and audit log.

LEFI_VERSION="$(cat "$LEFI_ROOT/VERSION" 2>/dev/null || echo dev)"
REPORT_DIR="$LEFI_STATE_DIR/reports"
FLAG_DIR="$LEFI_STATE_DIR/flags"
AI_KILL_FLAG="$FLAG_DIR/ai.disabled"
CLI_LOG="$LOG_DIR/cli.log"            # audit trail: one line per command + exit code
CLI_DETAIL_LOG="$LOG_DIR/cli-detail.log" # messages and command output (troubleshooting)
# The installer to run for setup/check: in a system install the CLI is a copy in /opt, the
# installer stays in the checkout recorded in install.conf (LEFI_SOURCE).
LEFI_SETUP_ROOT="$(install_conf_get LEFI_SOURCE)"; LEFI_SETUP_ROOT="${LEFI_SETUP_ROOT:-$LEFI_ROOT}"
CLI_OPERATOR="${LEFI_CLI_USER:-$(id -un)}"

# ---------------------------------------------------------------- audit log
# Every CLI invocation is recorded (who, where, what, exit code) for technicians.
cli_audit() {
  mkdir -p "$LOG_DIR" 2>/dev/null || return 0
  printf '%s %s@%s lefi %s -> %s\n' "$(date +%Y-%m-%dT%H:%M:%S)" "$CLI_OPERATOR" "$(hostname -s 2>/dev/null)" \
    "$CLI_CMDLINE" "$1" >>"$CLI_LOG" 2>/dev/null
  return 0
}

# ---------------------------------------------------------------- role detection
# A role counts as installed when it was recorded by the installer OR its runtime artefacts exist.
detect_installed() {
  LEFI_ROLES="$(env_get LEFI_ROLES)"
  HAS_AI=0; HAS_CORE=0; HAS_ADMIN=0; HAS_BRAIN=0; HAS_ROBOT=0; HAS_FIRMWARE=0
  { roles_has ai || [ -f "$LEFI_STATE_DIR/services/ollama.svc" ]; } && HAS_AI=1
  { roles_has core || [ -f "$LEFI_STATE_DIR/mosquitto/mosquitto.conf" ]; } && HAS_CORE=1
  { roles_has admin || [ -f "$LEFI_STATE_DIR/caddy/Caddyfile" ]; } && HAS_ADMIN=1
  [ "$HAS_CORE" = 1 ] && { [ -f "$LEFI_ROOT/services/brain/pyproject.toml" ] || [ -x "$BRAIN_PY" ]; } && HAS_BRAIN=1
  { roles_has robot || robot_installed; } && HAS_ROBOT=1
  { roles_has firmware || have pio; } && HAS_FIRMWARE=1
  return 0
}

role_flag() { eval "echo \$HAS_$1"; }

require_role() {  # require_role AI|CORE|ADMIN|BRAIN "label"
  [ "$(role_flag "$1")" = 1 ] && return 0
  err "$2 is not installed on this machine."
  case "$1" in
    BRAIN) info "The Brain application code is not implemented yet. See README.md." ;;
    *) info "Install it with: lefi setup" ;;
  esac
  exit 3
}

installed_summary() {
  local out=""
  [ "$HAS_AI" = 1 ] && out="$out AI-node"
  [ "$HAS_CORE" = 1 ] && out="$out Core-node(MQTT,DB)"
  [ "$HAS_BRAIN" = 1 ] && out="$out Brain"
  [ "$HAS_ADMIN" = 1 ] && out="$out Lefi-Gateway"
  [ "$HAS_ROBOT" = 1 ] && out="$out Robot-sim"
  [ "$HAS_FIRMWARE" = 1 ] && out="$out Firmware-tools"
  echo "${out:- nothing yet (run: lefi setup)}"
}

# ---------------------------------------------------------------- help
_h()   { printf '  %s%-34s%s %s\n' "$C_BOLD" "$1" "$C_RESET" "$2"; }
_hsec() {  # _hsec "Title" FLAG
  if [ -z "$2" ] || [ "$(role_flag "$2")" = 1 ]; then printf '\n%s%s%s\n' "$C_GREEN" "$1" "$C_RESET"; return 0; fi
  printf '\n%s%s — not installed on this machine%s\n' "$C_DIM" "$1" "$C_RESET"; return 1
}

cli_help() {
  lefi_banner "CLI v$LEFI_VERSION"
  printf '\n  Installed here:%s\n' "$(installed_summary)"
  _hsec "General"
  _h "lefi status" "Node overview: roles, services, ports, AI kill switch"
  _h "lefi resources [--watch]" "CPU / memory per service + system load"
  _h "lefi ps" "Running Lefi Crop AI processes"
  _h "lefi kill <PID|name>" "Interrupt one process (names: runner, pull, installer, simulator, <service>)"
  _h "lefi kill --all [--yes]" "Interrupt every Lefi Crop AI process on this machine"
  _h "lefi start|stop|restart <svc|all>" "Services here: $(svc_installed_list | tr '\n' ' ')"
  _h "lefi net" "LAN, router, other nodes, listening ports"
  _h "lefi hw [--json]" "Hardware scan + which model this PC can run (AI requirement)"
  _h "lefi logs [name] [-f] [-n N]" "List / show / follow logs"
  _h "lefi logs rotate [--force]" "Rotate large log files"
  _h "lefi errors [name] [-n N]" "Scan logs for errors, save a report"
  _h "lefi report" "Support bundle for technicians (secrets redacted)"
  _h "lefi setup | lefi check" "Installer · full verification"
  _h "lefi cli install|uninstall" "Install the 'lefi' command globally"
  _h "lefi version | lefi help" ""
  if [ "$HAS_AI" != 1 ] && [ "$HAS_CORE" = 1 ]; then
    printf '\n%sAI (remote AI node — kill switch for this Brain)%s\n' "$C_GREEN" "$C_RESET"
    _h "lefi ai status" "Remote AI node reachability, model, kill switch"
    _h "lefi ai health [--deep] [--json]" "Quick OK / DEGRADED / DOWN of the remote AI (exit 0/1/2)"
    _h "lefi ai off | on" "EMERGENCY: forbid / allow AI use by this Brain"
  elif _hsec "AI node (Ollama + Gemma)" AI; then
    _h "lefi ai status" "Server, bind, configured & loaded models, kill switch"
    _h "lefi ai health [--deep] [--json]" "Quick OK / DEGRADED / DOWN with reasons (exit 0/1/2)"
    _h "lefi ai off" "EMERGENCY: stop the AI now and keep it off (survives reboot)"
    _h "lefi ai on" "Re-enable the AI"
    [ "$HAS_AI" = 1 ] && {
      _h "lefi ai cancel" "Abort in-flight generations (kills model runners)"
      _h "lefi ai unload" "Free model memory now"
      _h "lefi ai models" "Supported vs installed models"
      _h "lefi ai test" "Real inference test: answer, tokens/s, time to first token"
      _h "lefi ai use URL [--json]" "Point the Brain at an AI node (checked: supported model 100% on its GPU)"
      _h "lefi ai resources [--watch]" "Model memory, GPU share/use, CPU, swap, power, activity"
      _h "lefi ai bench [-r N]" "Benchmark speed (N runs, default 3), saved to history"
      _h "lefi ai perf [-n N]" "Performance history, trend and real request latency"
      _h "lefi ai diagnose [-n N]" "Health checks + explained errors + saved report"
      _h "lefi ai events [-n N]" "AI event log (tests, failures, kill switch, cancels)"
      _h "lefi ai connections" "Live TCP clients of Ollama (by IP)"
      _h "lefi ai requests [-n N]" "Requests per client IP / endpoint / status"
    }
  fi
  if _hsec "Core node (MQTT broker + database)" CORE; then
    _h "lefi mqtt status" "Broker state, clients, message counters"
    _h "lefi mqtt clients" "Connected devices with their IPs"
    _h "lefi mqtt stats" "Load: messages and bytes per minute"
    _h "lefi mqtt watch [topic]" "Live view of MQTT traffic (default lefi/v1/#)"
    _h "lefi db status | backup | path" "SQLite health, safe online backup, location"
    [ "$HAS_BRAIN" = 1 ] && {
      _h "lefi db check [--json]" "Integrity, foreign keys, WAL, schema at head, audit chain (exit 0/1)"
      _h "lefi db current" "Schema revision vs what this Brain expects"
      _h "lefi db tables" "Tables and row counts (read-only)"
      _h "lefi db migrate" "Create / upgrade the schema (backup first; Brain must be stopped)"
    }
    _h "lefi backup status | disks | list" "Backups on an external disk: state, disks to choose, backups kept"
    _h "lefi backup set-disk UUID | schedule 6|12|24|off" "Choose the external disk, how often (default 12 h)"
    _h "lefi backup run | verify ID" "Back up everything now; check a backup's checksums"
    _h "lefi backup restore ID --parts a,b | --all" "Restore by parts or all (safety copy first, undone if Brain fails)"
  fi
  if _hsec "Brain (backend API)" BRAIN; then
    _h "lefi brain status" "Process, port, health, DB revision, AI and MQTT state"
    _h "lefi brain check" "Full validation: settings + database + running API (exit 0/1)"
    _h "lefi brain config [--json]" "Validate the Brain settings in .env (secrets redacted)"
    _h "lefi brain run" "Run in the foreground for troubleshooting (service stopped)"
    _h "lefi brain requests [-n N]" "HTTP requests per client IP / path / status"
    _h "lefi audit verify" "Verify the append-only audit hash chain"
    _h "lefi audit tail [-n N]" "Last audit entries (who did what, when)"
    _h "lefi user list" "Users, roles, status, last sign-in"
    _h "lefi user add <name> --role <r>" "Create a user (asks for the password, or --generate)"
    _h "lefi user role <name> <role>" "Change role (signs the user out)"
    _h "lefi user disable|enable <name>" "Block / unblock sign-in (disable signs out)"
    _h "lefi user reset-password <name>" "New temporary password, must change at sign-in"
    _h "lefi pair new|list|revoke <id>" "Lefi Desktop pairing code (10 min), paired PCs, revoke one"
    _h "lefi user sessions|revoke-sessions <name>" "Active sessions · sign the user out everywhere"
    _h "lefi roles [--json]" "The 7 roles and their permission matrix"
  fi
  if _hsec "Simulated robot (MH3)" ROBOT; then
    _h "lefi robot status [--json]" "Off, starting or running; backend and port"
    _h "lefi robot start | stop" "Turn the simulated robot on or off (Lefi Brain does it from Lefi Desktop)"
  fi
  if _hsec "Lefi Gateway (Caddy)" ADMIN; then
    _h "lefi admin status | url" "Web server state, URL, upstream Brain"
    _h "lefi admin requests [-n N]" "Web/API requests per client IP / path / status"
  fi
  printf '\n  Logs, reports and audit trail: %s\n\n' "$LOG_DIR"
}

# ---------------------------------------------------------------- dispatcher
cli_main() {
  CLI_CMDLINE="$*"
  LOG_FILE="$CLI_DETAIL_LOG"; mkdir -p "$LOG_DIR" 2>/dev/null
  detect_installed
  local cmd="${1:-help}"; [ $# -gt 0 ] && shift
  case "$cmd" in help|-h|--help|version|--version) ;; *) trap 'cli_audit $?' EXIT ;; esac
  case "$cmd" in
    help|-h|--help) cli_help ;;
    version|--version) echo "Lefi Crop AI CLI $LEFI_VERSION ($LEFI_ROOT)" ;;
    status) cmd_status "$@" ;;
    resources|top) cmd_resources "$@" ;;
    ps) cmd_ps "$@" ;;
    kill) cmd_kill "$@" ;;
    start|stop|restart) cmd_service "$cmd" "$@" ;;
    net) cmd_net "$@" ;;
    logs) cmd_logs "$@" ;;
    errors) cmd_errors "$@" ;;
    report) cmd_report "$@" ;;
    setup|install) exec "$LEFI_SETUP_ROOT/scripts/install.sh" "$@" ;;
    check|doctor) exec "$LEFI_SETUP_ROOT/scripts/install.sh" --check "$@" ;;
    hw|hardware) cmd_hw "$@" ;;
    ai) cmd_ai "$@" ;;
    mqtt) cmd_mqtt "$@" ;;
    db) cmd_db "$@" ;;
    backup|backups) cmd_backup "$@" ;;
    brain) cmd_brain "$@" ;;
    audit) cmd_audit "$@" ;;
    user|users) cmd_user "$@" ;;
    roles) cmd_roles "$@" ;;
    pair|devices) cmd_pair "$@" ;;
    admin) cmd_admin "$@" ;;
    cli) cmd_cli "$@" ;;
    robot) cmd_robot "$@" ;;
    *) err "Unknown command: $cmd"; info "Run: lefi help"; exit 2 ;;
  esac
}

# Parse "-n N" from args into NLINES (default given).
parse_n() {  # parse_n DEFAULT ARGS...
  NLINES="$1"; shift
  while [ $# -gt 0 ]; do
    case "$1" in -n) shift; NLINES="${1:-$NLINES}" ;; -n*) NLINES="${1#-n}" ;; esac
    shift
  done
  case "$NLINES" in ''|*[!0-9]*) die "-n expects a number" ;; esac
}

# _jhdr "Title" ARGS... — section header, omitted when --json is requested (clean JSON on stdout).
_jhdr() { local t="$1"; shift; has_flag --json "$@" || header "$t"; }

has_flag() {  # has_flag FLAG ARGS...
  local f="$1"; shift
  for a in "$@"; do [ "$a" = "$f" ] && return 0; done
  return 1
}

human_kb() { awk -v k="$1" 'BEGIN{ if (k>=1048576) printf "%.1f GB", k/1048576; else if (k>=1024) printf "%.0f MB", k/1024; else printf "%d KB", k }'; }
human_bytes() { awk -v b="$1" 'BEGIN{ if (b>=1073741824) printf "%.1f GB", b/1073741824; else if (b>=1048576) printf "%.0f MB", b/1048576; else printf "%.0f KB", b/1024 }'; }
