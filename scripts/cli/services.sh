# shellcheck shell=bash
# Services (ai · mqtt · brain · admin), processes and resources.

ALL_SERVICES="ai mqtt brain admin"

svc_unit() { case "$1" in ai) echo ollama ;; mqtt) echo mosquitto ;; admin) echo caddy ;; brain) echo brain ;; *) return 1 ;; esac; }
svc_label() { echo "com.lefi-crop.$(svc_unit "$1")"; }
svc_sdunit() { echo "lefi-$(svc_unit "$1").service"; }   # systemd system unit (Linux system install)
svc_desc() { case "$1" in ai) echo "Ollama (local AI)" ;; mqtt) echo "Mosquitto (MQTT broker)" ;; admin) echo "Caddy (admin web + API proxy)" ;; brain) echo "Brain (backend API)" ;; esac; }
svc_spec() { echo "$LEFI_STATE_DIR/services/$(svc_unit "$1").svc"; }

svc_installed() {
  case "$1" in
    ai) [ "$HAS_AI" = 1 ] ;; mqtt) [ "$HAS_CORE" = 1 ] ;;
    brain) [ "$HAS_BRAIN" = 1 ] ;; admin) [ "$HAS_ADMIN" = 1 ] ;; *) return 1 ;;
  esac
}
svc_installed_list() { local s; for s in $ALL_SERVICES; do svc_installed "$s" && echo "$s"; done; return 0; }

svc_port() {
  local p u
  case "$1" in
    ai) echo 11434 ;;
    mqtt) p="$(env_get LEFI_MQTT_PORT)"; echo "${p:-1883}" ;;
    brain) p="$(env_get LEFI_API_PORT)"; echo "${p:-8000}" ;;
    admin) u="$(env_get LEFI_ADMIN_URL)"; p="$(echo "$u" | sed -n 's#.*:\([0-9][0-9]*\).*#\1#p')"; echo "${p:-8080}" ;;
  esac
}

svc_log() {
  local f; f="$(svc_spec "$1")"
  if [ -f "$f" ]; then sed -n 's/^LOG=//p' "$f" | head -n1; else echo "$LOG_DIR/$(svc_unit "$1").log"; fi
}

svc_pid() {
  local pid=""
  if is_macos; then
    # `print` of the GUI domain: `list` only sees the caller's own domain (ADR-040).
    pid="$(lefi_launchctl print "gui/$(id -u)/$(svc_label "$1")" 2>/dev/null | awk '/^[[:space:]]*pid = /{print $3; exit}')"
  elif [ "$LEFI_SERVICE_MODE" = systemd ]; then
    pid="$("$SYSTEMCTL" show -p MainPID --value "$(svc_sdunit "$1")" 2>/dev/null)"; [ "$pid" = 0 ] && pid=""
  else
    local pf; pf="$LEFI_STATE_DIR/run/$(svc_unit "$1").pid"
    [ -f "$pf" ] && pid="$(cat "$pf")"
  fi
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && echo "$pid"
  return 0
}

svc_running() { [ -n "$(svc_pid "$1")" ]; }

svc_state() {  # running | stopped | failed | disabled
  if svc_running "$1"; then echo running; return; fi
  if [ "$1" = ai ] && [ -f "$AI_KILL_FLAG" ]; then echo disabled; return; fi
  if [ "$LEFI_SERVICE_MODE" = systemd ] && [ "$("$SYSTEMCTL" is-active "$(svc_sdunit "$1")" 2>/dev/null)" = failed ]; then echo failed; return; fi
  echo stopped
}

svc_boot() {  # systemd: enabled at boot? (yes|no|-)
  [ "$LEFI_SERVICE_MODE" = systemd ] || { echo -; return 0; }
  case "$("$SYSTEMCTL" is-enabled "$(svc_sdunit "$1")" 2>/dev/null)" in enabled) echo yes ;; *) echo no ;; esac
}

svc_start() {
  local s="$1" label plist
  svc_installed "$s" || { warn "$s is not installed here — skipped"; return 1; }
  if [ "$s" = ai ] && [ -f "$AI_KILL_FLAG" ]; then
    err "AI is disabled by the kill switch ($(cat "$AI_KILL_FLAG" 2>/dev/null)). Use: lefi ai on"; return 1
  fi
  if is_macos; then
    label="$(svc_label "$s")"; plist="$HOME/Library/LaunchAgents/$label.plist"
    [ -f "$plist" ] || { err "No LaunchAgent for $s ($plist). Run: lefi setup"; return 1; }
    lefi_launchctl enable "gui/$(id -u)/$label" 2>/dev/null
    if lefi_launchctl print "gui/$(id -u)/$label" >/dev/null 2>&1; then
      lefi_launchctl kickstart -k "gui/$(id -u)/$label" >>"$CLI_DETAIL_LOG" 2>&1
    else
      lefi_launchctl bootstrap "gui/$(id -u)" "$plist" >>"$CLI_DETAIL_LOG" 2>&1
    fi
  elif [ "$LEFI_SERVICE_MODE" = systemd ]; then
    local unit; unit="$(svc_sdunit "$s")"
    [ -f "/etc/systemd/system/$unit" ] || { err "No systemd unit $unit. Run: sudo lefi setup"; return 1; }
    # enable: `lefi ai off` disables autostart; starting again restores start at boot.
    lefi_systemctl enable "$unit" >>"$CLI_DETAIL_LOG" 2>&1 \
      || { err "Not allowed to control $unit (sudoers rule /etc/sudoers.d/lefi-crop missing?)"; return 1; }
    lefi_systemctl start "$unit" >>"$CLI_DETAIL_LOG" 2>&1 || { err "systemctl start $unit failed — see: lefi logs $s"; return 1; }
  else
    local spec envs log line; spec="$(svc_spec "$s")"
    [ -f "$spec" ] || { err "No launch spec for $s ($spec). Run: lefi setup"; return 1; }
    log="$(sed -n 's/^LOG=//p' "$spec")"; envs="$(sed -n 's/^ENVS=//p' "$spec")"
    set --
    while IFS= read -r line; do case "$line" in ARG=*) set -- "$@" "${line#ARG=}" ;; esac; done <"$spec"
    start_service "$(svc_unit "$s")" "$log" "$envs" "$@" >/dev/null
  fi
  if wait_for_port "$(svc_port "$s")" 20; then ok "$s started ($(svc_desc "$s"), port $(svc_port "$s"))"
  else warn "$s launched but port $(svc_port "$s") is not open yet — see: lefi logs $s"; fi
}

# svc_stop SERVICE [persist] — persist=1 also disables autostart (at login on macOS, at boot
# with systemd).
svc_stop() {
  local s="$1" persist="$2" pid label
  svc_installed "$s" || return 0
  pid="$(svc_pid "$s")"
  if is_macos; then
    label="$(svc_label "$s")"
    [ "$persist" = 1 ] && lefi_launchctl disable "gui/$(id -u)/$label" 2>/dev/null
    lefi_launchctl bootout "gui/$(id -u)/$label" >>"$CLI_DETAIL_LOG" 2>&1 || true
  elif [ "$LEFI_SERVICE_MODE" = systemd ]; then
    local unit; unit="$(svc_sdunit "$s")"
    [ "$persist" = 1 ] && { lefi_systemctl disable "$unit" >>"$CLI_DETAIL_LOG" 2>&1 || err "Could not disable $unit"; }
    lefi_systemctl stop "$unit" >>"$CLI_DETAIL_LOG" 2>&1 || err "systemctl stop $unit refused (sudoers rule missing?)"
    # systemd stops the whole unit (children included); only a leftover PID is signalled.
    pid="$(svc_pid "$s")"
  fi
  [ -n "$pid" ] && terminate_pid "$pid"
  rm -f "$LEFI_STATE_DIR/run/$(svc_unit "$s").pid"
  if svc_running "$s"; then err "$s is still running"; return 1; fi
  ok "$s stopped"
}

# terminate_pid PID — SIGTERM, wait up to 8 s, then SIGKILL.
terminate_pid() {
  local pid="$1" i=0
  kill -0 "$pid" 2>/dev/null || return 0
  kill -TERM "$pid" 2>/dev/null
  while kill -0 "$pid" 2>/dev/null && [ "$i" -lt 8 ]; do sleep 1; i=$((i + 1)); done
  if kill -0 "$pid" 2>/dev/null; then kill -KILL "$pid" 2>/dev/null; warn "PID $pid did not exit — SIGKILL sent"; fi
  return 0
}

cmd_service() {
  local action="$1" target="$2" s list
  [ -n "$target" ] || die "Usage: lefi $action <$(svc_installed_list | tr '\n' '|')all>"
  if [ "$target" = all ]; then list="$(svc_installed_list)"; else
    svc_unit "$target" >/dev/null || die "Unknown service '$target' (ai, mqtt, brain, admin, all)"
    list="$target"
  fi
  [ -n "$list" ] || die "No services installed on this machine. Run: lefi setup"
  for s in $list; do
    case "$action" in
      start) svc_start "$s" ;;
      stop) svc_stop "$s" ;;
      restart) svc_stop "$s" && svc_start "$s" ;;
    esac
  done
}

# ---------------------------------------------------------------- processes
# A process is classified by its executable (argv[0]) — never by free text in its command
# line — so `grep "ollama runner"` or an editor opening install.sh is never touched.
# Output: PID PPID %CPU RSS_KB ELAPSED KIND COMMAND
lefi_procs() {
  ps -axo pid=,ppid=,pcpu=,rss=,etime=,command= 2>/dev/null | awk -v me="$$" -v sd="$LEFI_STATE_DIR" '
    { pid=$1; if (pid==me) next
      cmd=$0; sub(/^ *[0-9]+ +[0-9]+ +[0-9.]+ +[0-9]+ +[^ ]+ +/, "", cmd)
      b=$6; sub(/.*\//, "", b); a1=$7; k=""
      if (b=="ollama") { if (a1=="serve") k="ai"; else if (a1=="runner") k="ai-runner"; else if (a1=="pull") k="pull" }
      else if (b=="ollama_llama_server") k="ai-runner"
      else if (b=="mosquitto" && index(cmd, "-c " sd)) k="mqtt"
      else if (b=="caddy" && index(cmd, sd)) k="admin"
      else if (b ~ /^(python[0-9.]*|uvicorn|lefi-brain)$/ && cmd ~ /lefi_brain/) k="brain"
      else if (b=="install.sh" || (b ~ /^(bash|sh)$/ && $7 ~ /install\.sh$/)) k="installer"
      else if (b ~ /^python[0-9.]*$/ && cmd ~ /lefi_greenhouse_sim/) k="simulator"
      else if (b ~ /^(python[0-9.]*|uv)$/ && cmd ~ /mh3_genesis|robot-mh3/) k="robot-sim"
      if (k!="") printf "%s %s %s %s %s %s %s\n", pid, $2, $3, $4, $5, k, cmd }'
}

procs_of_kind() { lefi_procs | awk -v k="$1" '$6==k {print $1}'; }

cmd_ps() {
  header "Lefi Crop AI processes"
  local out; out="$(lefi_procs)"
  if [ -z "$out" ]; then info "No Lefi Crop AI processes running."; return 0; fi
  printf '  %-7s %-11s %6s %9s %12s  %s\n' PID KIND CPU% MEM ELAPSED COMMAND
  echo "$out" | while read -r pid _ cpu rss et kind cmd; do
    printf '  %-7s %-11s %6s %9s %12s  %s\n' "$pid" "$kind" "$cpu" "$(human_kb "$rss")" "$et" "$(echo "$cmd" | cut -c1-70)"
  done
  info "Interrupt one: lefi kill <PID|kind>   ·   everything: lefi kill --all"
}

cmd_kill() {
  local target="$1" procs pids pid s
  [ -n "$target" ] || die "Usage: lefi kill <PID|ai|mqtt|brain|admin|runner|pull|installer|simulator|robot> | --all [--yes]"
  procs="$(lefi_procs)"
  case "$target" in
    --all)
      header "Interrupting ALL Lefi Crop AI processes"
      echo "$procs" | awk 'NF{print "  " $1 "  " $6}'
      has_flag --yes "$@" || confirm "Stop every service and process listed above?" n || { info "Cancelled."; return 0; }
      for s in $(svc_installed_list); do svc_stop "$s"; done
      for pid in $(lefi_procs | awk '{print $1}'); do terminate_pid "$pid"; done
      [ -z "$(lefi_procs)" ] && ok "All Lefi Crop AI processes stopped" || warn "Some processes are still alive: lefi ps"
      info "Services stay stopped until: lefi start all"
      ;;
    ai|mqtt|brain|admin)
      # Supervised services are stopped through launchd/systemd, otherwise they would be respawned.
      svc_stop "$target" ;;
    runner|pull|installer|simulator|robot)
      local kind="$target"; [ "$target" = runner ] && kind="ai-runner"; [ "$target" = robot ] && kind="robot-sim"
      pids="$(procs_of_kind "$kind")"
      [ -n "$pids" ] || { info "No '$target' process running."; return 0; }
      for pid in $pids; do terminate_pid "$pid"; ok "Interrupted $target (PID $pid)"; done ;;
    *[!0-9]*) die "Unknown target '$target'. See: lefi ps" ;;
    *)
      echo "$procs" | awk '{print $1}' | grep -qx "$target" \
        || die "PID $target is not a Lefi Crop AI process (refusing). See: lefi ps"
      local kind; kind="$(echo "$procs" | awk -v p="$target" '$1==p {print $6}')"
      case "$kind" in
        ai|mqtt|admin|brain) warn "PID $target is a supervised service; use 'lefi stop $kind' so it is not respawned." ;;
      esac
      terminate_pid "$target"; ok "Interrupted PID $target" ;;
  esac
}

# ---------------------------------------------------------------- resources & status
# Sum CPU/RSS of a PID and its direct children (e.g. ollama serve + its model runner).
pid_tree_usage() {
  ps -axo pid=,ppid=,pcpu=,rss= 2>/dev/null | awk -v p="$1" '$1==p||$2==p {c+=$3; r+=$4} END{printf "%.1f %d\n", c, r}'
}

pid_elapsed() { ps -o etime= -p "$1" 2>/dev/null | tr -d ' '; }

service_table() {  # service_table [with_usage]
  local s state pid cpu rss port usage col
  printf '  %-7s %-9s %-7s %7s %9s %-11s %-6s %-5s %s\n' SERVICE STATE PID CPU% MEM UPTIME PORT BOOT DESCRIPTION
  for s in $(svc_installed_list); do
    state="$(svc_state "$s")"; pid="$(svc_pid "$s")"; port="$(svc_port "$s")"; cpu="-"; rss="-"
    if [ -n "$pid" ]; then usage="$(pid_tree_usage "$pid")"; cpu="${usage% *}"; rss="$(human_kb "${usage#* }")"; fi
    case "$state" in running) col="$C_GREEN" ;; disabled|failed) col="$C_RED" ;; *) col="$C_YELLOW" ;; esac
    printf '  %-7s %s%-9s%s %-7s %7s %9s %-11s %-6s %-5s %s\n' "$s" "$col" "$state" "$C_RESET" "${pid:--}" "$cpu" "$rss" \
      "$( [ -n "$pid" ] && pid_elapsed "$pid" || echo -)" "$port" "$(svc_boot "$s")" "$(svc_desc "$s")"
  done
}

system_load() {
  if is_macos; then
    info "Load avg:   $(sysctl -n vm.loadavg 2>/dev/null | tr -d '{}')"
    have memory_pressure && info "Memory:     $(memory_pressure -Q 2>/dev/null | sed -n 's/.*free percentage: /free /p') of ${RAM_GB} GB"
  else
    info "Load avg:   $(cut -d' ' -f1-3 /proc/loadavg 2>/dev/null)"
    info "Memory:     $(free -m 2>/dev/null | awk '/Mem:/{printf "%d MB used / %d MB", $3, $2}')"
  fi
  info "Disk:       $(df -h "$HOME" 2>/dev/null | awk 'NR==2{print $4 " free of " $2}')"
}

cmd_resources() {
  detect_system >/dev/null 2>&1
  if has_flag --watch "$@"; then
    while :; do clear; header "Resources · $(date +%H:%M:%S) · Ctrl-C to exit"; service_table; echo; system_load; sleep 2; done
  fi
  header "Resources"
  [ -n "$(svc_installed_list)" ] && service_table || info "No services installed here."
  echo; system_load
}

cmd_status() {
  detect_system >/dev/null 2>&1
  lefi_banner "status"
  header "Node"
  info "Host:       $HOST_NAME ($LAN_IP) · $OS $OS_VERSION · ${CHIP:-?} · ${RAM_GB} GB"
  info "Installed: $(installed_summary)"
  info "Services:   $(service_mode_desc)"
  if [ -f "$AI_KILL_FLAG" ]; then
    printf '  %sAI KILL SWITCH ON%s — %s  (re-enable: lefi ai on)\n' "$C_RED" "$C_RESET" "$(cat "$AI_KILL_FLAG")"
  fi
  if [ -n "$(svc_installed_list)" ]; then header "Services"; service_table; fi
  if [ "$HAS_AI" = 1 ] || [ "$HAS_CORE" = 1 ]; then
    header "AI health$( [ "$HAS_AI" != 1 ] && echo " (remote: $(env_get OLLAMA_BASE_URL))")"
    ai_health_collect 0; ai_health_track
    case "$H_STATUS" in OK) ok "AI $H_STATUS" ;; DEGRADED) warn "AI $H_STATUS" ;; *) err "AI $H_STATUS" ;; esac
    printf '%s' "$H_CHECKS" | awk -F'\t' '$2!="OK"{print "    - " $1 ": " $3}'
    [ "$H_STATUS" = OK ] || info "Details: lefi ai health · causes: lefi ai diagnose"
  fi
  header "Recent errors"
  local n; n="$(error_scan_count 500)"
  if [ "$n" -gt 0 ]; then warn "$n error lines in the last 500 lines of each log — run: lefi errors"
  else ok "No errors in recent logs"; fi
  echo
}
