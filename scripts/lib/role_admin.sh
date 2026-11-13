# shellcheck shell=bash
# Role: Lefi Gateway — Caddy in front of the Brain, the way Lefi Desktop reaches it (ADR-022, ADR-042).

ADMIN_PLACEHOLDER="$LEFI_STATE_DIR/admin-placeholder"

write_admin_placeholder() {
  [ "$DRY_RUN" = "1" ] && return 0
  _j j_file "$ADMIN_PLACEHOLDER/index.html"
  mkdir -p "$ADMIN_PLACEHOLDER"
  cat >"$ADMIN_PLACEHOLDER/index.html" <<'HTML'
<!doctype html><html lang="en"><head><meta charset="utf-8"><title>LEFI CROP</title>
<style>body{font-family:system-ui,sans-serif;background:#f4f7f1;color:#1f3d1c;display:grid;place-items:center;height:100vh;margin:0}
main{max-width:34rem;padding:2rem;border-radius:1rem;background:#fff;box-shadow:0 2px 12px #0001}h1{color:#2e7d32;margin-top:0}small{color:#7a5230}</style>
</head><body><main><h1>LEFI CROP</h1><p>The server is installed and Caddy is running.</p>
<p>Open <strong>Lefi Desktop</strong> to use Lefi Crop. This address is Lefi Gateway, its way in.</p><small>Placeholder served by scripts/install.sh</small></main></body></html>
HTML
}

# The HTTPS Lefi Gateway's Caddyfile. One function for the installer and for
# scripts/tests/desktop_gateway_real.sh, so the test runs exactly what customers get
# (the path Lefi Desktop requests really travel).
#   admin_render_caddyfile OUT NAME LAN_IP MTLS UPSTREAM ROOT [PORT] [EXTRA_SITES]
# EXTRA_SITES (", https://127.0.0.1:PORT" in the test) is added only with MTLS.
admin_render_caddyfile() {
  local out="$1" name="$2" ip="$3" mtls="$4" upstream="$5" root="$6" port="${7:-8443}" extra="${8:-}"
  local site="https://$name:$port" tls_global tls_site
  if [ -n "$ip" ] && [ "$ip" != unknown ]; then site="$site, https://$ip:$port"; fi
  tls_global="skip_install_trust
	auto_https disable_redirects"
  tls_site="tls internal"
  if [ "$mtls" = 1 ]; then
    # One site serves the name and the address with one policy, so strict SNI is not needed (an IP
    # has no SNI and would get 421 Misdirected Request). A connection by IP address sends no SNI, so
    # Caddy matched no site's TLS policy and never asked for the device certificate: Lefi Brain then
    # answered DEVICE_NOT_PAIRED to a paired PC (ADR-055). An address without a host is Caddy's
    # catch-all policy, with the same client_auth. Loopback lets this PC's own Lefi Desktop connect
    # whatever the network does.
    site="$site, https://localhost:$port$extra, https://:$port"
    tls_site="tls internal {
		client_auth {
			mode verify_if_given
			trust_pool file $LEFI_STATE_DIR/ca/issuing.crt
		}
	}"
    tls_global="$tls_global
	servers {
		strict_sni_host insecure_off
	}"
  fi
  render "$LEFI_ROOT/deploy/caddy/Caddyfile.template" "$out" \
    "STATE_DIR=$LEFI_STATE_DIR" "SITE_ADDRESS=$site" "GLOBAL_TLS=$tls_global" "SITE_TLS=$tls_site" \
    "BRAIN_UPSTREAM=$upstream" "ADMIN_ROOT=$root"
}

role_admin_install() {
  header "Lefi Gateway · Caddy in front of Lefi Brain"
  step_begin admin.packages
  CADDY_INSTALLED_NOW=0
  install_caddy || die "Caddy required."
  vendor_service_off caddy.service "$CADDY_INSTALLED_NOW"

  step_begin admin.site

  local upstream
  if roles_has core; then upstream="127.0.0.1:8000"
  else
    ask "Lefi Brain (core node) address host:port" "$(env_get LEFI_ADMIN_BRAIN_UPSTREAM | sed 's/^$/192.168.8.10:8000/')" BRAIN_UPSTREAM
    upstream="$REPLY"
  fi

  local url mtls=0 https=0 gw_name=""
  # HTTPS by default (ADR-042). The certificate comes from Caddy's own authority, covers Lefi's name
  # and this PC's address, and is not added to the system: Lefi Desktop will trust it by pairing.
  if confirm "Serve Lefi Gateway over HTTPS? (recommended; No = plain HTTP on the isolated LAN)" y ADMIN_HTTPS; then
    https=1
    local default_name="${HOST_NAME}.local"
    roles_has core && default_name="lefi-main.local"
    ask "Name of this PC on the network" "$default_name" ADMIN_HOSTNAME
    gw_name="$REPLY"; url="https://$gw_name:8443"
    if [ "$LAN_IP" != unknown ]; then url="https://$LAN_IP:8443"; fi
    # Lefi Brain on this PC: ask Lefi Desktop for its device certificate (ADR-048, one port :8443).
    if roles_has core && { [ -f "$LEFI_STATE_DIR/ca/issuing.crt" ] || [ "$DRY_RUN" = "1" ]; }; then mtls=1; fi
  else
    url="http://$LAN_IP:8080"
  fi

  # Lefi Desktop is the admin client (ADR-022): there is no web app to serve, only a short page.
  write_admin_placeholder
  if [ "$https" = 1 ]; then
    admin_render_caddyfile "$LEFI_STATE_DIR/caddy/Caddyfile" "$gw_name" "$LAN_IP" "$mtls" "$upstream" "$ADMIN_PLACEHOLDER"
  else
    render "$LEFI_ROOT/deploy/caddy/Caddyfile.template" "$LEFI_STATE_DIR/caddy/Caddyfile" \
      "STATE_DIR=$LEFI_STATE_DIR" "SITE_ADDRESS=http://:8080" "GLOBAL_TLS=auto_https off" "SITE_TLS=" \
      "BRAIN_UPSTREAM=$upstream" "ADMIN_ROOT=$ADMIN_PLACEHOLDER"
  fi
  if [ "$DRY_RUN" != "1" ]; then
    caddy validate --config "$LEFI_STATE_DIR/caddy/Caddyfile" --adapter caddyfile >>"$LOG_FILE" 2>&1 \
      || die "Generated Caddyfile is invalid (see $LOG_FILE)."
    ok "Caddyfile valid"
  fi
  # Caddy's own authority lives in the state folder, so Lefi Brain knows which CA a paired PC pins.
  start_service caddy "$LOG_DIR/caddy.log" "XDG_DATA_HOME=$LEFI_STATE_DIR/caddy/data" "$(command -v caddy || echo caddy)" run \
    --config "$LEFI_STATE_DIR/caddy/Caddyfile" --adapter caddyfile || die "Could not start Caddy."
  if [ "$mtls" = 1 ]; then
    env_set LEFI_DEVICE_CERT_REQUIRED true
    env_set LEFI_GATEWAY_CA_FILE "$LEFI_STATE_DIR/caddy/data/caddy/pki/authorities/local/root.crt"
    core_start_brain   # it reads LEFI_DEVICE_CERT_REQUIRED at start
    ok "Lefi Gateway asks Lefi Desktop for its device certificate (pairing: Lefi Crop Helper → Apps)"
  else
    env_set LEFI_DEVICE_CERT_REQUIRED false
  fi
  env_set LEFI_ADMIN_URL "$url"
  env_set LEFI_ADMIN_BRAIN_UPSTREAM "$upstream"
  ok "Lefi Gateway available at $url"
}
