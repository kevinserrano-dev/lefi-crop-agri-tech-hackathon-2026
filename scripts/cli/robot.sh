# shellcheck shell=bash
# lefi robot … — the simulated MH3 (ADR-091, ADR-090). Lefi Brain turns it on and off through
# Lefi Crop Helper; these commands do the same by hand. Simulation only: no physical robot exists.

cmd_robot() {
  local sub="${1:-status}"; shift 2>/dev/null
  case "$sub" in
    start) robot_start ;;
    stop) robot_stop ;;
    status)
      if [ "${1:-}" = --json ]; then robot_status_json; return 0; fi
      if ! robot_installed; then info "The simulated robot is not installed on this PC."; return 3; fi
      info "Simulated robot ($(robot_conf_get BACKEND)) · port $(robot_port)"
      if robot_running; then
        if robot_answering; then ok "running and answering (pid $(robot_pid))"
        else warn "starting (pid $(robot_pid)): the 3D scene takes 1–2 minutes"; fi
      else info "off"; fi
      info "Log: $(robot_log)" ;;
    *) die "Usage: lefi robot start | stop | status [--json]" ;;
  esac
}
