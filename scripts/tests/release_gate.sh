#!/usr/bin/env bash
# Release gate: the checks that must pass before a Lefi Crop Helper package is built
# (`pnpm --filter @lefi/helper bundle` runs this first and stops when it fails).
# They travel the way a customer's request does:
#   - Lefi Brain's test suite, including the real `serve` (uvicorn) with a forwarded LAN address;
#   - desktop_gateway_real.sh: real Lefi Brain behind a real Caddy, Caddyfile rendered by the
#     installer, reached by name, by 127.0.0.1 and by this Mac's LAN IP.
# Caddy (a test tool, never installed as a service by this script): CADDY=…, `caddy` on PATH, or
# ~/.cache/lefi-crop/test-tools/caddy.
set -o pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
command -v uv >/dev/null || PATH="$HOME/.local/bin:$PATH"
command -v cargo >/dev/null || PATH="$HOME/.cargo/bin:$PATH"
CADDY="${CADDY:-$(command -v caddy || true)}"
[ -x "$CADDY" ] || CADDY="$HOME/.cache/lefi-crop/test-tools/caddy"
if [ ! -x "$CADDY" ]; then
  echo "✗ release gate: Caddy is needed to test Lefi Gateway for real."
  echo "  Install it (brew install caddy) or put a caddy binary in ~/.cache/lefi-crop/test-tools/caddy."
  exit 1
fi
export CADDY
# The LAN case (ADR-057) needs this Mac on a network; without it the gate cannot prove the path.
if [ -z "$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)" ]; then
  echo "✗ release gate: this Mac has no LAN address, so the gateway cannot be tested through the LAN. Connect it to a network."
  exit 1
fi

echo "· release gate 1/2: Lefi Brain tests (incl. the real serve)"
(cd "$ROOT/services/brain" && uv run pytest -q) >"${TMPDIR:-/tmp}/lefi-release-gate-brain.log" 2>&1 || {
  tail -30 "${TMPDIR:-/tmp}/lefi-release-gate-brain.log"; echo "✗ release gate: Lefi Brain tests failed"; exit 1; }

echo "· release gate 2/2: Lefi Desktop → real Lefi Gateway → real Lefi Brain (name, 127.0.0.1, LAN IP)"
"$ROOT/scripts/tests/desktop_gateway_real.sh" >"${TMPDIR:-/tmp}/lefi-release-gate-gateway.log" 2>&1 || {
  tail -40 "${TMPDIR:-/tmp}/lefi-release-gate-gateway.log"; echo "✗ release gate: the real gateway test failed"; exit 1; }
grep -q "test result: ok" "${TMPDIR:-/tmp}/lefi-release-gate-gateway.log" || {
  echo "✗ release gate: the real gateway test did not report its result"; exit 1; }
echo "· release gate passed"
