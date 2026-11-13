# shellcheck shell=bash
# Audit trail commands (append-only, hash-chained audit_log in the Brain database).

cmd_audit() {
  require_role BRAIN "The Brain (audit trail)"
  local sub="${1:-tail}"; [ $# -gt 0 ] && shift
  case "$sub" in
    verify) _jhdr "Audit trail · hash chain" "$@"; brain_py audit verify "$@" ;;
    tail|show) parse_n 20 "$@"; header "Audit trail · last $NLINES entries"; brain_py audit tail -n "$NLINES" ;;
    *) die "Unknown: lefi audit $sub (verify, tail [-n N])" ;;
  esac
}
