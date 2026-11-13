# shellcheck shell=bash
# lefi hw — hardware scan and model recommendation (INSTALLER.md §7, ADR-028).
#   lefi hw            human summary + which supported model this PC can run
#   lefi hw --json     one JSON object (schema lefi.hw.v1, with "recommendation")
# Exit code: 0 = this PC can run the AI role (fit gpu), 1 = fit unknown (verified after
# install), 2 = it cannot (CPU only / not enough GPU memory). Read-only: changes nothing.

cmd_hw() {
  case "${1:-}" in ''|--json) ;; *) die "Usage: lefi hw [--json]" ;; esac
  hw_scan
  recommend_models
  if [ "${1:-}" = --json ]; then
    hw_json "$(recommend_json)"
  else
    hw_print
    recommend_print
    [ "$REC_VERDICT" = not_viable ] && info "This PC can still be a core node if an AI node with a supported GPU exists on the LAN."
  fi
  case "$REC_VERDICT" in ok) return 0 ;; unknown) return 1 ;; *) return 2 ;; esac
}
