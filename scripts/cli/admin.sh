# shellcheck shell=bash
# Gateway (Caddy) commands.

caddy_access_log() { echo "$LOG_DIR/caddy-access.log"; }

cmd_admin() {
  require_role ADMIN "The admin node"
  local sub="${1:-status}"; [ $# -gt 0 ] && shift
  case "$sub" in
    status) admin_status ;;
    url) env_get LEFI_ADMIN_URL ;;
    requests|req) parse_n 5000 "$@"; http_requests_report "$(caddy_access_log)" "remote_ip" "uri" ;;
    *) die "Unknown: lefi admin $sub (status, url, requests)" ;;
  esac
}

admin_status() {
  local url up; url="$(env_get LEFI_ADMIN_URL)"; up="$(env_get LEFI_ADMIN_BRAIN_UPSTREAM)"
  header "Lefi Gateway"
  info "Service:    $(svc_state admin) (PID $(svc_pid admin | sed 's/^$/-/'))"
  info "URL:        $url"
  curl -fsSk -m 4 -o /dev/null "$url" && ok "Admin responds" || warn "Admin URL not responding"
  info "Brain upstream: $up"
  if [ "$HAS_BRAIN" = 1 ] || http_ok "http://$up/api/v1/health" 3; then
    http_ok "http://$up/api/v1/health" 3 && ok "Brain API reachable through the upstream" || warn "Brain API not reachable at $up"
  else
    info "Brain API not implemented yet — the admin serves a placeholder."
  fi
}

# Generic JSON-lines HTTP access-log report.
# http_requests_report FILE IP_KEY PATH_KEY  (uses NLINES)
http_requests_report() {
  local f="$1" ipk="$2" pk="$3"
  [ -f "$f" ] || { info "No access log yet ($f)."; return 0; }
  header "HTTP requests (last $NLINES lines of $f)"
  tail -n "$NLINES" "$f" | awk -v ipk="$ipk" -v pk="$pk" '
    function val(k,   r){ if (match($0, "\"" k "\":\"[^\"]*\"")) { r=substr($0,RSTART,RLENGTH); sub("^\"" k "\":\"","",r); sub(/"$/,"",r); return r } return "" }
    function num(k,   r){ if (match($0, "\"" k "\":[0-9.]+")) { r=substr($0,RSTART,RLENGTH); sub("^\"" k "\":","",r); return r+0 } return -1 }
    { ip=val(ipk); p=val(pk); sub(/\?.*/,"",p); st=num("status"); if (ip=="" && st<0) next
      n++; byip[ip]++; byp[p]++; byst[st]++; if (st>=500) e5++; else if (st>=400) e4++ }
    END { if (!n) { print "  No requests."; exit }
      printf "  Total: %d · 4xx: %d · 5xx: %d\n\n  By client IP:\n", n, e4, e5
      for (k in byip) printf "    %-18s %d\n", k, byip[k]
      print "  Top paths:"; for (k in byp) printf "    %-40s %d\n", k, byp[k]
      print "  By status:"; for (k in byst) printf "    %-6s %d\n", k, byst[k] }' | head -n 60
}
