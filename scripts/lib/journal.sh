# shellcheck shell=bash
# Install journal, cancel and rollback (ADR-032). bash 3.2 compatible.
#
# Every real install run writes $LEFI_STATE_DIR/install/journal/run-<stamp>.tsv: one line per
# change, recorded BEFORE the change is made, so a run interrupted at any point can be undone.
# Rollback replays the journal in reverse. It only undoes what this run created or changed:
# anything that existed before (Homebrew, a package, an Ollama model, a user file) is either
# left alone or restored from the copy taken before it was modified.
#
# Entry types (TAB-separated):
#   dir_created PATH              rm -rf PATH (guarded)
#   file_created PATH             rm -f PATH
#   file_backup PATH COPY         restore COPY over PATH
#   link_backup PATH TARGET       recreate the symlink PATH -> TARGET
#   tree_backup PATH COPY         replace the directory PATH with COPY
#   pkgs_added MGR PKG...         brew uninstall / apt-get remove / dnf remove (only packages
#                                 that were absent before this run, dependencies included)
#   svc_stop KIND NAME            launchd bootout / systemctl disable --now / kill the pid
#   svc_reload KIND NAME FILE     after FILE is restored: load the previous service again
#   vendor_disabled UNIT          systemctl enable --now UNIT (a service we stopped)
#   foreign_ollama_app            open -a Ollama (macOS desktop app we quit)
#   foreign_brew_service NAME     brew services start NAME
#   user_created NAME             userdel NAME (and its group)
#   model_pulled TAG              ollama rm TAG — only when the same run also wrote
#   model_ready TAG ID            (the download finished) and the installed model still has that
#                                 ID; anything else is never deleted
#   uv_python VERSION             uv python uninstall VERSION
#   copr_enabled REPO             dnf copr remove REPO
#   ollama_script                 the documented removal of Ollama's official Linux installer
#   db_backup DB COPY             restore the database copy taken before migrating
#   manual NOTE                   cannot be undone automatically; reported to the user

JOURNAL_FILE=""; JOURNAL_BAK=""; JOURNAL_SEEN=$'\n'
CANCEL_FILE="${CANCEL_FILE:-}"
journal_dir() { echo "$LEFI_STATE_DIR/install/journal"; }
journal_on() { [ -n "$JOURNAL_FILE" ] && [ "$DRY_RUN" != 1 ]; }

# install_lock — one installer at a time on this PC. Lefi Crop Helper may be reopened while the run
# it started is still working, and two runs would undo each other's journal entries.
install_lock() {
  local f other try
  mkdir -p "$LEFI_STATE_DIR/install" 2>/dev/null
  f="$LEFI_STATE_DIR/install/installer.pid"
  for try in 1 2; do
    if ( set -C; printf '%s\n' "$$" >"$f" ) 2>/dev/null; then return 0; fi
    other="$(cat "$f" 2>/dev/null)"
    [ "$other" = "$$" ] && return 0
    case "$(ps -p "${other:-0}" -o command= 2>/dev/null)" in
      *install.sh*)
        DIE_CODE=INSTALL_RUNNING; DIE_HINT="Wait for it to end, then try again."
        die "Another Lefi Crop installation is running on this PC (process $other)." ;;
    esac
    rm -f "$f"   # left by a run that ended
  done
  die "Could not take the installer lock $f."
}

# journal_init STAMP — once per real install run, after log_init.
journal_init() {
  [ "$DRY_RUN" = 1 ] && return 0
  local d; d="$(journal_dir)"
  mkdir -p "$d" 2>/dev/null || { warn "Install journal unavailable ($d): rollback will not be possible"; return 0; }
  chmod 700 "$d" 2>/dev/null
  JOURNAL_FILE="$d/run-$1.tsv"; JOURNAL_BAK="$d/run-$1.bak"
  printf '# lefi install journal v1\t%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$LEFI_SERVICE_MODE" >"$JOURNAL_FILE"
  chmod 600 "$JOURNAL_FILE"
}

j_add() {
  journal_on || return 0
  local IFS=$'\t'
  printf '%s\n' "$*" >>"$JOURNAL_FILE"
  _log "JOURNAL $*"
}

# j_seen KEY — true when KEY was already recorded in this run (first call records it).
j_seen() {
  case "$JOURNAL_SEEN" in *$'\n'"$1"$'\n'*) return 0 ;; esac
  JOURNAL_SEEN="$JOURNAL_SEEN$1"$'\n'
  return 1
}

# j_mkdir PATH — before creating PATH: records every missing directory, outermost first.
j_mkdir() {
  journal_on || return 0
  local p="$1" missing="" d
  while [ -n "$p" ] && [ "$p" != / ] && [ "$p" != . ] && [ ! -e "$p" ]; do
    missing="$p"$'\n'"$missing"; p="$(dirname "$p")"
  done
  local IFS=$'\n'
  for d in $missing; do j_seen "dir:$d" || j_add dir_created "$d"; done
}

_j_copy_name() { printf '%s' "$1" | tr '/' '%'; }

# j_file PATH — before creating, overwriting or deleting the file PATH.
j_file() {
  journal_on || return 0
  j_seen "file:$1" && return 0
  j_mkdir "$(dirname "$1")"
  if [ -L "$1" ]; then
    j_add link_backup "$1" "$(readlink "$1")"
  elif [ -e "$1" ]; then
    mkdir -p "$JOURNAL_BAK" && chmod 700 "$JOURNAL_BAK"
    local copy; copy="$JOURNAL_BAK/$(_j_copy_name "$1")"
    if cp -p "$1" "$copy" 2>/dev/null; then j_add file_backup "$1" "$copy"
    else j_add manual "Could not keep a copy of $1 before changing it; it cannot be restored automatically"; fi
  else
    j_add file_created "$1"
  fi
}

# j_tree DIR — before replacing or modifying a whole directory in place.
j_tree() {
  journal_on || return 0
  j_seen "tree:$1" && return 0
  if [ -d "$1" ]; then
    mkdir -p "$JOURNAL_BAK" && chmod 700 "$JOURNAL_BAK"
    local copy; copy="$JOURNAL_BAK/$(_j_copy_name "$1")"
    if cp -Rp "$1" "$copy" 2>/dev/null; then j_add tree_backup "$1" "$copy"
    else j_add manual "Could not keep a copy of $1 before changing it; it cannot be restored automatically"; fi
  else
    j_mkdir "$1"
  fi
}

# Installed-package snapshots: what a package-manager call added = after − before.
pkg_snapshot() {
  if is_macos; then have brew && brew list --formula -1 2>/dev/null
  else
    case "$(linux_pkg_family)" in
      apt) dpkg-query -W -f='${Status} ${Package}\n' 2>/dev/null | awk '$3=="installed"{print $4}' ;;
      dnf) rpm -qa --qf '%{NAME}\n' 2>/dev/null ;;
    esac
  fi | sort -u
}
PKG_BEFORE=""
j_pkg_begin() { journal_on || return 0; PKG_BEFORE="$(mktemp)"; pkg_snapshot >"$PKG_BEFORE"; }
j_pkg_end() {  # j_pkg_end MGR — records the packages that appeared since j_pkg_begin
  journal_on || return 0
  [ -n "$PKG_BEFORE" ] && [ -f "$PKG_BEFORE" ] || return 0
  local mgr="$1" after new; after="$(mktemp)"; pkg_snapshot >"$after"
  new="$(comm -13 "$PKG_BEFORE" "$after" | tr '\n' ' ')"
  rm -f "$PKG_BEFORE" "$after"; PKG_BEFORE=""
  # shellcheck disable=SC2086
  set -- $new
  [ $# -gt 0 ] || return 0
  j_add pkgs_added "$mgr" "$@"
}

# ---------------------------------------------------------------- cancel
# The GUI (or a technician) creates CANCEL_FILE; the installer stops at the next safe point
# (start of a step, or during the model download) and rolls back what this run changed.
cancel_requested() { [ -n "$CANCEL_FILE" ] && [ -e "$CANCEL_FILE" ]; }

check_cancel() {
  cancel_requested || return 0
  [ "${CANCEL_HANDLING:-0}" = 1 ] && return 0
  CANCEL_HANDLING=1
  warn "Cancel requested — stopping here and undoing what this run changed."
  [ -n "$EV_STEP" ] && ev_emit step.failed "$(_evstep),\"code\":\"CANCELLED\",\"message\":\"Cancelled by the user\",\"hint\":\"\""
  EV_STEP=""
  local rc=0
  rollback_run "$JOURNAL_FILE" cancelled || rc=$?
  plan_done cancelled "\"rollback\":{\"result\":\"$RB_RESULT\",\"ok\":$RB_OK,\"failed\":$RB_FAILED,\"skipped\":$RB_SKIPPED,\"report\":$(_evq "$RB_REPORT")}"
  trap - EXIT
  exit 130
}

# ---------------------------------------------------------------- rollback
RB_OK=0; RB_FAILED=0; RB_SKIPPED=0; RB_RESULT=""; RB_REPORT=""; UNDO_MSG=""

# Never rm -rf a system or home directory, whatever a journal says.
rb_safe_dir() {
  case "$1" in
    ''|/|/*/..*|*/../*) return 1 ;;
    /usr|/usr/*bin|/usr/local|/usr/local/lib|/usr/share|/etc|/opt|/var|/var/lib|/home|/Users|/tmp|/private/*|/System*|/Library|/Applications) return 1 ;;
    "$HOME"|"$HOME/Library"|"$HOME/Library/LaunchAgents"|"$HOME/.local"|"$HOME/.local/bin"|"$HOME/.local/share") return 1 ;;
    /*/*) return 0 ;;
    *) return 1 ;;
  esac
}

rb_systemctl() { "$SYSTEMCTL" "$@" >>"$RB_LOG" 2>&1; }

# undo_one TYPE ARGS... -> 0 done · 1 failed · 2 skipped (UNDO_MSG explains)
undo_one() {
  local t="$1"; shift; UNDO_MSG=""
  case "$t" in
    dir_created)
      [ -e "$1" ] || { UNDO_MSG="already gone"; return 2; }
      if ! rb_safe_dir "$1"; then   # a shared folder (e.g. ~/.local/bin): only if it is empty
        rmdir "$1" 2>/dev/null && return 0
        UNDO_MSG="kept: shared folder that now holds other files"; return 2
      fi
      rm -rf "$1" 2>>"$RB_LOG" ;;
    file_created)
      { [ -e "$1" ] || [ -L "$1" ]; } || { UNDO_MSG="already gone"; return 2; }
      rm -f "$1" 2>>"$RB_LOG" ;;
    file_backup)
      [ -f "$2" ] || { UNDO_MSG="the saved copy is missing"; return 1; }
      mkdir -p "$(dirname "$1")" && cp -p "$2" "$1" 2>>"$RB_LOG" ;;
    link_backup)
      mkdir -p "$(dirname "$1")" && ln -sfn "$2" "$1" 2>>"$RB_LOG" ;;
    tree_backup)
      [ -d "$2" ] || { UNDO_MSG="the saved copy is missing"; return 1; }
      rb_safe_dir "$1" || { UNDO_MSG="refused to replace a protected directory"; return 1; }
      rm -rf "$1" && cp -Rp "$2" "$1" 2>>"$RB_LOG" ;;
    pkgs_added)
      local mgr="$1"; shift
      case "$mgr" in
        brew) have brew || { UNDO_MSG="brew not found"; return 1; }; brew uninstall --formula "$@" >>"$RB_LOG" 2>&1 ;;
        apt) env DEBIAN_FRONTEND=noninteractive apt-get remove -y -q "$@" >>"$RB_LOG" 2>&1 ;;
        dnf) dnf remove -y -q --noautoremove "$@" >>"$RB_LOG" 2>&1 ;;
        *) UNDO_MSG="unknown package manager $mgr"; return 1 ;;
      esac ;;
    svc_stop)
      case "$1" in
        launchd) lefi_launchctl bootout "gui/$(id -u)/$2" >>"$RB_LOG" 2>&1 || UNDO_MSG="was not loaded" ;;
        systemd) rb_systemctl disable --now "$2" || UNDO_MSG="was not active" ;;
        pid) [ -f "$2" ] && kill "$(cat "$2")" 2>/dev/null || UNDO_MSG="process already stopped" ;;
      esac
      return 0 ;;
    svc_reload)
      case "$1" in
        launchd) [ -f "$3" ] || { UNDO_MSG="no previous service"; return 2; }
          lefi_launchctl bootstrap "gui/$(id -u)" "$3" >>"$RB_LOG" 2>&1 ;;
        systemd) rb_systemctl daemon-reload
          [ -f "$3" ] || { UNDO_MSG="no previous service"; return 2; }
          rb_systemctl enable --now "$2" ;;
        *) return 2 ;;
      esac ;;
    vendor_disabled) rb_systemctl enable --now "$1" ;;
    foreign_ollama_app) open -a Ollama >>"$RB_LOG" 2>&1 ;;
    foreign_brew_service) brew services start "$1" >>"$RB_LOG" 2>&1 ;;
    user_created)
      id "$1" >/dev/null 2>&1 || { UNDO_MSG="already gone"; return 2; }
      userdel "$1" >>"$RB_LOG" 2>&1 || return 1
      getent group "$1" >/dev/null 2>&1 && groupdel "$1" >>"$RB_LOG" 2>&1
      return 0 ;;
    model_pulled)
      # Delete a model only if THIS run finished downloading it (model_ready) and the installed
      # copy is still that one (same ID). A model that was already there is never touched.
      local want ob cur
      want="$(awk -F'\t' -v m="$1" '$1=="model_ready" && $2==m {print $3}' "$RB_SOURCE" | tail -n1)"
      [ -n "$want" ] || { UNDO_MSG="the download did not finish; Ollama deletes partial files when it restarts"; return 2; }
      ob="$(command -v ollama)"
      [ -n "$ob" ] || { UNDO_MSG="ollama not found (the model files go with it)"; return 2; }
      cur="$(OLLAMA_HOST="${RB_OLLAMA_HOST:-127.0.0.1:11434}" "$ob" list 2>/dev/null | awk -v m="$1" '$1==m{print $2}')"
      [ "$cur" = "$want" ] || { UNDO_MSG="kept: the installed $1 is not the copy this run downloaded"; return 2; }
      OLLAMA_HOST="${RB_OLLAMA_HOST:-127.0.0.1:11434}" "$ob" rm "$1" >>"$RB_LOG" 2>&1 \
        || { UNDO_MSG="Ollama was not running; remove it later with: ollama rm $1"; return 1; } ;;
    uv_python) have uv && uv python uninstall "$1" >>"$RB_LOG" 2>&1 ;;
    copr_enabled) dnf copr remove -y "$1" >>"$RB_LOG" 2>&1 ;;
    ollama_script)
      # Removal documented by Ollama for its Linux installer.
      rb_systemctl disable --now ollama.service
      rm -f /etc/systemd/system/ollama.service; rb_systemctl daemon-reload
      rm -f /usr/local/bin/ollama /usr/bin/ollama /bin/ollama
      rm -rf /usr/local/lib/ollama /usr/share/ollama
      id ollama >/dev/null 2>&1 && userdel ollama >>"$RB_LOG" 2>&1
      getent group ollama >/dev/null 2>&1 && groupdel ollama >>"$RB_LOG" 2>&1
      return 0 ;;
    db_backup)
      [ -f "$2" ] || { UNDO_MSG="the database copy is missing"; return 1; }
      rm -f "$1-wal" "$1-shm"; cp -p "$2" "$1" 2>>"$RB_LOG" ;;
    manual) UNDO_MSG="$1"; return 2 ;;
    *) UNDO_MSG="unknown journal entry"; return 2 ;;
  esac
}

# Human description of an entry (UI and log).
undo_label() {
  case "$1" in
    dir_created) echo "Remove folder $2" ;;
    file_created) echo "Remove $2" ;;
    file_backup|link_backup) echo "Restore $2" ;;
    tree_backup) echo "Restore folder $2" ;;
    pkgs_added) shift 2; echo "Uninstall $*" ;;
    svc_stop) echo "Stop service $3" ;;
    svc_reload) echo "Reload previous service $3" ;;
    vendor_disabled) echo "Re-enable $2" ;;
    foreign_ollama_app) echo "Reopen the Ollama app" ;;
    foreign_brew_service) echo "Restart Homebrew service $2" ;;
    user_created) echo "Delete service user $2" ;;
    model_pulled) echo "Delete model $2" ;;
    uv_python) echo "Remove Python $2 installed by uv" ;;
    copr_enabled) echo "Remove repository $2" ;;
    ollama_script) echo "Uninstall Ollama" ;;
    db_backup) echo "Restore the database from before the migration" ;;
    manual) echo "Manual step" ;;
    *) echo "$1" ;;
  esac
}

# latest_journal — newest run journal not yet rolled back.
latest_journal() {
  local f latest=""
  # run-YYYYMMDD-HHMMSS.tsv: the glob's alphabetical order is chronological.
  for f in "$(journal_dir)"/run-*.tsv; do
    [ -f "$f" ] && [ ! -e "$f.rolledback" ] && latest="$f"
  done
  [ -n "$latest" ] && echo "$latest"
}

# rollback_run JOURNAL REASON — undo every entry in reverse order. Sets RB_*.
rollback_run() {
  local journal="$1" reason="$2" work total i=0 line rc label t
  RB_OK=0; RB_FAILED=0; RB_SKIPPED=0; RB_RESULT=ok
  RB_REPORT="$(mktemp -d "${TMPDIR:-/tmp}/lefi-rollback-XXXXXX")"; chmod 755 "$RB_REPORT"
  RB_LOG="$RB_REPORT/rollback.log"; : >"$RB_LOG"; chmod 644 "$RB_LOG"
  if [ -z "$journal" ] || [ ! -f "$journal" ]; then
    ev_emit rollback.started "\"reason\":$(_evq "$reason"),\"items_total\":0,\"journal\":\"\""
    ev_emit rollback.done "\"result\":\"nothing\",\"ok\":0,\"failed\":0,\"skipped\":0,\"report\":$(_evq "$RB_REPORT")"
    RB_RESULT=nothing; info "Nothing to roll back."; return 0
  fi
  # Work from copies: the run may have created the folder that holds the journal and its logs.
  work="$RB_REPORT/journal.tsv"; RB_SOURCE="$RB_REPORT/journal.orig.tsv"
  cp "$journal" "$RB_SOURCE"
  # model_ready lines are facts for model_pulled, not changes to undo.
  grep -v -e '^#' -e '^model_ready' "$journal" | awk '{a[NR]=$0} END{for(i=NR;i>0;i--) print a[i]}' >"$work"
  [ -n "${LOG_FILE:-}" ] && [ -f "$LOG_FILE" ] && cp "$LOG_FILE" "$RB_REPORT/install.log" 2>/dev/null
  [ -n "${EVENTS_FILE:-}" ] && [ -f "$EVENTS_FILE" ] && cp "$EVENTS_FILE" "$RB_REPORT/install.events.ndjson" 2>/dev/null
  chmod 644 "$RB_REPORT"/* 2>/dev/null
  total="$(grep -c . "$work")"
  header "Rolling back ($total change(s) recorded by this run)"
  ev_emit rollback.started "\"reason\":$(_evq "$reason"),\"items_total\":$total,\"journal\":$(_evq "$journal")"
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    i=$((i + 1))
    local IFS=$'\t'
    # shellcheck disable=SC2086
    set -- $line
    IFS=$' \t\n'
    t="$1"; label="$(undo_label "$@")"
    undo_one "$@"; rc=$?
    case "$rc" in
      0) RB_OK=$((RB_OK + 1)); ok "$label${UNDO_MSG:+ ($UNDO_MSG)}"; res=ok ;;
      2) RB_SKIPPED=$((RB_SKIPPED + 1)); info "$label — skipped: $UNDO_MSG"; res=skipped ;;
      *) RB_FAILED=$((RB_FAILED + 1)); err "$label — FAILED${UNDO_MSG:+: $UNDO_MSG} (see $RB_LOG)"; res=failed ;;
    esac
    printf '%s\t%s\t%s\n' "$res" "$label" "$UNDO_MSG" >>"$RB_REPORT/summary.tsv"
    ev_emit rollback.item "\"index\":$i,\"items_total\":$total,\"action\":$(_evq "$t"),\"label\":$(_evq "$label"),\"result\":\"$res\",\"message\":$(_evq "$UNDO_MSG")"
  done <"$work"
  [ "$RB_FAILED" -gt 0 ] && RB_RESULT=partial
  [ -f "$journal" ] && : >"$journal.rolledback" 2>/dev/null
  chmod 644 "$RB_REPORT"/* 2>/dev/null
  ev_emit rollback.done "\"result\":\"$RB_RESULT\",\"ok\":$RB_OK,\"failed\":$RB_FAILED,\"skipped\":$RB_SKIPPED,\"report\":$(_evq "$RB_REPORT")"
  info "Rollback report: $RB_REPORT"
  [ "$RB_FAILED" = 0 ]
}
