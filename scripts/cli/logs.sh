# shellcheck shell=bash
# Logs: list / show / follow, rotation, error scan with saved reports, support bundle.

ERROR_RE='error|fatal|panic|traceback|exception|failed|failure|denied|refused|not authori[sz]ed|socket error|timed? ?out|\| 5[0-9][0-9] \||"level":"(ERROR|CRITICAL)"|level=(error|ERROR)'
LOG_NAMES="cli installer ai ai-events ai-perf mqtt admin admin-access brain brain-access"
CLI_FAIL_RE=' -> [1-9][0-9]*$'   # audit lines of commands that failed

log_files_for() {  # log_files_for NAME -> paths (one per line, existing only)
  local f
  case "$1" in
    cli) f="$CLI_LOG" ;;
    installer) f="$(ls -1t "$LOG_DIR"/install-*.log 2>/dev/null | head -n1)" ;;
    ai) f="$(svc_log ai)" ;;
    ai-events) f="$AI_EVENTS_LOG" ;;
    ai-perf) f="$AI_PERF_LOG" ;;
    mqtt) printf '%s\n%s\n' "$LEFI_STATE_DIR/mosquitto/log/mosquitto.log" "$(svc_log mqtt)" | while read -r x; do [ -f "$x" ] && echo "$x"; done; return ;;
    admin) f="$(svc_log admin)" ;;
    admin-access) f="$LOG_DIR/caddy-access.log" ;;
    brain) f="$(svc_log brain)" ;;
    brain-access) f="$LOG_DIR/brain-access.log" ;;
    *) die "Unknown log '$1' ($LOG_NAMES)" ;;
  esac
  [ -n "$f" ] && [ -f "$f" ] && echo "$f"
  return 0
}

cmd_logs() {
  local name="" follow=0
  [ "$1" = rotate ] && { shift; logs_rotate "$@"; return; }
  while [ $# -gt 0 ]; do
    case "$1" in -f|--follow) follow=1 ;; -n|-n*) ;; *) [ -z "$name" ] && case "$1" in [0-9]*) ;; *) name="$1" ;; esac ;; esac
    shift
  done
  # shellcheck disable=SC2086
  parse_n 80 $CLI_CMDLINE
  if [ -z "$name" ]; then
    header "Logs ($LOG_DIR)"
    local n f
    for n in $LOG_NAMES; do
      for f in $(log_files_for "$n"); do
        printf '  %-13s %9s  %s  %s\n' "$n" "$(human_kb "$(du -k "$f" | awk '{print $1}')")" \
          "$(date -r "$f" '+%Y-%m-%d %H:%M' 2>/dev/null)" "$f"
      done
    done
    info "Show: lefi logs <name> [-n N] · follow: lefi logs <name> -f · errors: lefi errors"
    return 0
  fi
  local files; files="$(log_files_for "$name")"
  [ -n "$files" ] || die "No '$name' log on this machine yet."
  # shellcheck disable=SC2086
  if [ "$follow" = 1 ]; then tail -n "$NLINES" -F $files; else tail -n "$NLINES" $files; fi
}

# Copy-truncate rotation keeps the file handle used by launchd/services valid.
logs_rotate() {
  local force=0 limit=$((20 * 1024)) f sz i; has_flag --force "$@" && force=1
  header "Rotating logs (> 20 MB$( [ "$force" = 1 ] && echo ', forced'))"
  for f in "$LOG_DIR"/*.log "$LEFI_STATE_DIR/mosquitto/log/mosquitto.log"; do
    [ -f "$f" ] || continue
    sz="$(du -k "$f" | awk '{print $1}')"
    if [ "$force" = 1 ] || [ "$sz" -gt "$limit" ]; then
      i=3; while [ "$i" -gt 1 ]; do [ -f "$f.$((i - 1)).gz" ] && mv "$f.$((i - 1)).gz" "$f.$i.gz"; i=$((i - 1)); done
      cp "$f" "$f.1" && : >"$f" && gzip -f "$f.1" && ok "$(basename "$f") rotated ($(human_kb "$sz"))"
    fi
  done
  info "Keeping 3 compressed generations per log."
}

pattern_for() {
  case "$1" in
    cli) echo "$CLI_FAIL_RE" ;;
    ai-events) echo '^[^ ]+ (ERROR|WARN) ' ;;
    ai-perf) echo '^$NEVER' ;;   # measurements only, never errors
    *) echo "$ERROR_RE" ;;
  esac
}

error_scan_count() {  # error_scan_count LINES
  local n f total=0
  for n in $LOG_NAMES; do
    for f in $(log_files_for "$n"); do
      total=$((total + $(tail -n "$1" "$f" | grep -Eic "$(pattern_for "$n")")))
    done
  done
  echo "$total"
}

cmd_errors() {
  local name="" a
  for a in "$@"; do case "$a" in -n|[0-9]*) ;; -*) ;; *) name="$a" ;; esac; done
  parse_n 2000 "$@"
  local names="${name:-$LOG_NAMES}" report n f c hits
  mkdir -p "$REPORT_DIR"; chmod 700 "$REPORT_DIR"
  report="$REPORT_DIR/errors-$(date +%Y%m%d-%H%M%S).txt"
  header "Error scan (last $NLINES lines per log)"
  {
    echo "Lefi Crop AI error report · $(date '+%Y-%m-%d %H:%M:%S') · $(hostname -s 2>/dev/null)"
    echo "Pattern: $ERROR_RE"
  } >"$report"
  for n in $names; do
    for f in $(log_files_for "$n"); do
      hits="$(tail -n "$NLINES" "$f" | grep -Ein "$(pattern_for "$n")")"
      c=0; [ -n "$hits" ] && c="$(printf '%s\n' "$hits" | wc -l | tr -d ' ')"
      if [ "$c" -gt 0 ]; then warn "$(printf '%-13s %5s error line(s)  %s' "$n" "$c" "$f")"
      else ok "$(printf '%-13s     0 errors        %s' "$n" "$f")"; fi
      { echo; echo "=== $n · $f · $c match(es)"; printf '%s\n' "$hits" | tail -n 200; } >>"$report"
    done
  done
  chmod 600 "$report"
  echo; info "Most recent matches:"
  grep -E '^[0-9]+:' "$report" | tail -n 12 | cut -c1-160 | sed 's/^/    /'
  info "Full report: $report"
}

redact() {  # stdin → stdout with secret values removed
  sed -E 's/^([A-Za-z_]*([Pp][Aa][Ss][Ss]|[Ss][Ee][Cc][Rr][Ee][Tt]|[Tt][Oo][Kk][Ee][Nn]|[Kk][Ee][Yy])[A-Za-z_]*)=.*/\1=<redacted>/; s/(-P )[^ ]+/\1<redacted>/g; s/("password":")[^"]*"/\1<redacted>"/g'
}

cmd_report() {
  local ts dir out n f
  ts="$(date +%Y%m%d-%H%M%S)"; mkdir -p "$REPORT_DIR"; chmod 700 "$REPORT_DIR"
  dir="$(mktemp -d)/lefi-report-$(hostname -s 2>/dev/null)-$ts"; mkdir -p "$dir/logs" "$dir/config"
  header "Building support bundle (secrets are redacted)"
  ( colors_off; cmd_status; cmd_resources; cmd_net; cmd_ps ) >"$dir/status.txt" 2>&1
  ( colors_off; [ "$HAS_AI" = 1 ] || [ "$HAS_CORE" = 1 ] && ai_status
    [ "$HAS_AI" = 1 ] && { ai_models; ai_resources_once; ai_perf -n 30; ai_requests -n 5000; }
    [ "$HAS_CORE" = 1 ] && { mqtt_clients; db_status "$(db_path)"; }
    [ "$HAS_ADMIN" = 1 ] && admin_status ) >"$dir/components.txt" 2>&1
  ( colors_off; cmd_errors -n 5000 ) >"$dir/errors.txt" 2>&1
  { echo "lefi $LEFI_VERSION · $(cd "$LEFI_ROOT" && git rev-parse --short HEAD 2>/dev/null || (cd "$LEFI_SETUP_ROOT" && git rev-parse --short HEAD 2>/dev/null))"; uname -a
    [ -n "$(ollama_bin)" ] && "$(ollama_bin)" --version 2>/dev/null
    have mosquitto && mosquitto -h 2>/dev/null | head -n1; have caddy && caddy version; have uv && uv --version
    have node && node --version; } >"$dir/versions.txt" 2>&1
  [ -f "$ENV_FILE" ] && redact <"$ENV_FILE" >"$dir/config/env.redacted"
  for f in "$LEFI_STATE_DIR/mosquitto/mosquitto.conf" "$LEFI_STATE_DIR/mosquitto/acl" "$LEFI_STATE_DIR/caddy/Caddyfile" "$LEFI_STATE_DIR"/services/*.svc; do
    [ -f "$f" ] && redact <"$f" >"$dir/config/$(basename "$f")"
  done
  for n in $LOG_NAMES; do
    for f in $(log_files_for "$n"); do tail -n 1000 "$f" | redact >"$dir/logs/$n-$(basename "$f")"; done
  done
  out="$REPORT_DIR/$(basename "$dir").tar.gz"
  tar -czf "$out" -C "$(dirname "$dir")" "$(basename "$dir")" && chmod 600 "$out"
  rm -rf "$(dirname "$dir")"
  ok "Bundle: $out"
  info "Contains status, resources, network, processes, component checks, error scan, versions,"
  info "redacted config and the last 1000 lines of each log. Credentials files are never included."
}
