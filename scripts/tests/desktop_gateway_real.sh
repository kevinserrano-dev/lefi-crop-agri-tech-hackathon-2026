#!/usr/bin/env bash
# Lefi Desktop's Rust client — and Lefi Crop mobile's Dart client when Flutter is installed
# (ADR-068) — against the REAL Brain behind a REAL Lefi Gateway (Caddy, HTTPS), on loopback.
# Not part of `make test-shell` (needs uv, Python 3.12, Caddy and a Rust build):
#   CADDY=/path/to/caddy [FLUTTER=/path/to/flutter] ./scripts/tests/desktop_gateway_real.sh
# The Lefi AI assistant (ADR-067) is reached through the gateway too, with a TEST-ONLY fake AI
# node (scripts/tests/lib/fake_ollama.py) on a test port: no model runs here.
# Everything lives in a temporary folder: the Brain's database and logs, Caddy's own local CA
# (XDG_DATA_HOME, `skip_install_trust`: nothing reaches the system's trust store), test ports.
# The Caddyfile is rendered by the installer's own admin_render_caddyfile (scripts/lib/role_admin.sh),
# so the test runs what customers get, and the gateway is also reached through this Mac's LAN IP. No installed Lefi service is touched.
set -o pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
T="$(mktemp -d)"
BRAIN_PORT=18741 ADMIN_PORT=18742 GW_PORT=18743 AI_PORT=18744 ROBOT_PORT=18745
BRAIN_PID="" CADDY_PID="" DNSSD_PID="" AI_PID="" ROBOT_PID="" AI_MODEL="fake-test-model:1b"
# Test-only mDNS names: never _lefi-brain._tcp or lefi-main.local, which a real main PC may announce.
TEST_SERVICE="_lefi-brain-test._tcp" TEST_HOST="lefi-test-$$.local"
# shellcheck disable=SC2317,SC2329  # called by the EXIT trap (SC2317 on older shellcheck)
cleanup() {
  [ -n "$DNSSD_PID" ] && kill "$DNSSD_PID" 2>/dev/null
  [ -n "$AI_PID" ] && kill "$AI_PID" 2>/dev/null
  [ -n "$ROBOT_PID" ] && kill "$ROBOT_PID" 2>/dev/null
  [ -n "$CADDY_PID" ] && kill "$CADDY_PID" 2>/dev/null
  [ -n "$BRAIN_PID" ] && kill "$BRAIN_PID" 2>/dev/null
  wait 2>/dev/null
  if [ "${KEEP:-0}" = 1 ]; then echo "kept: $T"; else rm -rf "$T"; fi
}
trap cleanup EXIT
command -v uv >/dev/null || PATH="$HOME/.local/bin:$PATH"
command -v uv >/dev/null || { echo "uv is required"; exit 2; }
CADDY="${CADDY:-$(command -v caddy || true)}"
[ -x "$CADDY" ] || { echo "Caddy is required (set CADDY=/path/to/caddy)"; exit 2; }
for p in $BRAIN_PORT $ADMIN_PORT $GW_PORT $AI_PORT; do
  if nc -z 127.0.0.1 "$p" 2>/dev/null; then echo "port $p is busy"; exit 2; fi
done

wait_url() {  # wait_url URL SECONDS [curl options]
  local url="$1" n="$2"; shift 2
  while [ "$n" -gt 0 ]; do
    curl -fsS -o /dev/null "$@" "$url" 2>/dev/null && return 0
    sleep 1; n=$((n - 1))
  done
  return 1
}

# ── Brain (temporary state, loopback only, as with the gateway on the same PC: ADR-042)
ADMIN_PW="first-test-password-$$"
mkdir -p "$T/state" "$T/site"
echo "Lefi Gateway test page" >"$T/site/index.html"
(cd "$ROOT/services/brain" && uv sync --quiet) || { echo "uv sync failed"; exit 1; }
BRAIN_PY="$ROOT/services/brain/.venv/bin/python"
brain_cli() { (cd "$ROOT/services/brain" && env -u LEFI_ENV_FILE LEFI_STATE_DIR="$T/state" "$BRAIN_PY" -m lefi_brain "$@"); }

# ── Lefi Brain issuing CA, signed by a FAKE root standing in for Lefi Crop Helper's (ADR-048)
openssl req -x509 -sha256 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -days 2 \
  -subj "/CN=TEST ONLY fake LEFI root" -addext "basicConstraints=critical,CA:true,pathlen:1" \
  -addext "keyUsage=critical,keyCertSign,cRLSign" -keyout "$T/root.key" -out "$T/root.crt" >/dev/null 2>&1 \
  || { echo "openssl failed"; exit 1; }
brain_cli db migrate >/dev/null 2>&1 || { echo "db migrate failed"; exit 1; }
brain_cli ca request >"$T/issuing.csr" || { echo "ca request failed"; exit 1; }
printf 'basicConstraints=critical,CA:true,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign,digitalSignature\n' >"$T/issuing.ext"
openssl x509 -req -sha256 -in "$T/issuing.csr" -CA "$T/root.crt" -CAkey "$T/root.key" -CAcreateserial -days 2 \
  -extfile "$T/issuing.ext" -out "$T/issuing.crt" >/dev/null 2>&1 || { echo "signing the issuing CA failed"; exit 1; }
brain_cli ca install --cert "$T/issuing.crt" --root "$T/root.crt" >"$T/ca-install.log" 2>&1 || { echo "ca install failed:"; cat "$T/ca-install.log"; exit 1; }
echo "Lefi Brain issuing CA signed by the fake root"

# This PC's LAN address, so one request reaches the gateway from a non-loopback address as on a real
# network (ADR-057). Caddy listens on every interface during the test (a temporary test Brain).
LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)
# Linux (CI, containers): the first non-loopback address.
[ -n "$LAN_IP" ] || LAN_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
if [ -n "$LAN_IP" ]; then export LEFI_TEST_GATEWAY_URL_LAN="https://$LAN_IP:$GW_PORT"; fi

# ── Lefi Gateway: rendered by the installer's own function (scripts/lib/role_admin.sh), never a copy
(
  # shellcheck disable=SC2030  # this subshell only renders the file
  export LEFI_STATE_DIR="$T/state" DRY_RUN=0 LOG_FILE="$T/render.log"
  # shellcheck source=scripts/lib/common.sh
  . "$ROOT/scripts/lib/common.sh"
  # shellcheck source=scripts/lib/role_admin.sh
  . "$ROOT/scripts/lib/role_admin.sh"
  admin_render_caddyfile "$T/Caddyfile" "$TEST_HOST" "${LAN_IP:-unknown}" 1 "127.0.0.1:$BRAIN_PORT" "$T/site" \
    "$GW_PORT" ", https://127.0.0.1:$GW_PORT"
) >/dev/null || { echo "rendering the Caddyfile failed"; exit 1; }
# Test only: Caddy's admin API on a test port, so a Caddy already running on this PC is never touched.
# (-i.bak works with both BSD and GNU sed.)
sed -i.bak "s/admin localhost:2019/admin localhost:$ADMIN_PORT/" "$T/Caddyfile" && rm -f "$T/Caddyfile.bak"
grep -q "https://:$GW_PORT" "$T/Caddyfile" || { echo "the gateway has no catch-all site (ADR-055)"; exit 1; }
mkdir -p "$T/state/logs"
XDG_DATA_HOME="$T/xdg" XDG_CONFIG_HOME="$T/xdg-config" HOME="$T" \
  "$CADDY" run --config "$T/Caddyfile" --adapter caddyfile >"$T/caddy.log" 2>&1 &
CADDY_PID=$!
CA="$T/xdg/caddy/pki/authorities/local/root.crt"
n=30; while [ ! -s "$CA" ] && [ $n -gt 0 ]; do sleep 1; n=$((n - 1)); done
[ -s "$CA" ] || { echo "Caddy did not create its CA:"; tail -20 "$T/caddy.log"; exit 1; }
# TEST ONLY fake AI node for the Lefi AI assistant (ADR-067).
"$BRAIN_PY" "$ROOT/scripts/tests/lib/fake_ollama.py" "$AI_PORT" "$AI_MODEL" >"$T/fake-ai.log" 2>&1 &
AI_PID=$!
# TEST ONLY simulated robot (ADR-091): the bridge's lite backend (a point on the map, no Genesis), its
# token in $T, never ~/.lefi-crop/robot-sim.
(cd "$ROOT/simulators/robot-mh3" && PYTHONPATH=src exec "$BRAIN_PY" -m lefi_robot_sim --backend lite \
  --port "$ROBOT_PORT" --token-file "$T/robot-token") >"$T/robot.log" 2>&1 &
ROBOT_PID=$!
(
  cd "$ROOT/services/brain" || exit 1
  unset LEFI_ENV_FILE
  # shellcheck disable=SC2031  # set again on purpose in this subshell
  export LEFI_STATE_DIR="$T/state" LEFI_ENV=production LEFI_DEVICE_CERT_REQUIRED=true \
    LEFI_GATEWAY_CA_FILE="$CA" OLLAMA_BASE_URL="http://127.0.0.1:$AI_PORT" OLLAMA_MODEL="$AI_MODEL" \
    LEFI_BOOTSTRAP_ADMIN_USERNAME=admin LEFI_BOOTSTRAP_ADMIN_PASSWORD="$ADMIN_PW" \
    LEFI_ROBOT_SIM_URL="http://127.0.0.1:$ROBOT_PORT" LEFI_ROBOT_SIM_TOKEN_FILE="$T/robot-token"
  # exec: BRAIN_PID is the Brain itself, so cleanup stops it.
  exec "$BRAIN_PY" -m lefi_brain serve --host 127.0.0.1 --port "$BRAIN_PORT"
) >"$T/brain.log" 2>&1 &
BRAIN_PID=$!
wait_url "http://127.0.0.1:$BRAIN_PORT/api/v1/health" 60 || { echo "Brain did not start:"; tail -20 "$T/brain.log"; exit 1; }
echo "Lefi Brain up on 127.0.0.1:$BRAIN_PORT (devices required through the gateway)"
wait_url "https://localhost:$GW_PORT/api/v1/health" 30 --cacert "$CA" || { echo "Gateway not answering:"; tail -20 "$T/caddy.log"; exit 1; }
echo "Lefi Gateway up on https://localhost:$GW_PORT (CA $CA)"

# A CA that never signed anything here: the client must refuse the gateway with it.
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -days 1 -subj "/CN=Not the gateway CA (test)" \
  -keyout "$T/wrong.key" -out "$T/wrong-ca.pem" >/dev/null 2>&1 || { echo "openssl failed"; exit 1; }

# A test-only announcement (own service type and host name, removed at exit), like the one the main
# PC's lefi-helperd makes for _lefi-brain._tcp (ADR-047). macOS only: dns-sd is part of the system.
if command -v dns-sd >/dev/null; then
  dns-sd -P "Lefi Brain (test $$)" "$TEST_SERVICE" local "$GW_PORT" "$TEST_HOST" 127.0.0.1 v=1 >"$T/dns-sd.log" 2>&1 &
  DNSSD_PID=$!
  # Wait until the system resolver answers for the name (a fixed 2 s sleep made the discovery test
  # fail now and then: the probe ran before the name resolved).
  n=20
  until dscacheutil -q host -a name "$TEST_HOST" 2>/dev/null | grep -q '^ip_address: 127.0.0.1'; do
    n=$((n - 1)); [ "$n" -gt 0 ] || { echo "the test name $TEST_HOST never resolved"; exit 1; }
    sleep 0.5
  done
fi

# Without dns-sd (Linux CI, containers) nothing announces the test service: that one test is
# reported NOT RUN instead of failing; every other test runs. On a Mac it always runs.
SKIP_MDNS=""
if [ -z "$DNSSD_PID" ]; then
  SKIP_MDNS=1
  echo "mDNS discovery test NOT RUN: dns-sd not found (macOS only)"
fi
# One test at a time: they pair from this same PC, and a new pairing replaces the older one (ADR-055).
LEFI_TEST_BRAIN_SERVICE="$TEST_SERVICE.local." LEFI_TEST_ANNOUNCED_URL="https://$TEST_HOST:$GW_PORT" \
LEFI_TEST_GATEWAY_URL="https://localhost:$GW_PORT" LEFI_TEST_GATEWAY_URL_IP="https://127.0.0.1:$GW_PORT" \
LEFI_TEST_GATEWAY_CA="$CA" LEFI_TEST_WRONG_CA="$T/wrong-ca.pem" LEFI_TEST_ADMIN_PASSWORD="$ADMIN_PW" \
LEFI_TEST_BRAIN_PY="$BRAIN_PY" LEFI_TEST_BRAIN_DIR="$ROOT/services/brain" LEFI_TEST_STATE="$T/state" \
  cargo test --manifest-path "$ROOT/apps/desktop/src-tauri/Cargo.toml" --test gateway_real -- --include-ignored --test-threads=1 ${SKIP_MDNS:+"--skip"} ${SKIP_MDNS:+"finds_the_announced_brain_and_sees_it_is_on"}
rc=$?

# ── Lefi Crop mobile (ADR-068): the same gateway, paired with its own code, signed in by username.
FLUTTER="${FLUTTER:-$(command -v flutter || true)}"
if [ -x "$FLUTTER" ]; then
  (
    cd "$ROOT/apps/lefi-mobile" || exit 1
    LEFI_TEST_GATEWAY_URL="https://localhost:$GW_PORT" LEFI_TEST_GATEWAY_URL_IP="https://127.0.0.1:$GW_PORT" \
    LEFI_TEST_BRAIN_PY="$BRAIN_PY" LEFI_TEST_BRAIN_DIR="$ROOT/services/brain" LEFI_TEST_STATE="$T/state" \
      "$FLUTTER" test test/integration/gateway_real_test.dart
  ) || rc=1
else
  echo "Lefi Crop mobile gateway test NOT RUN: Flutter not found (set FLUTTER=/path/to/flutter)"
fi
exit $rc
