# shellcheck shell=bash
# Database commands (SQLite on the core node; PostgreSQL later per ADR-011).

db_path() {
  local url; url="$(env_get LEFI_DATABASE_URL)"
  case "$url" in sqlite*:///*) echo "/${url#*:///}" | sed 's#^//#/#' ;; "") echo "$LEFI_STATE_DIR/data/lefi.db" ;; *) echo "" ;; esac
}

cmd_db() {
  require_role CORE "The core node (database)"
  local sub="${1:-status}"; [ $# -gt 0 ] && shift
  local db; db="$(db_path)"
  [ -n "$db" ] || die "LEFI_DATABASE_URL is not SQLite ($(env_get LEFI_DATABASE_URL)); use the server's own tools."
  case "$sub" in
    path) echo "$db" ;;
    status) db_status "$db" ;;
    backup) db_backup "$db" ;;
    check|verify) require_role BRAIN "The Brain (database checks)"; _jhdr "Database · full check" "$@"; brain_py db check "$@" ;;
    current|revision) require_role BRAIN "The Brain (schema)"; _jhdr "Database · schema revision" "$@"; brain_py db current "$@" ;;
    tables) require_role BRAIN "The Brain (database)"; _jhdr "Database · tables" "$@"; brain_py db tables "$@" ;;
    migrate) db_migrate "$@" ;;
    *) die "Unknown: lefi db $sub (status, check, current, tables, migrate, backup, path)" ;;
  esac
}

# Schema upgrade. The Brain also migrates on start; this is the explicit, offline path.
db_migrate() {
  require_role BRAIN "The Brain (migrations)"
  if svc_running brain; then
    die "The Brain is running (PID $(svc_pid brain)). Use 'lefi restart brain' (it migrates on start) or 'lefi stop brain' first."
  fi
  _jhdr "Database · migrate" "$@"
  brain_py db migrate "$@"
}

file_kb() { [ -f "$1" ] && du -k "$1" | awk '{print $1}' || echo 0; }

db_status() {
  local db="$1"
  header "Database (SQLite)"
  info "Path:       $db"
  if [ ! -f "$db" ]; then
    warn "Database not created yet — the Brain creates it on first start, or run: lefi db migrate"
    return 0
  fi
  info "Size:       $(human_kb "$(file_kb "$db")") · WAL $(human_kb "$(file_kb "$db-wal")")"
  info "Modified:   $(date -r "$db" '+%Y-%m-%d %H:%M:%S' 2>/dev/null)"
  if ! have sqlite3; then
    warn "sqlite3 CLI not found — integrity details via: lefi db check"
    return 0
  fi
  info "Tables:     $(sqlite3 -readonly "$db" "SELECT count(*) FROM sqlite_master WHERE type='table';" 2>/dev/null)"
  local qc; qc="$(sqlite3 -readonly "$db" 'PRAGMA quick_check;' 2>&1 | head -n1)"
  [ "$qc" = ok ] && ok "Integrity quick_check: ok" || err "Integrity quick_check: $qc"
  info "Mode:       journal_mode=$(sqlite3 -readonly "$db" 'PRAGMA journal_mode;' 2>/dev/null)"
  local last; last="$(ls -1t "$LEFI_STATE_DIR/backups"/lefi-*.db 2>/dev/null | head -n1)"
  info "Last backup: ${last:-none (lefi db backup)}"
}

# Online, consistent copy using SQLite's backup API (safe while the Brain is writing).
db_backup() {
  local db="$1" dir="$LEFI_STATE_DIR/backups" dest
  [ -f "$db" ] || die "Database not created yet: $db"
  if [ "$HAS_BRAIN" = 1 ] && [ -x "$BRAIN_PY" ]; then
    dest="$(brain_py db backup)" || die "Backup failed"
  else
    have sqlite3 || die "sqlite3 CLI not found"
    mkdir -p "$dir"; chmod 700 "$dir"
    dest="$dir/lefi-$(date +%Y%m%d-%H%M%S).db"
    sqlite3 "$db" ".backup '$dest'" || die "Backup failed"
    chmod 600 "$dest"
  fi
  ok "Backup: $dest ($(human_kb "$(file_kb "$dest")"))"
  ls -1t "$dir"/lefi-*.db 2>/dev/null | tail -n +11 | while read -r old; do rm -f "$old"; done
  info "Keeping the 10 most recent backups in $dir"
}
