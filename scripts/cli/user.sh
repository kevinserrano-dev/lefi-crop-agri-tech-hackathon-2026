# shellcheck shell=bash
# Users, roles and sessions of the Brain (identity module). Changes are written to the Brain
# database by `python -m lefi_brain user …` and recorded in the audit trail as cli:<you>.

cmd_user() {
  require_role BRAIN "The Brain (users)"
  local sub="${1:-list}"; [ $# -gt 0 ] && shift
  case "$sub" in
    list|ls) _jhdr "Users" "$@"; brain_py user list "$@" ;;
    add) user_with_password add "$@" ;;
    reset-password|passwd) user_with_password reset-password "$@" ;;
    role|disable|enable|sessions|revoke-sessions)
      [ -n "$1" ] || die "Usage: lefi user $sub <username>$([ "$sub" = role ] && echo ' <role>')"
      brain_py user "$sub" "$@" ;;
    *) die "Unknown: lefi user $sub (list, add, role, disable, enable, reset-password, sessions, revoke-sessions)" ;;
  esac
}

# add / reset-password: on a terminal, ask for the password twice (never on the command line);
# from a pipe, the first stdin line is the password; with --generate (or an empty stdin) the Brain
# generates a temporary one and shows it once.
user_with_password() {
  local action="$1"; shift
  [ -n "$1" ] || die "Usage: lefi user $action <username>$([ "$action" = add ] && echo ' --role <role> [--name "Full name"] [--email x]') [--generate]"
  local a generate=0
  for a in "$@"; do [ "$a" = --generate ] && generate=1; done
  if [ "$generate" = 0 ] && [ -t 0 ] && [ "$ASSUME_YES" != 1 ] && ! has_flag --json "$@"; then
    local p1 p2
    while :; do
      ask_secret "New password for $1 (min 10 chars, empty = generate one)"; p1="$REPLY"
      [ -z "$p1" ] && break
      ask_secret "Repeat password"; p2="$REPLY"
      [ "$p1" = "$p2" ] && break
      warn "Passwords differ — try again."
    done
    if [ -n "$p1" ]; then
      set -- "$@" --password-stdin
      _user_run "$action" "$@" <<EOF2
$p1
EOF2
      return
    fi
  fi
  # Not a terminal (script / pipe): read the password from stdin; an empty stdin generates one.
  if [ "$generate" = 0 ] && [ ! -t 0 ]; then set -- "$@" --password-stdin; fi
  _user_run "$action" "$@"
}

# Drops --generate (a bash-only flag) before calling the Brain.
_user_run() {
  local action="$1"; shift
  local out=() a
  for a in "$@"; do [ "$a" = --generate ] || out+=("$a"); done
  brain_py user "$action" "${out[@]}"
}

cmd_roles() {
  require_role BRAIN "The Brain (roles)"
  _jhdr "Roles and permissions" "$@"
  brain_py roles "$@"
}

# Lefi Desktop devices (ADR-048): one-time pairing codes, the list, revocation. Same Brain CLI as users.
cmd_pair() {
  require_role BRAIN "The Brain (Lefi Desktop pairing)"
  local sub="${1:-list}"; [ $# -gt 0 ] && shift
  case "$sub" in
    new) brain_py pair new "$@" ;;
    list|ls) _jhdr "Paired Lefi Desktop PCs" "$@"; brain_py pair list "$@" ;;
    revoke)
      [ -n "$1" ] || die "Usage: lefi pair revoke <device-id> [--reason TEXT]"
      brain_py pair revoke "$@" ;;
    ca) brain_py ca status "$@" ;;
    ca-request|ca-install) cmd_pair_ca_internal "$sub" "$@" ;;
    *) die "Unknown: lefi pair $sub (new, list, revoke, ca)" ;;
  esac
}

# Used by Lefi Crop Helper's service on the main PC to sign the issuing CA with the LEFI root (ADR-050).
cmd_pair_ca_internal() {
  case "$1" in
    ca-request) brain_py ca request ;;
    ca-install) shift; brain_py ca install "$@" ;;
  esac
}
