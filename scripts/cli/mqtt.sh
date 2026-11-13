# shellcheck shell=bash
# MQTT broker commands: status, clients (with IPs), stats, live watch.

mqtt_port() { svc_port mqtt; }
mqtt_log() { echo "$LEFI_STATE_DIR/mosquitto/log/mosquitto.log"; }

# $SYS values (needs the lefi-brain ACL entry `topic read $SYS/#`).
mqtt_sys() {  # mqtt_sys TOPIC... -> lines "topic value"
  local args="" t
  for t in "$@"; do args="$args -t \$SYS/broker/$t"; done
  # shellcheck disable=SC2086
  mosquitto_sub -h 127.0.0.1 -p "$(mqtt_port)" -u lefi-brain -P "$(cred_get lefi-brain)" $args \
    -v -C "$#" -W 12 2>/dev/null | sed 's#^\$SYS/broker/##'
}

cmd_mqtt() {
  require_role CORE "The core node (MQTT broker)"
  local sub="${1:-status}"; [ $# -gt 0 ] && shift
  case "$sub" in
    status) mqtt_status ;;
    clients) mqtt_clients ;;
    stats) mqtt_stats ;;
    watch) mqtt_watch "$@" ;;
    *) die "Unknown: lefi mqtt $sub (status, clients, stats, watch)" ;;
  esac
}

mqtt_status() {
  header "MQTT broker"
  info "Service:    $(svc_state mqtt) (PID $(svc_pid mqtt | sed 's/^$/-/')) · port $(mqtt_port)"
  port_listening "$(mqtt_port)" || { warn "Broker not listening — start it: lefi start mqtt"; return 0; }
  info "Reading broker counters (\$SYS, up to 12 s)…"
  local sys; sys="$(mqtt_sys version uptime clients/connected clients/total messages/received messages/sent)"
  if [ -z "$sys" ]; then
    warn "No \$SYS data. Re-run 'lefi setup' (core) to update the ACL with \$SYS read access."
  else
    echo "$sys" | awk '{k=$1; $1=""; printf "  %-22s%s\n", k, $0}'
  fi
  info "Devices and IPs: lefi mqtt clients"
}

# Connection state rebuilt from the broker log (connection_messages true). Lines used:
#  "<ts>: New connection from 192.168.8.31:5123 on port 1883."
#  "<ts>: New client connected from 192.168.8.31:5123 as esp32-01 (p2, c1, k60, u'esp32-01')."
#  "<ts>: Client esp32-01 disconnected[, not authorised]." / "closed its connection." / "Socket error on client …"
fmt_epoch() { date -r "$1" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || date -d "@$1" '+%Y-%m-%d %H:%M:%S' 2>/dev/null; }

mqtt_clients() {
  local log; log="$(mqtt_log)"
  [ -f "$log" ] || die "Broker log not found ($log)"
  header "MQTT clients by user (each ESP32 authenticates as its device id)"
  mkdir -p "$LEFI_STATE_DIR/run"
  awk -v q="'" '
    function ts(){ t=$1; sub(/:$/,"",t); return t }
    / New connection from / { lastip=$5; sub(/:[0-9]+$/,"",lastip) }
    / New client connected from / { ip=$6; sub(/:[0-9]+$/,"",ip); id=$8; u="?"
      i=index($0, " u" q); if (i>0) { rest=substr($0, i+3); u=substr(rest, 1, index(rest, q)-1) }
      user[id]=u; n[u]++; uip[u]=ip; useen[u]=ts(); ust[u]="connected"; live[id]=1 }
    / disconnected, not authorised/ { rej[lastip]++; rejt[lastip]=ts(); next }
    / Client .* (disconnected|closed its connection)/ { id=$3; sub(/,$/,"",id); u=user[id]; if (u!="") { ust[u]="disconnected"; useen[u]=ts() } delete live[id] }
    / Socket error on client / { id=$6; sub(/,$/,"",id); u=user[id]; if (u!="") { ust[u]="lost (socket error)"; useen[u]=ts() } delete live[id] }
    / has exceeded timeout/ { id=$3; u=user[id]; if (u!="") { ust[u]="lost (timeout)"; useen[u]=ts() } delete live[id] }
    END {
      for (id in live) { cur[user[id]]++ }
      for (u in n) printf "U|%s|%s|%s|%s|%d|%d\n", u, ust[u], uip[u], useen[u], n[u], cur[u]
      for (ip in rej) printf "R|%s|%d|%s\n", ip, rej[ip], rejt[ip] }' "$log" >"$LEFI_STATE_DIR/run/mqtt-clients.tmp" 2>/dev/null \
    || die "Could not parse the broker log"
  local f="$LEFI_STATE_DIR/run/mqtt-clients.tmp" device_users="" pwf="$LEFI_STATE_DIR/mosquitto/passwd" pu
  # Device accounts are the ones Lefi Brain added to the password file (ADR-052).
  if [ -r "$pwf" ]; then
    while IFS=: read -r pu _; do
      [ -n "$pu" ] || continue
      case " $MQTT_USERS " in *" $pu "*) ;; *) device_users="$device_users $pu" ;; esac
    done <"$pwf"
  fi
  printf '  %-12s %-20s %-16s %-6s %-6s %s\n' USER STATE LAST_IP CONNS LIVE LAST_SEEN
  grep '^U|' "$f" | sort -t'|' -k2 | while IFS='|' read -r _ u st ip seen conns live; do
    local col="$C_YELLOW" note=""; [ "$live" -gt 0 ] && { col="$C_GREEN"; st="connected"; }
    case " $MQTT_USERS $device_users " in *" $u "*) ;; *) note=" ${C_RED}(unknown user!)${C_RESET}" ;; esac
    printf '  %-12s %s%-20s%s %-16s %-6s %-6s %s%s\n' "$u" "$col" "$st" "$C_RESET" "$ip" "$conns" "$live" "$(fmt_epoch "$seen")" "$note"
  done
  local missing="" d; for d in $device_users; do grep -q "^U|$d|" "$f" || missing="$missing $d"; done
  [ -n "$missing" ] && info "Devices that never connected:$missing"
  if grep -q '^R|' "$f"; then
    header "Rejected connection attempts (bad or missing credentials)"
    grep '^R|' "$f" | while IFS='|' read -r _ ip c t; do
      printf '  %s%-16s%s %4s attempt(s), last %s\n' "$C_RED" "$ip" "$C_RESET" "$c" "$(fmt_epoch "$t")"
    done
    warn "Unknown clients are trying to use the broker — check devices' credentials or who is on the Wi-Fi."
  fi
  rm -f "$f"
}

mqtt_stats() {
  header "MQTT load (\$SYS, up to 12 s)"
  mqtt_sys load/messages/received/1min load/messages/sent/1min load/bytes/received/1min load/bytes/sent/1min \
    load/connections/1min clients/maximum messages/stored \
    | awk '{k=$1; $1=""; printf "  %-30s%s\n", k, $0}'
}

mqtt_watch() {
  local topic="${1:-lefi/v1/#}"
  header "Live MQTT traffic on '$topic' — Ctrl-C to stop"
  mosquitto_sub -h 127.0.0.1 -p "$(mqtt_port)" -u lefi-brain -P "$(cred_get lefi-brain)" -t "$topic" -v
}
