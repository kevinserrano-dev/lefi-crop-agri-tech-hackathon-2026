# shellcheck shell=bash
# Common helpers for the LEFI CROP installer. Compatible with macOS bash 3.2:
# no associative arrays, no ${var,,}, no mapfile, no `set -u`.

LEFI_ROOT="${LEFI_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
# Running from the payload inside Lefi Crop Helper.app (ADR-034): that folder is read-only and part of
# the signed app, so nothing may be written there (configuration and Brain environment go to
# the state folder instead).
case "$LEFI_ROOT" in */*.app/Contents/Resources/payload) LEFI_PACKAGED=1 ;; *) LEFI_PACKAGED=0 ;; esac
# A satellite unpacks the payload into a folder named after its checksum, which changes with every
# release: configuration must not live there either (ADR-040).
[ "${LEFI_FORCE_PACKAGED:-0}" = 1 ] && LEFI_PACKAGED=1

# Service mode and file layout (ADR-029):
#   launchd  macOS, per-user: state ~/.lefi-crop, config <repo>/.env
#   user     Linux development (nohup), same per-user layout
#   systemd  Linux system install: state /var/lib/lefi-crop (owner `lefi`),
#            config /etc/lefi-crop/lefi.env, runtimes /opt/lefi-crop — recorded in install.conf
LEFI_INSTALL_CONF="${LEFI_INSTALL_CONF:-/etc/lefi-crop/install.conf}"
SERVICE_USER="${SERVICE_USER:-lefi}"
install_conf_get() { [ -f "$LEFI_INSTALL_CONF" ] && grep -E "^$1=" "$LEFI_INSTALL_CONF" | tail -n1 | cut -d= -f2-; }
if [ -z "${LEFI_SERVICE_MODE:-}" ]; then
  case "$(uname -s)" in
    Darwin) LEFI_SERVICE_MODE=launchd ;;
    *) LEFI_SERVICE_MODE="$(install_conf_get LEFI_SERVICE_MODE)"; LEFI_SERVICE_MODE="${LEFI_SERVICE_MODE:-user}" ;;
  esac
fi
if [ "$LEFI_SERVICE_MODE" = systemd ]; then
  LEFI_STATE_DIR="${LEFI_STATE_DIR:-$(install_conf_get LEFI_STATE_DIR)}"; LEFI_STATE_DIR="${LEFI_STATE_DIR:-/var/lib/lefi-crop}"
  ENV_FILE="${ENV_FILE:-$(install_conf_get ENV_FILE)}"; ENV_FILE="${ENV_FILE:-/etc/lefi-crop/lefi.env}"
  LEFI_RUNTIME_DIR="${LEFI_RUNTIME_DIR:-$(install_conf_get LEFI_RUNTIME_DIR)}"; LEFI_RUNTIME_DIR="${LEFI_RUNTIME_DIR:-/opt/lefi-crop}"
else
  LEFI_STATE_DIR="${LEFI_STATE_DIR:-$HOME/.lefi-crop}"
  if [ "$LEFI_PACKAGED" = 1 ]; then ENV_FILE="${ENV_FILE:-$LEFI_STATE_DIR/lefi.env}"
  else ENV_FILE="${ENV_FILE:-$LEFI_ROOT/.env}"; fi
  LEFI_RUNTIME_DIR=""
fi
export LEFI_SERVICE_MODE LEFI_STATE_DIR ENV_FILE
MODELS_FILE="$LEFI_ROOT/config/supported-models.tsv"
LOG_DIR="$LEFI_STATE_DIR/logs"
AI_KILL_FLAG="$LEFI_STATE_DIR/flags/ai.disabled"
DRY_RUN="${DRY_RUN:-0}"
ASSUME_YES="${ASSUME_YES:-0}"

if [ -t 1 ]; then
  C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'
  C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_RED=$'\033[31m'; C_BLUE=$'\033[34m'; C_BROWN=$'\033[38;5;130m'
else
  C_RESET=""; C_BOLD=""; C_DIM=""; C_GREEN=""; C_YELLOW=""; C_RED=""; C_BLUE=""; C_BROWN=""
fi

log_init() {
  mkdir -p "$LOG_DIR" 2>/dev/null || true
  LOG_STAMP="$(date +%Y%m%d-%H%M%S)"
  LOG_FILE="$LOG_DIR/install-$LOG_STAMP.log"
  : >"$LOG_FILE" 2>/dev/null || LOG_FILE="/dev/null"
  # Setup audit: every event of this run, also without --events (ADR-028).
  EVENTS_FILE="$LOG_DIR/install-$LOG_STAMP.events.ndjson"
  : >"$EVENTS_FILE" 2>/dev/null || EVENTS_FILE=""
}

_log() { [ -n "$LOG_FILE" ] && printf '%s %s\n' "$(date +%H:%M:%S)" "$*" >>"$LOG_FILE" 2>/dev/null; return 0; }
header() { printf '\n%s%s== %s ==%s\n' "$C_BOLD" "$C_GREEN" "$*" "$C_RESET"; _log "== $*"; }
step()   { printf '%s›%s %s\n' "$C_BLUE" "$C_RESET" "$*"; _log "STEP $*"; ev_log info "$*"; }
info()   { printf '  %s\n' "$*"; _log "INFO $*"; ev_log info "$*"; }
ok()     { printf '  %s✔%s %s\n' "$C_GREEN" "$C_RESET" "$*"; _log "OK $*"; ev_log ok "$*"; }
warn()   { printf '  %s!%s %s\n' "$C_YELLOW" "$C_RESET" "$*"; _log "WARN $*"; ev_warn "$*"; }
err()    { printf '  %s✖%s %s\n' "$C_RED" "$C_RESET" "$*" >&2; _log "ERROR $*"; ev_log error "$*"; }
# die MESSAGE — set DIE_CODE / DIE_HINT before calling for a machine-readable failure.
die()    {
  err "$*"; [ -n "${DIE_HINT:-}" ] && info "Hint: $DIE_HINT"
  [ -n "$LOG_FILE" ] && [ "$LOG_FILE" != /dev/null ] && err "Log: $LOG_FILE"
  ev_failed "${DIE_CODE:-STEP_FAILED}" "$*" "${DIE_HINT:-}"
  exit 1
}

have() { command -v "$1" >/dev/null 2>&1; }

# Homebrew puts some programs in sbin (the Mosquitto broker): having brew on the PATH is not enough.
# Derived from the brew actually found, so a test's fake Homebrew never brings in the real one.
lefi_brew_path() {
  local b p
  b="$(command -v brew 2>/dev/null)" || return 0
  p="${b%/bin/brew}"
  [ -d "$p/sbin" ] || return 0
  case ":$PATH:" in *":$p/sbin:"*) ;; *) PATH="$p/sbin:$PATH"; export PATH ;; esac
}
lefi_brew_path

# known_failure — what the end of the log says went wrong: sets DIE_CODE and DIE_HINT, returns 1 if
# it is not a known problem. The hint says what to do, then Retry; finished steps are not repeated.
known_failure() {
  local tail_text
  [ -n "$LOG_FILE" ] && [ -f "$LOG_FILE" ] || return 1
  tail_text="$(tail -n 60 "$LOG_FILE" 2>/dev/null)"
  case "$tail_text" in
    *"No space left on device"*)
      DIE_CODE=DISK_FULL; DIE_HINT="The disk of this PC is full. Free some space and press Retry." ;;
    *"Could not resolve host"*|*"Failed to connect"*|*"Network is unreachable"*|*"Connection timed out"*|*"Operation timed out"*|*"curl: (6)"*|*"curl: (7)"*|*"curl: (28)"*|*"dns error"*)
      DIE_CODE=NO_INTERNET; DIE_HINT="This PC needs internet once to download its tools. Connect it to a network with internet and press Retry." ;;
    *"has already locked"*|*"Another active Homebrew"*|*"waiting for other"*)
      DIE_CODE=BREW_BUSY; DIE_HINT="Another Homebrew process is running on this PC. Wait for it to finish and press Retry." ;;
    *"are not writable"*|*"is not writable"*)
      DIE_CODE=BREW_PERMISSIONS; DIE_HINT="Homebrew's folders do not belong to this user. In Terminal run: sudo chown -R \"\$(whoami)\" \"\$(brew --prefix)\" and press Retry." ;;
    *"xcode-select --install"*|*"Command Line Tools"*)
      DIE_CODE=CLT_MISSING; DIE_HINT="macOS needs its Command Line Tools. Accept the window that just opened, wait until it finishes and press Retry."
      xcode-select --install >/dev/null 2>&1 || true ;;
    *) return 1 ;;
  esac
  return 0
}
die_known() { known_failure; die "$*"; }

# A network hiccup or a Homebrew lock often clears by itself: true when one more try makes sense.
transient_failure() {
  [ -n "$LOG_FILE" ] && [ -f "$LOG_FILE" ] || return 1
  case "$(tail -n 60 "$LOG_FILE" 2>/dev/null)" in
    *"Could not resolve host"*|*"Failed to connect"*|*"Connection timed out"*|*"Operation timed out"*|*"curl: (28)"*|*"has already locked"*|*"Another active Homebrew"*) return 0 ;;
  esac
  return 1
}
# _j FN ARGS... — call an install-journal hook when the journal is loaded (installer only).
_j() { command -v "$1" >/dev/null 2>&1 && "$@"; return 0; }

# ---------------------------------------------------------------- launchd from a service (ADR-040)
# LaunchAgents live in the user's GUI session. A LaunchDaemon, even running as that user, is outside
# it and `launchctl bootstrap gui/UID` fails ("5: Input/output error"). When LEFI_SESSION_DIR is set
# (the Lefi Crop Helper service sets it), the request goes to `lefi-helperd session`, an agent that
# runs inside the session and only accepts com.lefi-crop.* services.
# LEFI_LAUNCHD_VIA_SESSION=1 sends the calls through the session helper even from inside the session
# (the real-chain test and diagnosis use it to travel the boot service's path, ADR-104).
_lefi_direct_launchd() {
  [ -z "${LEFI_SESSION_DIR:-}" ] && return 0
  [ "${LEFI_LAUNCHD_VIA_SESSION:-}" = 1 ] && return 1
  [ "$(launchctl managername 2>/dev/null)" = Aqua ]
}

# Can services be loaded right now? Asked BEFORE stopping anything.
lefi_launchd_ready() {
  _lefi_direct_launchd && return 0
  local m now
  m="$(stat -f %m "$LEFI_SESSION_DIR/alive" 2>/dev/null)"; now="$(date +%s)"
  [ -n "$m" ] && [ $((now - m)) -le 15 ]
}

lefi_launchctl() {
  if _lefi_direct_launchd; then launchctl "$@"; return $?; fi
  if ! lefi_launchd_ready; then
    echo "launchctl $1: nobody is logged in on this Mac (or the Lefi Crop session helper is not running)" >&2
    return 5
  fi
  local id a i=0 rc
  id="$$-$RANDOM"
  for a in "$@"; do printf '%s\n' "$a"; done >"$LEFI_SESSION_DIR/$id.tmp" || return 5
  mv "$LEFI_SESSION_DIR/$id.tmp" "$LEFI_SESSION_DIR/$id.req" || return 5
  while [ ! -e "$LEFI_SESSION_DIR/$id.res" ] && [ "$i" -lt 150 ]; do sleep 0.2; i=$((i + 1)); done
  if [ ! -e "$LEFI_SESSION_DIR/$id.res" ]; then
    rm -f "$LEFI_SESSION_DIR/$id.req"
    echo "launchctl $1: the Lefi Crop session helper did not answer" >&2
    return 5
  fi
  rc="$(sed -n 1p "$LEFI_SESSION_DIR/$id.res")"
  sed 1d "$LEFI_SESSION_DIR/$id.res"
  rm -f "$LEFI_SESSION_DIR/$id.res"
  return "${rc:-5}"
}

# ---------------------------------------------------------------- event stream (--events ndjson)
# Events (INSTALLER.md §3.2): plan.started · step.started · step.progress · step.log · step.ok ·
# step.warn · step.failed · plan.done. One JSON object per line on fd 3 (the original stdout)
# when EVENTS=1 — human output then goes to stderr — and always into $EVENTS_FILE (audit).
# Progress = steps done / steps total, or real bytes (step.progress); never estimated.
EVENTS="${EVENTS:-0}"; EV_SEQ=0; EV_STEP=""; EV_DONE=0; EV_TOTAL=0; EV_PLAN=""; EV_PLAN_STATE=""

ev_emit() {  # ev_emit TYPE [JSON_FIELDS]
  [ "${BASH_SUBSHELL:-0}" -gt 0 ] && [ "$1" != step.progress ] && [ "$1" != step.log ] && return 0
  EV_SEQ=$((EV_SEQ + 1))
  local line
  line="{\"event\":\"$1\",\"seq\":$EV_SEQ,\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"${2:+,$2}}"
  [ -n "$EVENTS_FILE" ] && printf '%s\n' "$line" >>"$EVENTS_FILE" 2>/dev/null
  # Not the printf builtin: when the app reading fd 3 is gone, bash keeps the line it could not write
  # in its buffer and mixes it into the output of every later $(...), corrupting the values read.
  if [ "$EVENTS" = 1 ] && ! /usr/bin/printf '%s\n' "$line" >&3 2>/dev/null; then
    exec 3>/dev/null; EVENTS=0
  fi
  return 0
}
_evq() { printf '"%s"' "$(printf '%s' "$1" | tr '\t\r\n' '   ' | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')"; }
_evstep() { printf '"step":%s,"steps_done":%d,"steps_total":%d' "$(_evq "$EV_STEP")" "$EV_DONE" "$EV_TOTAL"; }

ev_log()  { [ -n "$EV_STEP" ] || return 0; ev_emit step.log "$(_evstep),\"level\":\"$1\",\"message\":$(_evq "$2")"; }
ev_warn() { [ -n "$EV_STEP" ] || return 0; ev_emit step.warn "$(_evstep),\"message\":$(_evq "$1")"; }
ev_failed() {  # ev_failed CODE MESSAGE HINT
  [ -n "$EV_PLAN_STATE" ] || return 0
  [ "${BASH_SUBSHELL:-0}" -gt 0 ] && return 0
  ev_emit step.failed "$(_evstep),\"code\":$(_evq "$1"),\"message\":$(_evq "$2"),\"hint\":$(_evq "$3")"
  EV_STEP=""
}

# plan_add ID "Title" — declare the steps before any of them runs (exact total for progress).
plan_add() { EV_PLAN="$EV_PLAN$1|$2
"; EV_TOTAL=$((EV_TOTAL + 1)); }
plan_title() { printf '%s' "$EV_PLAN" | awk -F'|' -v id="$1" '$1==id{print $2; exit}'; }

plan_start() {  # plan_start MODE
  local steps
  steps="$(printf '%s' "$EV_PLAN" | while IFS='|' read -r id t; do [ -n "$id" ] && printf '{"id":%s,"title":%s},' "$(_evq "$id")" "$(_evq "$t")"; done)"
  EV_PLAN_STATE=running; EV_T0="$(date +%s)"
  ev_emit plan.started "\"mode\":$(_evq "$1"),\"dry_run\":$( [ "$DRY_RUN" = 1 ] && echo true || echo false),\"roles\":$(_evq "$LEFI_ROLES"),\"steps_total\":$EV_TOTAL,\"steps\":[${steps%,}]${JOURNAL_FILE:+,\"journal\":$(_evq "$JOURNAL_FILE")}"
  trap 'plan_exit $?' EXIT
}

# step_begin ID — starts a declared step (closing the previous one as ok).
step_begin() {
  [ -n "$EV_STEP" ] && step_ok
  _j check_cancel   # a cancel request stops the run here: previous step done, next not started
  EV_STEP="$1"
  [ -n "$(plan_title "$1")" ] || _log "WARN step $1 was not declared in the plan"
  ev_emit step.started "$(_evstep),\"title\":$(_evq "$(plan_title "$1")")"
}
step_ok() {  # step_ok [skipped-reason]
  [ -n "$EV_STEP" ] || return 0
  EV_DONE=$((EV_DONE + 1))
  if [ -n "$1" ]; then ev_emit step.ok "$(_evstep),\"skipped\":true,\"reason\":$(_evq "$1")"
  else ev_emit step.ok "$(_evstep)"; fi
  EV_STEP=""
}
step_skip() { step_begin "$1"; step_ok "$2"; }  # step_skip ID REASON

# step_progress DONE TOTAL UNIT — real counters only (bytes from the Ollama pull API).
step_progress() {
  ev_emit step.progress "$(_evstep),\"done\":$1,\"total\":$2,\"unit\":$(_evq "$3")"
}

plan_done() {  # plan_done RESULT [EXTRA_JSON]
  [ "$EV_PLAN_STATE" = running ] || return 0
  [ "$1" = ok ] && [ -n "$EV_STEP" ] && step_ok
  EV_PLAN_STATE="done"
  ev_emit plan.done "\"result\":$(_evq "$1"),\"steps_done\":$EV_DONE,\"steps_total\":$EV_TOTAL,\"duration_s\":$(( $(date +%s) - ${EV_T0:-$(date +%s)} )),\"log\":$(_evq "$LOG_FILE")${2:+,$2}"
}
plan_exit() {  # EXIT trap: a run that ends without plan_done is reported as failed/cancelled.
  [ "$EV_PLAN_STATE" = running ] || return 0
  if [ "$1" = 0 ]; then plan_done cancelled; else plan_done failed; fi
}

# ---------------------------------------------------------------- answers (--answers FILE)
# KEY=VALUE lines (comments with #). Every question of the installer has a key; with an
# answers file nothing is ever asked: a missing key takes the documented default (logged).
ANSWER_KEYS="ROLES SERVICE_MODE CONTINUE MODEL AI_LAN AI_URL INSTALL_HOMEBREW INSTALL_OLLAMA STOP_FOREIGN_OLLAMA STOP_VENDOR_SERVICES UPDATE_MODEL ADMIN_TYPE_PASSWORD ADMIN_PASSWORD_FILE ADMIN_HTTPS ADMIN_HOSTNAME BRAIN_UPSTREAM ROBOT_BACKEND ROBOT_DOWNLOAD ROBOT_SETUP ROBOT_CPU INSTALL_CLI DEV_ALLOW_NO_AI"
ANSWERS_FILE="${ANSWERS_FILE:-}"

answers_load() {  # answers_load FILE — validates keys; values are stored as ANS_<KEY>
  local f="$1" line key val n=0
  [ -r "$f" ] || { DIE_CODE=ANSWERS_INVALID; die "Answers file not readable: $f"; }
  while IFS= read -r line || [ -n "$line" ]; do
    n=$((n + 1)); line="$(printf '%s' "$line" | tr -d '\r' | sed 's/^[[:space:]]*//')"
    case "$line" in ''|'#'*) continue ;; esac
    case "$line" in *=*) ;; *) DIE_CODE=ANSWERS_INVALID; die "$f line $n: expected KEY=VALUE" ;; esac
    key="${line%%=*}"; val="${line#*=}"
    case " $ANSWER_KEYS " in *" $key "*) ;; *)
      DIE_CODE=ANSWERS_INVALID; DIE_HINT="Valid keys: $ANSWER_KEYS"; die "$f line $n: unknown key '$key'" ;; esac
    case "$val" in *'`'*|*'$('*) DIE_CODE=ANSWERS_INVALID; die "$f line $n: value of $key contains a shell expression" ;; esac
    eval "ANS_$key=\$val; ANS_SET_$key=1"
  done <"$f"
  ANSWERS_FILE="$f"
}

answer_get() {  # answer_get KEY -> 0 and ANSWER set when the answers file has it
  local set; eval "set=\${ANS_SET_$1:-}"
  [ -n "$1" ] && [ "$set" = 1 ] || return 1
  eval "ANSWER=\$ANS_$1"
}

no_tty_die() {
  DIE_CODE=NEEDS_ANSWER; DIE_HINT="Run with --answers FILE (see deploy/install/answers.example) or --yes"
  die "Question without a terminal: $1"
}

# ask "Question" "default" [KEY] -> sets REPLY
ask() {
  local q="$1" def="$2" key="$3"
  if [ -n "$ANSWERS_FILE" ]; then
    if answer_get "$key"; then REPLY="$ANSWER"; info "$q → $REPLY (answers file: $key)"
    else REPLY="$def"; info "$q → $def (default; $key not in answers file)"; fi
    return 0
  fi
  if [ "$ASSUME_YES" = "1" ]; then REPLY="$def"; info "$q → $def"; return 0; fi
  [ -r /dev/tty ] && : 2>/dev/null </dev/tty || no_tty_die "$q"
  if [ -n "$def" ]; then
    read -r -p "  ${C_BROWN}?${C_RESET} $q [${def}]: " REPLY </dev/tty
  else
    read -r -p "  ${C_BROWN}?${C_RESET} $q: " REPLY </dev/tty
  fi
  [ -z "$REPLY" ] && REPLY="$def"
  _log "ASK $q -> $REPLY"
  return 0
}

# ask_secret "Question" -> sets REPLY (not echoed, not logged). Never answered from a file.
ask_secret() {
  if [ "$ASSUME_YES" = "1" ] || [ -n "$ANSWERS_FILE" ]; then REPLY=""; return 0; fi
  [ -r /dev/tty ] && : 2>/dev/null </dev/tty || no_tty_die "$1"
  read -r -s -p "  ${C_BROWN}?${C_RESET} $1: " REPLY </dev/tty
  printf '\n'
}

yes_no() { case "$1" in [yYsS]*|true|1) return 0 ;; *) return 1 ;; esac; }

# confirm "Question" y|n [KEY] -> 0 for yes
confirm() {
  local def="${2:-y}" key="$3" hint="Y/n"
  [ "$def" = "n" ] && hint="y/N"
  if [ -n "$ANSWERS_FILE" ]; then
    if answer_get "$key"; then REPLY="$ANSWER"; info "$1 → $REPLY (answers file: $key)"
    else REPLY="$def"; info "$1 → $def (default; $key not in answers file)"; fi
    yes_no "$REPLY"; return
  fi
  if [ "$ASSUME_YES" = "1" ]; then [ "$def" = "y" ]; return; fi
  [ -r /dev/tty ] && : 2>/dev/null </dev/tty || no_tty_die "$1"
  read -r -p "  ${C_BROWN}?${C_RESET} $1 [$hint]: " REPLY </dev/tty
  [ -z "$REPLY" ] && REPLY="$def"
  _log "ASK $1 -> $REPLY"
  yes_no "$REPLY"
}

# run CMD ARGS... — executes (or prints in dry-run) and logs the command.
run() {
  _log "RUN $*"
  if [ "$DRY_RUN" = "1" ]; then
    printf '  %s[dry-run]%s %s\n' "$C_DIM" "$C_RESET" "$*"
    return 0
  fi
  "$@" >>"$LOG_FILE" 2>&1
}

# run_visible CMD ARGS... — like run, but streams output (long downloads).
run_visible() {
  _log "RUN $*"
  if [ "$DRY_RUN" = "1" ]; then
    printf '  %s[dry-run]%s %s\n' "$C_DIM" "$C_RESET" "$*"
    return 0
  fi
  "$@" 2>&1 | tee -a "$LOG_FILE"
  return "${PIPESTATUS[0]}"
}

gen_secret() {
  if have openssl; then
    openssl rand -base64 64 | tr -d '\n/+=' | cut -c1-"${1:-40}"
  else
    python3 -c "import secrets;print(secrets.token_urlsafe(48)[:${1:-40}])"
  fi
}

# --- .env management (repo root, git-ignored, chmod 600) -------------------
env_get() {
  [ -f "$ENV_FILE" ] || return 0
  grep -E "^$1=" "$ENV_FILE" | tail -n 1 | cut -d= -f2-
}

env_set() {
  local key="$1" val="$2" tmp
  _log "ENV $key=<set>"
  if [ "$DRY_RUN" = "1" ]; then
    case "$key" in *SECRET*|*PASSWORD*) val="<generated>";; esac
    printf '  %s[dry-run]%s .env %s=%s\n' "$C_DIM" "$C_RESET" "$key" "$val"
    return 0
  fi
  _j j_file "$ENV_FILE"
  [ -f "$ENV_FILE" ] || { : >"$ENV_FILE"; chmod 600 "$ENV_FILE"; }
  if grep -qE "^$key=" "$ENV_FILE"; then
    tmp="$(mktemp)"
    awk -v k="$key" -v v="$val" 'index($0, k"=")==1 {print k"="v; next} {print}' "$ENV_FILE" >"$tmp"
    cat "$tmp" >"$ENV_FILE"; rm -f "$tmp"
  else
    printf '%s=%s\n' "$key" "$val" >>"$ENV_FILE"
  fi
  chmod 600 "$ENV_FILE"
}

# Keep an existing secret; generate one only if missing.
env_ensure_secret() {
  local cur; cur="$(env_get "$1")"
  if [ -n "$cur" ]; then info "$1 already set (kept)"; else env_set "$1" "$(gen_secret "${2:-40}")"; fi
}

# Human description of the service mode (a function: bash 3.2 cannot parse `case` in $(...)).
service_mode_desc() {
  case "$LEFI_SERVICE_MODE" in
    launchd) echo "launchd LaunchAgents (start at login)" ;;
    systemd) echo "systemd system units as $SERVICE_USER (start at boot) · state $LEFI_STATE_DIR" ;;
    *) echo "Linux development processes (not persistent)" ;;
  esac
}

roles_has() { case ",$LEFI_ROLES," in *",$1,"*) return 0 ;; *) return 1 ;; esac; }

# Write a file from a template replacing {{KEY}} placeholders: render SRC DST KEY=VAL...
render() {
  local src="$1" dst="$2"; shift 2
  local content; content="$(cat "$src")"
  local pair key val
  for pair in "$@"; do
    key="${pair%%=*}"; val="${pair#*=}"
    content="${content//"{{$key}}"/$val}"  # values must not contain "&" (bash 5.2 patsub)
  done
  if [ "$DRY_RUN" = "1" ]; then
    printf '  %s[dry-run]%s write %s\n' "$C_DIM" "$C_RESET" "$dst"; return 0
  fi
  _j j_file "$dst"
  mkdir -p "$(dirname "$dst")"
  printf '%s\n' "$content" >"$dst"
  _log "WROTE $dst"
}

port_listening() {  # port_listening PORT
  if have lsof; then lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
  elif have ss; then ss -ltn 2>/dev/null | awk '{print $4}' | grep -qE "[:.]$1\$"
  else return 2; fi
}

http_ok() { curl -fsS -m "${2:-5}" -o /dev/null "$1" 2>/dev/null; }

colors_off() { C_RESET=""; C_BOLD=""; C_DIM=""; C_GREEN=""; C_YELLOW=""; C_RED=""; C_BLUE=""; C_BROWN=""; }

lefi_banner() {  # lefi_banner SUBTITLE
  printf '%s' "$C_GREEN"
  cat <<'ART'

    ██╗     ███████╗███████╗██╗     ██████╗██████╗  ██████╗ ██████╗      █████╗ ██╗
    ██║     ██╔════╝██╔════╝██║    ██╔════╝██╔══██╗██╔═══██╗██╔══██╗    ██╔══██╗██║
    ██║     █████╗  █████╗  ██║    ██║     ██████╔╝██║   ██║██████╔╝    ███████║██║
    ██║     ██╔══╝  ██╔══╝  ██║    ██║     ██╔══██╗██║   ██║██╔═══╝     ██╔══██║██║
    ███████╗███████╗██║     ██║    ╚██████╗██║  ██║╚██████╔╝██║         ██║  ██║██║
    ╚══════╝╚══════╝╚═╝     ╚═╝     ╚═════╝╚═╝  ╚═╝ ╚═════╝ ╚═╝         ╚═╝  ╚═╝╚═╝
ART
  printf '%s    Lefi Crop AI · Autonomous Greenhouse Intelligence Platform — %s%s\n' "$C_BROWN" "${1:-cli}" "$C_RESET"
  [ "$DRY_RUN" = "1" ] && printf '    %s(dry-run: nothing will be changed)%s\n' "$C_YELLOW" "$C_RESET"
  return 0
}
