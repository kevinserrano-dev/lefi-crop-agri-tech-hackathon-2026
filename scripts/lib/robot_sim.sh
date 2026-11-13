# shellcheck shell=bash
# The simulated MH3 robot as a component of this PC (ADR-091, ADR-090): where it lives, how its
# service starts and stops on demand, and what `lefi robot status --json` reports. Shared by the
# installer (role robot) and the CLI (`lefi robot …`). macOS bash 3.2 compatible.
#
# The robot never runs on the PC of the AI node (ADR-090): the installer refuses the robot role
# where the AI role is, and the AI role where the robot is.

ROBOT_LABEL="com.lefi-crop.robot-sim"
ROBOT_HOME="$LEFI_ROOT/simulators/robot-mh3"
ROBOT_STATE="$LEFI_STATE_DIR/robot-sim"
# The starter (several GB) lives with this PC's data, never inside Lefi Crop Helper.app: an update
# replaces the app and took the starter with it (ADR-104). Older installs kept it in $ROBOT_HOME/vendor.
ROBOT_STARTER="$ROBOT_STATE/starter/GDG-Hackathon"
ROBOT_STARTER_OLD="$ROBOT_HOME/vendor/GDG-Hackathon"
ROBOT_CONF="$ROBOT_STATE/robot.conf"
ROBOT_TOKEN="$ROBOT_STATE/token"
ROBOT_PIDFILE="$LEFI_STATE_DIR/run/robot-sim.pid"
ROBOT_PORT_DEFAULT=8765
# The starter commit inspected for ADR-091; fetch-starter.sh pins the same one.
ROBOT_STARTER_COMMIT="ec55144be4dc41a40d45317638e13c7ccfa5b791"
ROBOT_STARTER_URL="https://github.com/HumanoidAppLab/GDG-Hackathon.git"

robot_log() { echo "${LOG_DIR:-$LEFI_STATE_DIR/logs}/robot-sim.log"; }
robot_plist() { echo "$HOME/Library/LaunchAgents/$ROBOT_LABEL.plist"; }
robot_conf_get() { [ -f "$ROBOT_CONF" ] && sed -n "s/^$1=//p" "$ROBOT_CONF" | tail -n1; }
robot_installed() { [ -f "$ROBOT_CONF" ]; }
robot_port() { local p; p="$(robot_conf_get PORT)"; echo "${p:-$ROBOT_PORT_DEFAULT}"; }

# The AI node is on this PC when the AI role was recorded here or its service exists.
robot_ai_here() {
  case ",$(env_get LEFI_ROLES 2>/dev/null)," in *,ai,*) return 0 ;; esac
  [ -f "$LEFI_STATE_DIR/services/ollama.svc" ]
}

# robot_write_conf BACKEND PROGRAM ARGS... — how the bridge is started, read by start/status.
robot_write_conf() {
  local backend="$1" a; shift
  mkdir -p "$ROBOT_STATE"; chmod 700 "$ROBOT_STATE" 2>/dev/null
  { printf 'BACKEND=%s\n' "$backend"; printf 'PORT=%s\n' "$ROBOT_PORT_DEFAULT"
    printf 'TOKEN_FILE=%s\n' "$ROBOT_TOKEN"; printf 'LOG=%s\n' "$(robot_log)"
    [ "$backend" = genesis ] && printf 'STARTER=%s\n' "$ROBOT_STARTER"
    printf 'UV=%s\n' "$(command -v uv 2>/dev/null)"
    for a in "$@"; do printf 'ARG=%s\n' "$a"; done; } >"$ROBOT_CONF"
  chmod 600 "$ROBOT_CONF"
}

# The program and arguments recorded in robot.conf, one per line.
robot_args() { [ -f "$ROBOT_CONF" ] && sed -n 's/^ARG=//p' "$ROBOT_CONF"; }

# The PATH the bridge runs with. launchd starts an agent with only /usr/bin:/bin:/usr/sbin:/sbin, and
# the starter's run.sh looks `uv` up by name: without its folder the 3D robot died at once with
# "uv was not found. Run ./setup.sh first." (main MacBook, 0.20.0, ADR-104).
robot_path() {
  local uv d p=""
  uv="$(robot_conf_get UV)"; [ -x "$uv" ] || uv="$(command -v uv 2>/dev/null)"
  for d in "${uv:+$(dirname "$uv")}" "$HOME/.local/bin" "$HOME/.cargo/bin" /opt/homebrew/bin /usr/local/bin /usr/bin /bin /usr/sbin /sbin; do
    [ -n "$d" ] || continue
    case ":$p:" in *":$d:"*) ;; *) p="${p:+$p:}$d" ;; esac
  done
  echo "$p"
}

# Where this install's starter is: recorded in robot.conf (older installs: inside the app).
robot_starter() { local s; s="$(robot_conf_get STARTER)"; echo "${s:-$ROBOT_STARTER_OLD}"; }

# Why the installed robot cannot start, as a code Lefi Brain and Lefi Desktop explain (empty = ready):
# starter_missing (genesis: the MH3 starter is gone, e.g. it was inside an older Lefi Crop Helper.app)
# · program_missing (the program robot.conf starts does not exist any more).
robot_problem() {
  local prog
  robot_installed || return 0
  if [ "$(robot_conf_get BACKEND)" = genesis ] && [ ! -x "$(robot_starter)/run.sh" ]; then
    echo starter_missing; return 0
  fi
  prog="$(robot_args | head -n1)"
  [ -n "$prog" ] && [ ! -x "$prog" ] && echo program_missing
  return 0
}

# macOS: a LaunchAgent that never starts by itself (no RunAtLoad, no KeepAlive): only
# `lefi robot start` loads it, `lefi robot stop` unloads it. The robot uses the GPU only on demand.
robot_write_plist() {
  local plist args_xml="" a log
  plist="$(robot_plist)"; log="$(robot_log)"
  while IFS= read -r a; do args_xml="$args_xml    <string>$a</string>
"; done <<EOF
$(robot_args)
EOF
  mkdir -p "$(dirname "$plist")" "$(dirname "$log")"
  cat >"$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$ROBOT_LABEL</string>
  <key>ProgramArguments</key>
  <array>
$args_xml  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PYTHONPATH</key><string>$ROBOT_HOME/src</string>
    <key>LEFI_MH3_STARTER</key><string>$(robot_starter)</string>
    <key>PATH</key><string>$(robot_path)</string>
    <key>HOME</key><string>$HOME</string>
  </dict>
  <key>RunAtLoad</key><false/>
  <key>KeepAlive</key><false/>
  <key>StandardOutPath</key><string>$log</string>
  <key>StandardErrorPath</key><string>$log</string>
</dict>
</plist>
PLIST
}

robot_pid() {
  local pid=""
  if is_macos; then
    pid="$(lefi_launchctl print "gui/$(id -u)/$ROBOT_LABEL" 2>/dev/null | awk '/^[[:space:]]*pid = /{print $3; exit}')"
  elif [ -f "$ROBOT_PIDFILE" ]; then
    pid="$(cat "$ROBOT_PIDFILE")"
  fi
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && ! robot_pid_zombie "$pid" && echo "$pid"
  return 0
}
# A bridge that exited but was not reaped yet (its parent is still this shell) is not running.
robot_pid_zombie() { case "$(ps -o stat= -p "$1" 2>/dev/null)" in Z*) return 0 ;; esac; return 1; }
robot_running() { [ -n "$(robot_pid)" ]; }

# Answering = the bridge accepts connections on its port (Genesis takes 1–2 minutes to build).
robot_answering() { port_listening "$(robot_port)"; }

robot_start() {
  robot_installed || { DIE_CODE=ROBOT_NOT_INSTALLED; err "The simulated robot is not installed on this PC."; return 3; }
  robot_running && { ok "The simulated robot is already running"; return 0; }
  local problem; problem="$(robot_problem)"
  case "$problem" in
    starter_missing) err "The MH3 starter is missing in $(robot_starter): reinstall the simulated robot (Devices & Health → Robots → Reinstall)."; return 4 ;;
    program_missing) err "The program the simulated robot starts is missing: reinstall the simulated robot (Devices & Health → Robots → Reinstall)."; return 4 ;;
  esac
  mkdir -p "$(dirname "$(robot_log)")"
  printf '\n--- %s lefi robot start (%s)\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$(robot_conf_get BACKEND)" >>"$(robot_log)"
  if is_macos; then
    robot_write_plist
    lefi_launchctl bootout "gui/$(id -u)/$ROBOT_LABEL" >/dev/null 2>&1 || true
    local out
    out="$(lefi_launchctl bootstrap "gui/$(id -u)" "$(robot_plist)" 2>&1)" \
      || { printf '%s\n' "$out" >>"$(robot_log)"; err "launchctl could not load $(robot_plist): ${out:-no reason given}"; return 1; }
    lefi_launchctl kickstart "gui/$(id -u)/$ROBOT_LABEL" >>"$(robot_log)" 2>&1 || true
  else
    set --
    while IFS= read -r a; do [ -n "$a" ] && set -- "$@" "$a"; done <<EOF
$(robot_args)
EOF
    mkdir -p "$(dirname "$ROBOT_PIDFILE")"
    PATH="$(robot_path)" PYTHONPATH="$ROBOT_HOME/src" LEFI_MH3_STARTER="$(robot_starter)" nohup "$@" </dev/null >>"$(robot_log)" 2>&1 &
    echo $! >"$ROBOT_PIDFILE"
    disown 2>/dev/null || true
  fi
  # A bridge that dies at once (missing package, bad path) is reported here, with its last lines.
  # launchd may take a moment to show the pid: it must appear, then stay up for the whole wait.
  local i=0 seen=0
  while [ "$i" -lt "${ROBOT_START_WAIT:-6}" ]; do
    sleep 1; i=$((i + 1))
    if robot_running; then seen=1; elif [ "$seen" = 1 ] || [ "$i" -ge 3 ]; then break; fi
  done
  if ! robot_running; then
    rm -f "$ROBOT_PIDFILE"
    err "The simulated robot stopped right after starting. Last lines of $(robot_log):"
    tail -n 15 "$(robot_log)" >&2 2>/dev/null
    return 1
  fi
  ok "Simulated robot starting ($(robot_conf_get BACKEND); the 3D scene takes 1–2 minutes to build)"
}

robot_stop() {
  local pid
  robot_installed || return 0
  pid="$(robot_pid)"
  if is_macos; then
    lefi_launchctl bootout "gui/$(id -u)/$ROBOT_LABEL" >/dev/null 2>&1 || true
  fi
  [ -n "$pid" ] && terminate_robot_pid "$pid"
  rm -f "$ROBOT_PIDFILE"
  ok "Simulated robot stopped"
}

terminate_robot_pid() {  # SIGTERM, up to 10 s, then SIGKILL (by PID, never by name)
  local pid="$1" i=0
  kill -TERM "$pid" 2>/dev/null || return 0
  while kill -0 "$pid" 2>/dev/null && [ "$i" -lt 10 ]; do sleep 1; i=$((i + 1)); done
  kill -0 "$pid" 2>/dev/null && kill -KILL "$pid" 2>/dev/null
  return 0
}

# One line of JSON: what Lefi Crop Helper and Lefi Brain read.
robot_status_json() {
  local installed=false running=false answering=false pid backend="" port problem
  robot_installed && installed=true
  problem="$(robot_problem)"
  pid="$(robot_pid)"; [ -n "$pid" ] && running=true
  port="$(robot_port)"
  [ "$running" = true ] && robot_answering && answering=true
  backend="$(robot_conf_get BACKEND)"
  printf '{"installed":%s,"running":%s,"answering":%s,"backend":%s,"pid":%s,"port":%s,"url":"http://127.0.0.1:%s","token_file":"%s","log":"%s","ai_here":%s,"problem":%s}\n' \
    "$installed" "$running" "$answering" "$( [ -n "$backend" ] && printf '"%s"' "$backend" || echo null)" \
    "${pid:-null}" "$port" "$port" "$ROBOT_TOKEN" "$(robot_log)" "$(robot_ai_here && echo true || echo false)" \
    "$( [ -n "$problem" ] && printf '"%s"' "$problem" || echo null)"
}
