#!/usr/bin/env bash
# Lefi Crop AI — installer and system checker (also: `lefi setup`, `lefi check`).
#
#   ./scripts/install.sh                     interactive: choose roles, install, configure, verify
#   ./scripts/install.sh --check             only verify the roles installed on this machine
#   ./scripts/install.sh --dry-run           show every action without changing anything
#   ./scripts/install.sh --roles ai,core [--yes]      non-interactive selection / defaults
#   ./scripts/install.sh --answers FILE      unattended: every answer from FILE, never asks
#                                            (format: deploy/install/answers.example)
#   ./scripts/install.sh --events ndjson     machine-readable progress on stdout (one JSON
#                                            event per line); human output goes to stderr
#   ./scripts/install.sh --service-mode systemd|user   Linux: system services at boot (default,
#                                            needs root) or development processes (no root)
#   ./scripts/install.sh --dev-allow-no-ai   DEVELOPMENT/CI ONLY: continue when no viable AI exists
#   ./scripts/install.sh --cancel-file PATH  stop at the next safe point when PATH appears, then
#                                            undo everything this run changed (Lefi Crop Helper Cancel)
#   ./scripts/install.sh --rollback          undo the last install run from its journal (ADR-032)
#   ./scripts/install.sh --update-brain      safe Brain update from this installer (ADR-036)
#   ./scripts/install.sh --remove-role ROLE  remove a component from this PC (ai, desktop; ADR-040)
#   ./scripts/install.sh --uninstall-everything  remove Lefi Crop from this PC, DATA INCLUDED (ADR-043)
#   ./scripts/install.sh --rollback --journal F [--journal F2]   undo exactly these runs (newest last)
#
# Roles (ADR-018): ai · core · admin · robot (optional) · firmware (optional).
# Lefi Crop requires the local AI: a PC can take the ai role only if a supported model runs
# fully on its GPU; a core node needs a viable AI node (ADR-028).
# Internet is needed once to download tools and the model; afterwards everything is LAN-only.

set -o pipefail
umask 022   # never inherit a permissive umask (e.g. 000): state files are tightened below

LEFI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export LEFI_ROOT

# ---------------------------------------------------------------- arguments (before the libs:
# the service mode decides the file layout the libs use)
MODE="install"; LEFI_ROLES=""; ARG_ANSWERS=""; ARG_EVENTS=""; ARG_SVC=""; DEV_ALLOW_NO_AI=0; CANCEL_FILE=""; RB_JOURNALS=""
ORIG_ARGS=("$@")
usage_die() { echo "$1 (see --help)" >&2; exit 2; }
while [ $# -gt 0 ]; do
  case "$1" in
    --check) MODE="check" ;;
    --dry-run) DRY_RUN=1 ;;
    --yes|-y) ASSUME_YES=1 ;;
    --roles) shift; LEFI_ROLES="$1" ;;
    --roles=*) LEFI_ROLES="${1#*=}" ;;
    --answers) shift; ARG_ANSWERS="$1" ;;
    --answers=*) ARG_ANSWERS="${1#*=}" ;;
    --events) shift; ARG_EVENTS="$1" ;;
    --events=*) ARG_EVENTS="${1#*=}" ;;
    --service-mode) shift; ARG_SVC="$1" ;;
    --service-mode=*) ARG_SVC="${1#*=}" ;;
    --dev-allow-no-ai) DEV_ALLOW_NO_AI=1 ;;
    --rollback) MODE="rollback" ;;
    --update-brain) MODE="update-brain" ;;
    --remove-role) shift; MODE="remove"; REMOVE_ROLE="$1" ;;
    --uninstall-everything) MODE="uninstall" ;;
    --journal) shift; RB_JOURNALS="$RB_JOURNALS$1
" ;;
    --cancel-file) shift; CANCEL_FILE="$1" ;;
    --cancel-file=*) CANCEL_FILE="${1#*=}" ;;
    -h|--help) sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) usage_die "Unknown option: $1" ;;
  esac
  shift
done
[ -z "$ARG_EVENTS" ] || [ "$ARG_EVENTS" = ndjson ] || usage_die "--events supports only 'ndjson'"
if [ -n "$ARG_ANSWERS" ]; then
  case "$ARG_ANSWERS" in /*) ;; *) ARG_ANSWERS="$(pwd)/$ARG_ANSWERS" ;; esac
  [ -r "$ARG_ANSWERS" ] || usage_die "Answers file not readable: $ARG_ANSWERS"
  # SERVICE_MODE is needed before the libs load; the full file is validated later.
  [ -n "$ARG_SVC" ] || ARG_SVC="$(grep -E '^[[:space:]]*SERVICE_MODE=' "$ARG_ANSWERS" | tail -n1 | cut -d= -f2- | tr -d ' \r')"
fi

if [ "$(uname -s)" = Darwin ]; then
  [ -z "$ARG_SVC" ] || [ "$ARG_SVC" = launchd ] || usage_die "--service-mode applies to Linux only (macOS uses launchd)"
  LEFI_SERVICE_MODE=launchd
else
  conf_mode="$(grep -E '^LEFI_SERVICE_MODE=' /etc/lefi-crop/install.conf 2>/dev/null | cut -d= -f2-)"
  case "$ARG_SVC" in
    '') if [ "$MODE" = check ]; then LEFI_SERVICE_MODE="${conf_mode:-user}"; else LEFI_SERVICE_MODE="${conf_mode:-systemd}"; fi ;;
    systemd|user) LEFI_SERVICE_MODE="$ARG_SVC" ;;
    *) usage_die "--service-mode must be systemd or user" ;;
  esac
  if [ "$conf_mode" = systemd ] && [ "$LEFI_SERVICE_MODE" = user ]; then
    usage_die "This machine has a system install (/etc/lefi-crop/install.conf); --service-mode user would mix layouts"
  fi
  # The system install writes /etc, /opt, /var/lib and systemd units: it runs as root.
  if [ "$LEFI_SERVICE_MODE" = systemd ] && [ "$(id -u)" != 0 ] && [ "${DRY_RUN:-0}" != 1 ]; then
    command -v sudo >/dev/null 2>&1 || usage_die "The system install needs root: run it as root (sudo is not installed)"
    echo "The Linux system install needs root; re-running with sudo…" >&2
    if [ -n "$ARG_ANSWERS" ] || [ -n "$ARG_EVENTS" ]; then exec sudo -n -- "$0" "${ORIG_ARGS[@]}"; fi
    exec sudo -- "$0" "${ORIG_ARGS[@]}"
  fi
fi
export LEFI_SERVICE_MODE

# Events: fd 3 = the real stdout (NDJSON only); everything human goes to stderr.
# Lefi Crop Helper may close mid-run: keep going instead of dying at the next write to its pipe, so
# a step is never cut in half by that. The events file still records how the run ended.
if [ "$ARG_EVENTS" = ndjson ]; then exec 3>&1 1>&2; EVENTS=1; trap '' PIPE; fi

for lib in common detect hwscan recommend system journal robot_sim role_ai role_core role_admin role_optional role_desktop role_remove brain_update verify; do
  # shellcheck source=/dev/null
  . "$LEFI_ROOT/scripts/lib/$lib.sh"
done
[ "$EVENTS" = 1 ] && colors_off

normalize_roles() {
  local out="" r
  for r in $(echo "$1" | tr ',' ' '); do
    case "$r" in
      all) out="$out,ai,core,admin" ;;
      ai|core|admin|robot|firmware|desktop) out="$out,$r" ;;
      *) DIE_CODE=ANSWERS_INVALID; die "Unknown role '$r' (ai, core, admin, desktop, robot, firmware, all)" ;;
    esac
  done
  echo "$out" | tr ',' '\n' | awk 'NF && !seen[$0]++' | paste -sd, -
}

choose_roles() {
  header "What should this machine run?"
  cat <<EOF
    1) AI node        Ollama + Gemma (needs a supported GPU: the model must run fully on it)
    2) Core node      Lefi Brain backend + MQTT broker + database
    3) Lefi Gateway   The HTTPS door to Lefi Brain for Lefi Desktop (Caddy)
    4) Robot sim      MH3 Genesis starter (optional, heavy download)
    5) Firmware tools PlatformIO for flashing the ESP32 (optional)
    6) Lefi Desktop   The dashboard app for operators (optional, macOS)
    A) All-in-one     1 + 2 + 3 on this machine

    Example: a MacBook Pro for AI → "1"; a second Mac for backend + web → "2 3".
EOF
  local prev; prev="$(env_get LEFI_ROLES)"
  [ -n "$prev" ] && info "Previously installed here: $prev"
  ask "Your choice (numbers separated by spaces, or A)" "A"
  local sel="" c
  for c in $REPLY; do
    case "$c" in
      1) sel="$sel,ai" ;; 2) sel="$sel,core" ;; 3) sel="$sel,admin" ;;
      4) sel="$sel,robot" ;; 5) sel="$sel,firmware" ;; 6) sel="$sel,desktop" ;; a|A) sel="$sel,all" ;;
      *) die "Invalid choice: $c" ;;
    esac
  done
  LEFI_ROLES="$(normalize_roles "$sel")"
}

# Every step of the run is declared first, so progress = steps done / steps total is exact.
build_plan() {
  plan_add scan "Scan this machine's hardware"
  if [ "$MODE" = check ]; then plan_add verify "Verify the installation"; return 0; fi
  plan_add prereq "Prerequisites (package manager, service user)"
  if roles_has ai; then
    plan_add ai.model_choice "Choose the model this PC can run"
    plan_add ai.ollama "Install Ollama"
    plan_add ai.service "Start the AI service"
    plan_add ai.model "Download the model"
    plan_add ai.verify "Verify the model runs fully on the GPU"
  fi
  if roles_has core; then
    plan_add core.packages "Install Mosquitto, uv and Python"
    plan_add core.ai "Connect to the AI node"
    plan_add core.mqtt "Configure the MQTT broker"
    plan_add core.config "Write Lefi Brain configuration"
    plan_add core.brain "Install, migrate and start Lefi Brain"
  fi
  if roles_has admin; then
    plan_add admin.packages "Install Lefi Gateway"
    plan_add admin.site "Configure and start Lefi Gateway"
  fi
  roles_has robot && plan_add robot.install "Robot simulator (MH3 starter)"
  roles_has firmware && plan_add firmware.install "Firmware toolchain (PlatformIO)"
  roles_has desktop && plan_add desktop.app "Install Lefi Desktop"
  plan_add verify "Verify the installation"
  plan_add cli "Install the lefi command"
}

# Hardware scan, saved for the audit trail (INSTALLER.md §7.1).
scan_step() {
  step_begin scan
  detect_system
  hw_scan
  recommend_models
  if [ "$DRY_RUN" != 1 ]; then
    _j j_file "$LEFI_STATE_DIR/hw/scan-$LOG_STAMP.json"
    mkdir -p "$LEFI_STATE_DIR/hw" 2>/dev/null && hw_json "$(recommend_json)" >"$LEFI_STATE_DIR/hw/scan-$LOG_STAMP.json" 2>/dev/null \
      && _log "WROTE $LEFI_STATE_DIR/hw/scan-$LOG_STAMP.json"
  fi
  hw_print
  if [ "$MODE" != check ]; then
    local p u pr want=""
    roles_has ai && want="$want 11434"; roles_has core && want="$want 1883 8000"; roles_has admin && want="$want 8080 8443"
    for p in $want; do
      eval "u=\$HW_PORT_$p; pr=\$HW_PORT_${p}_PROC"
      [ "$u" = true ] && info "Port $p is already in use${pr:+ by $pr} (fine if it is a Lefi Crop service being re-installed)"
    done
  fi
}

prereq_step() {
  step_begin prereq
  header "Prerequisites"
  if is_macos; then
    ensure_brew
    pkg_install curl curl || die "curl required."
  elif [ "$LEFI_SERVICE_MODE" = systemd ]; then
    local fam; fam="$(linux_pkg_family)"
    [ -n "$fam" ] || { DIE_CODE=UNSUPPORTED_OS; DIE_HINT="Supported: Ubuntu LTS, RHEL/Rocky/Alma, Debian (INSTALLER.md §8.5)"; die "No apt or dnf on this Linux ($HW_OS_NAME)."; }
    info "Distribution: $HW_OS_NAME · packages: $fam · tier $(linux_tier)"
    case "$(linux_tier)" in unsupported*) warn "This distribution is not in the supported tiers; continuing at your own risk." ;; esac
    if [ ! -d /run/systemd/system ] && [ "$DRY_RUN" != 1 ]; then
      DIE_CODE=NO_SYSTEMD; DIE_HINT="Use --service-mode user for a development install without systemd (e.g. in a container)."
      die "systemd is not running on this machine; system services cannot be installed."
    fi
    pkg_install curl curl || die "curl required."
    # The service user's systemctl (lefi status/start/stop) talks to systemd over the D-Bus
    # system bus; minimal images (containers) may lack it.
    if [ ! -S /run/dbus/system_bus_socket ] && [ "$DRY_RUN" != 1 ]; then
      linux_pkg_install dbus && "$SYSTEMCTL" start dbus >>"$LOG_FILE" 2>&1 || warn "D-Bus system bus not available: lefi status/start/stop as $SERVICE_USER may fail"
    fi
    ensure_service_user
    write_sudoers
  else
    warn "Linux development mode (--service-mode user): nothing is installed system-wide and services stop at reboot."
    have curl || die "curl required."
  fi
}

# --rollback: undo the newest install run that was not rolled back yet (ADR-032).
rollback_main() {
  if [ -d "$LEFI_STATE_DIR" ]; then log_init; install_lock; else LOG_FILE=/dev/null; EVENTS_FILE=""; fi
  lefi_banner "rollback"
  local j rc=0 dir real list
  if [ -n "$RB_JOURNALS" ]; then
    # Exactly these runs (Lefi Crop Helper: every run of one command, e.g. before and after a restart),
    # newest first. Only journals inside this installation's journal folder are accepted.
    dir="$(cd "$(journal_dir)" 2>/dev/null && pwd -P)"
    list="$(printf '%s' "$RB_JOURNALS" | awk 'NF{a[++n]=$0} END{for(i=n;i>0;i--) print a[i]}')"
    while IFS= read -r j; do
      [ -n "$j" ] || continue
      real="$(cd "$(dirname "$j")" 2>/dev/null && pwd -P)/$(basename "$j")"
      case "$real" in "$dir"/run-*.tsv) ;; *) warn "Not a journal of this installation: $j (skipped)"; continue ;; esac
      if [ -e "$real.rolledback" ]; then info "Already undone: $(basename "$real")"; continue; fi
      rollback_run "$real" requested || rc=1
    done <<EOF
$list
EOF
    [ -n "$RB_RESULT" ] || rollback_run "" requested
  else
    j="$(latest_journal)"
    if [ -z "$j" ]; then info "No install run to roll back in $(journal_dir)."; fi
    rollback_run "$j" requested || rc=1
  fi
  [ "$RB_RESULT" = partial ] && warn "Some changes could not be undone; see $RB_REPORT/summary.tsv"
  exit "$rc"
}

main() {
  [ "$MODE" = rollback ] && rollback_main
  if [ "$MODE" = uninstall ]; then uninstall_everything_main; fi
  if [ "$MODE" = remove ]; then log_init; install_lock; lefi_banner "remove"; remove_role_main "$REMOVE_ROLE"; fi
  if [ "$MODE" = update-brain ]; then log_init; install_lock; lefi_banner "Lefi Brain update"; brain_update_main; fi
  # Was the state folder already there? Then a rollback must keep it (and only undo inside it).
  local state_existed=0; [ -d "$LEFI_STATE_DIR" ] && state_existed=1
  [ -n "$ARG_ANSWERS" ] && answers_load "$ARG_ANSWERS"
  if [ -z "$LEFI_ROLES" ] && answer_get ROLES; then LEFI_ROLES="$ANSWER"; fi
  answer_get DEV_ALLOW_NO_AI && yes_no "$ANSWER" && DEV_ALLOW_NO_AI=1
  if [ "$LEFI_SERVICE_MODE" = systemd ] && [ "$MODE" != check ] && [ "$DRY_RUN" != 1 ]; then
    install -d -m 755 "$(dirname "$LEFI_STATE_DIR")" 2>/dev/null
    install -d -m 750 "$LEFI_STATE_DIR" "$LOG_DIR" 2>/dev/null
  fi
  log_init
  if [ "$MODE" = install ] && [ "$DRY_RUN" != 1 ]; then
    install_lock
    journal_init "$LOG_STAMP"
    [ "$state_existed" = 1 ] || j_add dir_created "$LEFI_STATE_DIR"
    [ -n "$CANCEL_FILE" ] && rm -f "$CANCEL_FILE" 2>/dev/null   # a stale request must not cancel this run
  fi
  [ -n "$ARG_ANSWERS" ] && _log "ANSWERS $ARG_ANSWERS (keys: $(grep -oE '^[[:space:]]*[A-Z_]+=' "$ARG_ANSWERS" | tr -d ' =' | paste -sd, -))"
  lefi_banner "installer"

  if [ "$MODE" = check ]; then
    [ -n "$LEFI_ROLES" ] && LEFI_ROLES="$(normalize_roles "$LEFI_ROLES")" || LEFI_ROLES="$(env_get LEFI_ROLES)"
    [ -n "$LEFI_ROLES" ] || { DIE_CODE=NOT_INSTALLED; die "No roles recorded in $ENV_FILE. Run ./scripts/install.sh first (or pass --roles)."; }
    build_plan; plan_start check
    scan_step
    info "Checking roles: $LEFI_ROLES"
    step_begin verify
    run_verification; local rc=$?
    step_ok
    plan_done "$( [ "$rc" = 0 ] && echo ok || echo failed)" "\"checks\":{\"pass\":$N_PASS,\"warn\":$N_WARN,\"fail\":$N_FAIL,\"pending\":$N_PEND}"
    exit $rc
  fi

  if [ -n "$LEFI_ROLES" ]; then LEFI_ROLES="$(normalize_roles "$LEFI_ROLES")"; else choose_roles; fi
  [ -n "$LEFI_ROLES" ] || die "No role selected."
  if [ "$LEFI_SERVICE_MODE" = systemd ] && { roles_has robot || roles_has firmware; }; then
    DIE_CODE=ROLE_MODE; DIE_HINT="Run them as your normal user: ./scripts/install.sh --roles robot,firmware --service-mode user"
    die "The robot and firmware roles are per-user developer tools, not system services."
  fi

  build_plan
  plan_start install
  scan_step

  header "Plan"
  info "Roles:          $LEFI_ROLES"
  info "Services:       $(service_mode_desc)"
  info "Runtime state:  $LEFI_STATE_DIR (configs, credentials, logs, data — never committed)"
  info "Configuration:  $ENV_FILE (chmod 600)"
  info "Steps:          $EV_TOTAL"
  info "Internet is required now for downloads only."
  if ! confirm "Continue?" y CONTINUE; then info "Nothing changed."; plan_done cancelled; exit 0; fi

  prereq_step
  [ "$DRY_RUN" = "1" ] || mkdir -p "$LEFI_STATE_DIR"
  if [ ! -f "$ENV_FILE" ] && [ "$DRY_RUN" != "1" ]; then
    j_file "$ENV_FILE"
    cp "$LEFI_ROOT/.env.example" "$ENV_FILE"; chmod 600 "$ENV_FILE"; ok "Created $ENV_FILE from .env.example"
  fi

  roles_has ai && role_ai_install
  roles_has core && role_core_install
  roles_has admin && role_admin_install
  roles_has robot && role_robot_install
  roles_has firmware && role_firmware_install
  roles_has desktop && role_desktop_install

  local prev merged; prev="$(env_get LEFI_ROLES)"
  merged="$(normalize_roles "${prev:+$prev,}$LEFI_ROLES")"
  env_set LEFI_ROLES "$merged"; LEFI_ROLES="$merged"
  env_set LEFI_SERVICE_MODE "$LEFI_SERVICE_MODE"
  state_fix_owner

  step_begin verify
  header "Verifying the installation"
  local rc=0
  if [ "$DRY_RUN" = "1" ]; then info "Skipped in dry-run."
  else run_verification; rc=$?; fi

  step_begin cli
  header "Next steps"
  roles_has admin && info "Lefi Gateway: $(env_get LEFI_ADMIN_URL)"
  roles_has core && info "Credentials:  $LEFI_STATE_DIR/credentials/ (admin + MQTT device passwords)"
  roles_has ai && ! roles_has core && info "Core node must use OLLAMA_BASE_URL=http://$LAN_IP:11434"
  info "Re-check any time:  lefi check   (or ./scripts/install.sh --check)"
  if [ "$DRY_RUN" = 1 ]; then info "[dry-run] would install the lefi command"
  elif [ "$LEFI_SERVICE_MODE" = systemd ]; then
    install_system_cli
  elif ! have lefi; then
    if confirm "Install the 'lefi' command globally (control services, AI kill switch, logs)?" y INSTALL_CLI; then
      # `lefi cli install` runs in its own process: journal the link and shell rc it may write.
      local d rc_f
      for d in /opt/homebrew/bin /usr/local/bin "$HOME/.local/bin"; do j_file "$d/lefi"; done
      for rc_f in "$HOME/.zshrc" "$HOME/.bashrc"; do [ -f "$rc_f" ] && j_file "$rc_f"; done
      "$LEFI_ROOT/bin/lefi" cli install
    fi
  fi
  step_ok
  plan_done "$( [ "$rc" = 0 ] && echo ok || echo failed)" \
    "\"checks\":{\"pass\":${N_PASS:-0},\"warn\":${N_WARN:-0},\"fail\":${N_FAIL:-0},\"pending\":${N_PEND:-0}}"
  exit $rc
}

main
