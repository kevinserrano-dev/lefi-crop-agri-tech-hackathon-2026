# shellcheck shell=bash
# Removes a component from this PC on request (ADR-040), whoever installed it: an undo (ADR-032)
# only covers a run with a journal. Only what Lefi Crop itself put there goes away; Ollama and the
# downloaded models stay, because other programs may use them and a model takes hours to download.

remove_role_main() {  # remove_role_main ROLE
  local role="$1"
  LEFI_ROLES="$role"
  case "$role" in
    ai)
      plan_add remove.service "Stop the AI service"
      plan_add remove.files "Remove the AI service files"
      plan_start remove
      remove_ai
      ;;
    desktop)
      plan_add remove.app "Remove Lefi Desktop"
      plan_start remove
      remove_desktop
      ;;
    robot)
      plan_add remove.service "Stop the simulated robot"
      plan_add remove.files "Remove the simulated robot's files"
      plan_start remove
      remove_robot
      ;;
    *)
      plan_add remove.check "Check the component"
      plan_start remove
      step_begin remove.check
      DIE_CODE=REMOVE_UNSUPPORTED
      DIE_HINT="Only the AI node, Lefi Desktop and the simulated robot can be removed from here for now."
      die "The component '$role' cannot be removed automatically."
      ;;
  esac
  remove_from_roles "$role"
  step_ok
  plan_done ok
  exit 0
}

remove_ai() {
  local label=com.lefi-crop.ollama plist="$HOME/Library/LaunchAgents/com.lefi-crop.ollama.plist"
  step_begin remove.service
  if [ -f "$plist" ]; then
    if ! lefi_launchd_ready; then
      DIE_CODE=NO_USER_SESSION
      DIE_HINT="Log in on this Mac (the service runs in the user's session) and try again. Nothing was changed."
      die "Cannot stop services on this Mac: nobody is logged in, or the session helper is not running."
    fi
    lefi_launchctl bootout "gui/$(id -u)/$label" >>"$LOG_FILE" 2>&1 || true
    ok "AI service stopped"
  else
    info "No Lefi Crop AI service on this PC"
  fi
  step_begin remove.files
  rm -f "$plist" "$LEFI_STATE_DIR/services/ollama.svc"
  ok "AI service files removed"
  warn "Ollama and its downloaded models stay on this PC (other programs may use them)."
}

remove_robot() {  # ADR-090: its service, its settings and the downloaded starter (several GB)
  step_begin remove.service
  if is_macos && [ -f "$(robot_plist)" ] && ! lefi_launchd_ready; then
    DIE_CODE=NO_USER_SESSION
    DIE_HINT="Log in on this Mac (the service runs in the user's session) and try again. Nothing was changed."
    die "Cannot stop services on this Mac: nobody is logged in, or the session helper is not running."
  fi
  robot_stop >/dev/null
  step_begin remove.files
  rm -f "$(robot_plist)" "$ROBOT_CONF" "$ROBOT_PIDFILE"
  rm -rf "$(robot_starter)" "$ROBOT_STARTER" "$ROBOT_STARTER_OLD" "$ROBOT_HOME/.venv"
  ok "Simulated robot removed (the starter download is gone too)"
}

remove_desktop() {
  local dir app removed=0
  step_begin remove.app
  for dir in "${LEFI_DESKTOP_DIR:-/Applications}" "$HOME/Applications"; do
    app="$dir/$DESKTOP_APP_NAME"
    [ -d "$app/Contents" ] || continue
    rm -rf "$app" || die "Could not remove $app."
    ok "Removed $app"
    removed=1
  done
  [ "$removed" = 1 ] || info "Lefi Desktop was not installed here"
}

remove_from_roles() {  # the component is no longer one of this PC's roles
  local kept
  [ -f "$ENV_FILE" ] || return 0
  kept="$(env_get LEFI_ROLES | tr ',' '\n' | grep -vx "$1" | paste -sd, -)"
  env_set LEFI_ROLES "$kept"
}

# --uninstall-everything (ADR-043): this PC back to before Lefi Crop, its database included. The app
# asks for the administrator's password first. Runs every install journal, newest first, so packages
# and files are removed only if a Lefi Crop run added them; then removes what is left of Lefi Crop.
uninstall_everything_main() {
  local j list p label
  # Log outside the folder this deletes. Nothing is recorded inside it any more.
  LOG_FILE="$(mktemp "${TMPDIR:-/tmp}/lefi-uninstall-XXXXXX")"; EVENTS_FILE=""
  export LOG_FILE
  LEFI_ROLES=""
  case "$LEFI_STATE_DIR" in
    ''|/|"$HOME"|"$HOME/") DIE_CODE=UNSAFE_PATH; die "Refusing to delete the folder $LEFI_STATE_DIR." ;;
  esac
  lefi_banner "uninstall"
  plan_add uninstall.services "Stop the Lefi Crop services"
  plan_add uninstall.undo "Remove what the installations added"
  plan_add uninstall.apps "Remove Lefi Desktop and the lefi command"
  plan_add uninstall.data "Delete the configuration, passwords and database"
  plan_start uninstall

  step_begin uninstall.services
  # The session is needed only to stop services; a PC with none (an erased node) needs none.
  local need_session=0
  for p in "$HOME"/Library/LaunchAgents/com.lefi-crop.*.plist; do
    [ -f "$p" ] || continue
    case "$(basename "$p")" in com.lefi-crop.helperd-*) ;; *) need_session=1 ;; esac
  done
  if [ "$need_session" = 1 ] && ! lefi_launchd_ready; then
    DIE_CODE=NO_USER_SESSION
    DIE_HINT="Log in on this Mac and try again. Nothing was changed."
    die "Cannot stop services on this Mac: nobody is logged in, or the session helper is not running."
  fi
  for p in "$HOME"/Library/LaunchAgents/com.lefi-crop.*.plist; do
    [ -f "$p" ] || continue
    label="$(basename "$p" .plist)"
    case "$label" in com.lefi-crop.helperd-*) continue ;; esac   # the app stops its own service
    lefi_launchctl bootout "gui/$(id -u)/$label" >>"$LOG_FILE" 2>&1 || true
    rm -f "$p"
    ok "Stopped $label"
  done

  step_begin uninstall.undo
  list="$(ls -1 "$(journal_dir)"/run-*.tsv 2>/dev/null | sort -r)"
  while IFS= read -r j; do
    [ -n "$j" ] && [ -f "$j" ] || continue
    [ -e "$j.rolledback" ] && continue
    rollback_run "$j" uninstall || warn "Some changes of $(basename "$j") could not be undone."
  done <<EOF2
$list
EOF2

  step_begin uninstall.apps
  remove_desktop
  for p in /opt/homebrew/bin/lefi /usr/local/bin/lefi "$HOME/.local/bin/lefi"; do
    if [ -L "$p" ]; then
      case "$(readlink "$p")" in */bin/lefi) rm -f "$p" && ok "Removed $p" ;; esac
    fi
  done

  step_begin uninstall.data
  [ -d "$LEFI_STATE_DIR" ] && rm -rf "$LEFI_STATE_DIR"
  [ "$LEFI_PACKAGED" = 1 ] || warn "Development checkout: $ENV_FILE was left in place."
  # Caddy's private certificate authority, unless Caddy is still on this PC for something else.
  have caddy || rm -rf "$HOME/Library/Application Support/Caddy"
  ok "Configuration, passwords and database deleted"
  warn "Homebrew stays on this PC, and any tool that was there before Lefi Crop."
  step_ok
  plan_done ok
  exit 0
}
