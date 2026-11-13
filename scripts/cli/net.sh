# shellcheck shell=bash
# Network diagnostics for the LAN described in docs/deployment/LOCAL_NETWORK.md.

cmd_net() {
  detect_system >/dev/null 2>&1
  header "Network"
  info "This node:  $HOST_NAME · $LAN_IP"
  local gw
  if is_macos; then gw="$(route -n get default 2>/dev/null | awk '/gateway:/{print $2}')"
  else gw="$(ip route 2>/dev/null | awk '/^default/{print $3; exit}')"; fi
  if [ -n "$gw" ]; then
    ping -c 1 -W 2 "$gw" >/dev/null 2>&1 || ping -c 1 -t 2 "$gw" >/dev/null 2>&1 \
      && ok "Router $gw reachable" || warn "Router $gw not answering ping"
  else warn "No default gateway (not connected?)"; fi
  [ -n "$LAN_IP" ] && info "LAN address: $LAN_IP — every Lefi Crop PC, ESP32 board and phone must be on this same network"

  local url host
  url="$(env_get OLLAMA_BASE_URL)"
  if [ -n "$url" ] && [ "$HAS_AI" != 1 ]; then
    http_ok "$url/api/version" 3 && ok "AI node $url reachable" || warn "AI node $url not reachable"
  fi
  if [ "$HAS_ADMIN" = 1 ]; then
    host="$(env_get LEFI_ADMIN_BRAIN_UPSTREAM)"
    nc -z -w 2 "${host%:*}" "${host##*:}" >/dev/null 2>&1 && ok "Brain upstream $host open" || warn "Brain upstream $host closed"
  fi
  if curl -fsS -m 3 -o /dev/null https://www.google.com 2>/dev/null; then info "Internet:   available (fine for setup/dev; unplug WAN for the offline demo)"
  else info "Internet:   not available (expected in offline demo mode)"; fi

  header "Listening ports (Lefi Crop AI)"
  if have lsof; then
    lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | awk 'NR>1 && $1 ~ /ollama|mosquitto|caddy|python|uvicorn/ {print "  " $1 " " $9}' | sort -u
  fi
  [ "$HAS_AI" = 1 ] && [ "$(env_get LEFI_AI_BIND)" = "0.0.0.0:11434" ] \
    && warn "Ollama is exposed on the LAN without authentication — only the main PC (Lefi Brain) should use it."
  return 0
}
