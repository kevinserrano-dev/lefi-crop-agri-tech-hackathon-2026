# shellcheck shell=bash
# Safe Brain update (ADR-036): the new Brain is prepared NEXT TO the running one, the database is
# backed up, migrated, the service is switched and checked — and on any failure the previous
# Brain and the database copy are put back automatically, so the greenhouse keeps running.
#
#   $LEFI_STATE_DIR/runtime/brain/<version>/venv   one environment per version
#   $LEFI_STATE_DIR/runtime/brain/current          symlink to the version the service runs
#   $LEFI_STATE_DIR/runtime/brain/previous         "<python path>\t<version>\t<db copy>" for rollback
#
# macOS (launchd) and Linux user mode. Linux system installs (systemd) are out of the MVP.

BRAIN_HOME="$LEFI_STATE_DIR/runtime/brain"
BU_DB_COPY=""; BU_OLD_PY=""; BU_OLD_VER=""; BU_NEW_VER=""; BU_PORT=""; BU_SWITCHED=0; BU_MIGRATED=0

brain_spec_python() { sed -n 's/^ARG=//p' "$LEFI_STATE_DIR/services/brain.svc" 2>/dev/null | head -n1; }

py_brain_version() {  # py_brain_version PYTHON
  "$1" -c 'import lefi_brain, sys; sys.stdout.write(lefi_brain.__version__)' 2>/dev/null
}

brain_health_version() {  # the running Brain's version, or empty
  curl -fsS -m 3 "http://127.0.0.1:$BU_PORT/api/v1/health" 2>/dev/null \
    | sed -n 's/.*"version":[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1
}

brain_blockers() {  # reasons the Brain gives not to update now (one per line), from /status
  curl -fsS -m 3 "http://127.0.0.1:$BU_PORT/api/v1/status" 2>/dev/null \
    | python3 -I -c 'import json,sys
try: print("\n".join(str(b) for b in json.load(sys.stdin).get("update_blockers", [])))
except Exception: pass' 2>/dev/null
}

brain_stop() {
  if [ "$LEFI_SERVICE_MODE" = launchd ]; then
    lefi_launchctl bootout "gui/$(id -u)/com.lefi-crop.brain" >>"$LOG_FILE" 2>&1 || true
  else
    local pf="$LEFI_STATE_DIR/run/brain.pid"
    [ -f "$pf" ] && kill "$(cat "$pf")" 2>/dev/null
  fi
  local i=0
  while [ "$i" -lt 20 ] && port_listening "$BU_PORT"; do sleep 0.5; i=$((i + 1)); done
}

brain_start_with() {  # brain_start_with PYTHON
  start_service brain "$LOG_DIR/brain.log" "LEFI_ENV_FILE=$ENV_FILE LEFI_STATE_DIR=$LEFI_STATE_DIR" \
    "$1" -m lefi_brain serve >>"$LOG_FILE" 2>&1
}

brain_wait_version() {  # brain_wait_version VERSION SECONDS -> 0 when the Brain answers with it
  local i=0 v
  while [ "$i" -lt "$2" ]; do
    v="$(brain_health_version)"; [ "$v" = "$1" ] && return 0
    sleep 1; i=$((i + 1))
  done
  return 1
}

# Puts the previous Brain and its database back. Never leaves the greenhouse without a Brain
# silently: if even the old version does not answer, it says so loudly.
brain_update_rollback() {
  local why="$1"
  warn "Lefi Brain update failed: $why — returning to $BU_OLD_VER"
  ev_log warn "Returning to the previous Lefi Brain $BU_OLD_VER"
  brain_stop
  if [ "$BU_MIGRATED" = 1 ] && [ -n "$BU_DB_COPY" ] && [ -f "$BU_DB_COPY" ]; then
    local db="$LEFI_STATE_DIR/data/lefi.db"
    rm -f "$db-wal" "$db-shm"; cp -p "$BU_DB_COPY" "$db" && ok "Database restored from $BU_DB_COPY"
  fi
  if [ "$BU_SWITCHED" = 1 ] && [ -n "$BU_OLD_VER" ] && [ -d "$BRAIN_HOME/$BU_OLD_VER" ]; then
    ln -sfn "$BU_OLD_VER" "$BRAIN_HOME/current"
  fi
  brain_start_with "$BU_OLD_PY"
  if brain_wait_version "$BU_OLD_VER" 40; then
    ok "The previous Lefi Brain $BU_OLD_VER is running again; nothing else changed."
    DIE_CODE=BRAIN_UPDATE_ROLLED_BACK; DIE_HINT="See $LOG_FILE. The new version stays installed next to the current one for diagnosis."
    die "Lefi Brain could not be updated to $BU_NEW_VER ($why); $BU_OLD_VER is running again."
  fi
  DIE_CODE=BRAIN_DOWN; DIE_HINT="Run: lefi brain check · lefi logs brain"
  die "Lefi Brain could not be updated ($why) and the previous version did not start either."
}

# A newer Lefi Brain may listen to MQTT topics the installed broker ACL does not allow yet (board
# enrolment, events, logs: ADR-058..060). The ACL travels with this installer: render it, and only if
# it changed, swap it in and ask Mosquitto to re-read it (SIGHUP through the service manager, never by
# searching processes by name). Never fails the update: the new Lefi Brain is already running.
mqtt_acl_refresh() {
  local acl="$LEFI_STATE_DIR/mosquitto/acl" new pf pid
  [ -f "$acl" ] || return 0
  new="$acl.new"
  render "$LEFI_ROOT/deploy/mosquitto/acl.template" "$new" "STATE_DIR=$LEFI_STATE_DIR"
  [ -f "$new" ] || return 0
  if cmp -s "$new" "$acl"; then rm -f "$new"; ok "Mosquitto ACL already up to date"; return 0; fi
  chmod 600 "$new" && mv -f "$new" "$acl"
  if [ "$LEFI_SERVICE_MODE" = launchd ]; then
    if lefi_launchctl kill SIGHUP "gui/$(id -u)/com.lefi-crop.mosquitto" >>"$LOG_FILE" 2>&1; then
      ok "Mosquitto ACL updated (new board topics allowed)"; return 0
    fi
  else
    pf="$LEFI_STATE_DIR/run/mosquitto.pid"
    pid="$(cat "$pf" 2>/dev/null || true)"
    if [ -n "$pid" ] && [ "$(ps -p "$pid" -o comm= 2>/dev/null | sed 's#.*/##')" = mosquitto ] \
      && kill -HUP "$pid" 2>/dev/null; then
      ok "Mosquitto ACL updated (new board topics allowed)"; return 0
    fi
  fi
  warn "Mosquitto ACL updated, but Mosquitto could not be asked to re-read it: run 'lefi restart mqtt'."
}

brain_update_main() {
  local new_py new_dir py_ok
  plan_add brain.check "Check the running Lefi Brain and the new version"
  plan_add brain.build "Prepare the new Lefi Brain next to the current one"
  plan_add brain.backup "Back up the database"
  plan_add brain.switch "Stop, migrate and switch to the new Lefi Brain"
  plan_add brain.verify "Start the new Lefi Brain and check it"
  plan_start update-brain

  step_begin brain.check
  [ "$LEFI_SERVICE_MODE" = systemd ] && { DIE_CODE=UNSUPPORTED_OS; die "Lefi Brain updates for Linux system installs are not part of this version."; }
  case ",$(env_get LEFI_ROLES)," in *,core,*) ;; *) DIE_CODE=NO_BRAIN; die "Lefi Brain (core role) is not installed on this PC." ;; esac
  BU_PORT="$(env_get LEFI_API_PORT)"; BU_PORT="${BU_PORT:-8000}"
  BU_OLD_PY="$(brain_spec_python)"
  [ -x "$BU_OLD_PY" ] || { DIE_CODE=NO_BRAIN; die "No installed Lefi Brain found ($LEFI_STATE_DIR/services/brain.svc)."; }
  BU_OLD_VER="$(brain_health_version)"
  [ -n "$BU_OLD_VER" ] || BU_OLD_VER="$(py_brain_version "$BU_OLD_PY")"
  BU_NEW_VER="$(sed -n 's/^version = "\(.*\)"/\1/p' "$BRAIN_DIR/pyproject.toml" | head -n1)"
  info "Running Lefi Brain: ${BU_OLD_VER:-unknown} · this installer carries: ${BU_NEW_VER:-unknown}"
  [ -n "$BU_NEW_VER" ] || die "Cannot read the new Lefi Brain's version ($BRAIN_DIR/pyproject.toml)."
  if [ "$BU_OLD_VER" = "$BU_NEW_VER" ]; then
    ok "Lefi Brain is already at $BU_NEW_VER; nothing to do."
    step_skip brain.build "already up to date"; step_skip brain.backup "already up to date"
    step_skip brain.switch "already up to date"; step_skip brain.verify "already up to date"
    plan_done ok; exit 0
  fi
  local blockers; blockers="$(brain_blockers)"
  if [ -n "$blockers" ]; then
    DIE_CODE=UPDATE_BLOCKED; DIE_HINT="Try again when Lefi Brain no longer reports: $(printf '%s' "$blockers" | tr '\n' ';')"
    die "Lefi Brain asks not to be updated right now."
  fi

  step_begin brain.build
  new_dir="$BRAIN_HOME/$BU_NEW_VER"; new_py="$new_dir/venv/bin/python"
  rm -rf "$new_dir"; mkdir -p "$new_dir"
  # The running Brain is not touched: a separate environment from the bundled sources.
  if ! env UV_PROJECT_ENVIRONMENT="$new_dir/venv" uv sync --project "$BRAIN_DIR" --python 3.12 --locked --no-dev --no-editable --reinstall-package lefi-brain >>"$LOG_FILE" 2>&1; then
    rm -rf "$new_dir"; die "the new Lefi Brain could not be prepared (uv sync, see $LOG_FILE); the running Lefi Brain was not touched."
  fi
  py_ok="$(py_brain_version "$new_py")"
  [ "$py_ok" = "$BU_NEW_VER" ] || { rm -rf "$new_dir"; die "The prepared Lefi Brain reports version '${py_ok:-none}', expected $BU_NEW_VER; the running Lefi Brain was not touched."; }
  ok "Lefi Brain $BU_NEW_VER prepared in $new_dir"
  # The running version gets its own entry too, so a switch back is always possible.
  if [ -n "$BU_OLD_VER" ] && [ ! -e "$BRAIN_HOME/$BU_OLD_VER" ]; then
    mkdir -p "$BRAIN_HOME/$BU_OLD_VER"; ln -s "$(cd "$(dirname "$BU_OLD_PY")/.." && pwd)" "$BRAIN_HOME/$BU_OLD_VER/venv"
  fi

  step_begin brain.backup
  BU_DB_COPY="$(as_service_user env LEFI_ENV_FILE="$ENV_FILE" LEFI_STATE_DIR="$LEFI_STATE_DIR" "$BU_OLD_PY" -m lefi_brain db backup 2>>"$LOG_FILE" | tail -n1)"
  if [ ! -f "$BU_DB_COPY" ]; then
    rm -rf "$new_dir"; die "The database could not be backed up; the update stopped before changing anything."
  fi
  ok "Database copy: $BU_DB_COPY"

  step_begin brain.switch
  brain_stop
  if ! as_service_user env LEFI_ENV_FILE="$ENV_FILE" LEFI_STATE_DIR="$LEFI_STATE_DIR" "$new_py" -m lefi_brain db migrate >>"$LOG_FILE" 2>&1; then
    BU_MIGRATED=1; brain_update_rollback "the database migration failed"
  fi
  BU_MIGRATED=1
  ln -sfn "$BU_NEW_VER" "$BRAIN_HOME/current"; BU_SWITCHED=1
  ok "Switched to Lefi Brain $BU_NEW_VER"

  step_begin brain.verify
  brain_start_with "$BRAIN_HOME/current/venv/bin/python"
  brain_wait_version "$BU_NEW_VER" 40 || brain_update_rollback "the new Lefi Brain did not answer its health check"
  printf '%s\t%s\t%s\n' "$BU_OLD_PY" "$BU_OLD_VER" "$BU_DB_COPY" >"$BRAIN_HOME/previous"
  record_component lefi-brain "$BU_NEW_VER" "Lefi Crop Helper payload (update from $BU_OLD_VER)"
  # Keep the current and the previous version; older ones are removed.
  local d
  for d in "$BRAIN_HOME"/*/; do
    d="${d%/}"; d="${d##*/}"
    case "$d" in "$BU_NEW_VER"|"$BU_OLD_VER"|current) ;; *) rm -rf "${BRAIN_HOME:?}/$d" ;; esac
  done
  ok "Lefi Brain $BU_NEW_VER is running and answers its health check (previous: $BU_OLD_VER, kept)"
  mqtt_acl_refresh
  step_ok
  plan_done ok
  exit 0
}
