#!/usr/bin/env bash
# Safe Brain update with the REAL Brain (ADR-036). Not part of `make test-shell` (needs uv,
# Python 3.12 and ~1 min): ./scripts/tests/brain_update_real.sh
# Everything lives in a temporary folder: three copies of this checkout's Brain — A (0.1.0),
# B (version 0.1.1) and C (version 0.1.2 with a migration that FAILS ON PURPOSE) — a temporary
# database, and Linux user-mode processes (simulated with a fake `uname`, so no launchd service
# of this Mac is touched) on a test port.
set -o pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
T="$(mktemp -d)"; PORT=18731
cleanup() { [ -f "$T/state/run/brain.pid" ] && kill "$(cat "$T/state/run/brain.pid")" 2>/dev/null; if [ "${KEEP:-0}" = 1 ]; then echo "kept: $T"; else rm -rf "$T"; fi; }
trap cleanup EXIT
PASSES=0; FAILS=0
expect() { if [ "$2" = "$3" ]; then PASSES=$((PASSES + 1)); echo "  ok    $1"; else FAILS=$((FAILS + 1)); echo "  FAIL  $1: got '$2', want '$3'"; fi; }
command -v uv >/dev/null || PATH="$HOME/.local/bin:$PATH"
command -v uv >/dev/null || { echo "uv is required"; exit 2; }

mkdir -p "$T/bin"; printf '#!/bin/sh\ncase "$1" in -s) echo Linux ;; -m) echo x86_64 ;; *) echo Linux ;; esac\n' >"$T/bin/uname"; chmod +x "$T/bin/uname"
export PATH="$T/bin:$PATH" LEFI_SERVICE_MODE=user LEFI_STATE_DIR="$T/state" ENV_FILE="$T/lefi.env" HOME="$T/home"
mkdir -p "$HOME"
# A copy of the installer + Brain sources (what Lefi Crop Helper carries), at a given Brain version.
payload() {  # payload DIR VERSION [broken]
  mkdir -p "$1/services"
  for d in bin scripts config deploy .env.example VERSION; do cp -R "$ROOT/$d" "$1/"; done
  ( cd "$ROOT/services" && tar -cf - --exclude .venv --exclude __pycache__ --exclude .pytest_cache --exclude .mypy_cache --exclude .ruff_cache brain ) | ( cd "$1/services" && tar -xf - )
  sed -i.bak "s/^version = \"[^\"]*\"/version = \"$2\"/" "$1/services/brain/pyproject.toml"
  # uv.lock records the project's own version; keep it consistent so --locked accepts it.
  awk -v v="$2" '/^name = "lefi-brain"$/{f=1} f && /^version = /{print "version = \"" v "\""; f=0; next} {print}' \
    "$1/services/brain/uv.lock" >"$1/services/brain/uv.lock.n" && mv "$1/services/brain/uv.lock.n" "$1/services/brain/uv.lock"
  if [ "${3:-}" = nostart ]; then
    # TEST ONLY: migrations pass, but `serve` exits at once (a Brain that cannot start).
    python3 - "$1/services/brain/src/lefi_brain/cli.py" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
s = s.replace("def cmd_serve(settings: Settings, args: argparse.Namespace) -> int:\n",
              "def cmd_serve(settings: Settings, args: argparse.Namespace) -> int:\n    raise SystemExit('test: Brain fails to start on purpose')\n", 1)
open(p, "w").write(s)
PY
  fi
  if [ "${3:-}" = broken ]; then
    cat >"$1/services/brain/src/lefi_brain/migrations/versions/20990101_9999_test_broken.py" <<'PY'
"""TEST ONLY: a migration that fails on purpose (brain_update_real.sh)."""
revision: str = "9999_test_broken"
down_revision: str | None = "0002_identity"
branch_labels = None
depends_on = None


def upgrade() -> None:
    raise RuntimeError("test migration failing on purpose")


def downgrade() -> None:
    pass
PY
  fi
}
payload "$T/A" 0.1.0; payload "$T/B" 0.1.1; payload "$T/C" 0.1.2 broken; payload "$T/D" 0.1.3 nostart

cat >"$ENV_FILE" <<EOF
LEFI_ROLES=core
LEFI_ENV=production
LEFI_API_HOST=127.0.0.1
LEFI_API_PORT=$PORT
LEFI_DATABASE_URL=sqlite+aiosqlite:///$T/state/data/lefi.db
LEFI_JWT_SECRET=test-secret-not-real-0123456789abcdef0123456789abcdef
EOF
chmod 600 "$ENV_FILE"; mkdir -p "$T/state/data" "$T/state/logs"

echo "== install Brain A (0.1.0) the way the core role does"
(
  LEFI_ROOT="$T/A"; export LEFI_ROOT
  for lib in common detect system journal role_core brain_update; do . "$LEFI_ROOT/scripts/lib/$lib.sh"; done
  LOG_FILE="$T/install-a.log"; : >"$LOG_FILE"; BU_PORT=$PORT
  env UV_PROJECT_ENVIRONMENT="$T/legacy-venv" uv sync -q --project "$LEFI_ROOT/services/brain" --python 3.12 --locked --no-dev --no-editable >>"$LOG_FILE" 2>&1 || exit 1
  env LEFI_ENV_FILE="$ENV_FILE" LEFI_STATE_DIR="$LEFI_STATE_DIR" "$T/legacy-venv/bin/python" -m lefi_brain db migrate >>"$LOG_FILE" 2>&1 || exit 1
  brain_start_with "$T/legacy-venv/bin/python"
  brain_wait_version 0.1.0 40
) || { echo "could not install A (see $T/install-a.log)"; tail -20 "$T/install-a.log"; exit 1; }
health() { curl -fsS -m 3 "http://127.0.0.1:$PORT/api/v1/health" 2>/dev/null | python3 -I -c 'import json,sys; print(json.load(sys.stdin)["version"])' 2>/dev/null; }
users() { "$1" -c 'import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); print(c.execute("select count(*) from audit_log").fetchone()[0])' "$T/state/data/lefi.db"; }
expect "A is running" "$(health)" "0.1.0"
audit_before="$(users python3)"

# An ACL from an older install (no enrolment/events/logs topics) and a stand-in process named
# "mosquitto" (built here, in this temp folder) that writes down every SIGHUP it receives.
mkdir -p "$T/state/mosquitto" "$T/state/run"
printf 'user lefi-brain\ntopic readwrite lefi/v1/#\n' >"$T/state/mosquitto/acl"; chmod 600 "$T/state/mosquitto/acl"
cat >"$T/fake-mosquitto.c" <<'C'
#include <signal.h>
#include <stdio.h>
#include <unistd.h>
static volatile sig_atomic_t hups = 0;
static void on_hup(int s) { (void)s; hups++; }
int main(int argc, char **argv) {
  signal(SIGHUP, on_hup);
  for (int i = 0; i < 600; i++) {
    if (hups) { FILE *f = fopen(argv[1], "w"); if (f) { fputs("reloaded\n", f); fclose(f); } hups = 0; }
    usleep(100000);
  }
  (void)argc;
  return 0;
}
C
cc -o "$T/bin/mosquitto" "$T/fake-mosquitto.c" || { echo "a C compiler is needed for this test"; exit 2; }
"$T/bin/mosquitto" "$T/mosquitto-hup" & FAKE_MOSQ=$!; echo "$FAKE_MOSQ" >"$T/state/run/mosquitto.pid"

echo "== update A → B (0.1.1)"
LEFI_ROOT="$T/B" "$T/B/scripts/install.sh" --update-brain --service-mode user --events ndjson >"$T/b.ndjson" 2>"$T/b.err"; rc=$?
expect "the broker ACL now allows board events and logs" \
  "$(grep -c 'lefi/v1/devices/%u/events\|lefi/v1/devices/%u/logs\|lefi/v1/enrol/%c/request' "$T/state/mosquitto/acl")" "3"
expect "the ACL stays private (600)" "$(stat -f %Lp "$T/state/mosquitto/acl" 2>/dev/null || stat -c %a "$T/state/mosquitto/acl")" "600"
sleep 0.5
expect "Mosquitto was asked to re-read it (SIGHUP)" "$(cat "$T/mosquitto-hup" 2>/dev/null)" "reloaded"
kill "$FAKE_MOSQ" 2>/dev/null
expect "update to B: exit 0, plan.done ok" "$rc $(grep -c '"event":"plan.done".*"result":"ok"' "$T/b.ndjson")" "0 1"
expect "B is running" "$(health)" "0.1.1"
expect "B runs from the versioned folder" "$(readlink "$T/state/runtime/brain/current")" "0.1.1"
expect "the database kept its rows (audit grew, nothing lost)" "$( [ "$(users python3)" -ge "$audit_before" ] && echo kept)" "kept"

db_rev() { python3 -c 'import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); print(c.execute("select version_num from alembic_version").fetchone()[0])' "$T/state/data/lefi.db"; }
rev_before_c="$(db_rev)"

echo "== update B → C (0.1.2, migration fails on purpose): must return to B by itself"
LEFI_ROOT="$T/C" "$T/C/scripts/install.sh" --update-brain --service-mode user --events ndjson >"$T/c.ndjson" 2>"$T/c.err"; rc=$?
expect "update to C refused with BRAIN_UPDATE_ROLLED_BACK" \
  "$rc $(grep -c '"code":"BRAIN_UPDATE_ROLLED_BACK"' "$T/c.ndjson")" "1 1"
expect "B is running again" "$(health)" "0.1.1"
expect "current still points to B" "$(readlink "$T/state/runtime/brain/current")" "0.1.1"
expect "the database is the copy from before the failed migration" "$(db_rev)" "$rev_before_c"

echo "== update B → D (0.1.3 migrates but cannot start): switched, then returns to B"
LEFI_ROOT="$T/D" "$T/D/scripts/install.sh" --update-brain --service-mode user --events ndjson >"$T/d.ndjson" 2>"$T/d.err"; rc=$?
expect "update to D refused with BRAIN_UPDATE_ROLLED_BACK" "$rc $(grep -c '"code":"BRAIN_UPDATE_ROLLED_BACK"' "$T/d.ndjson")" "1 1"
expect "B is running again after D" "$(health)" "0.1.1"
expect "current points back to B" "$(readlink "$T/state/runtime/brain/current")" "0.1.1"

echo "== same version again: nothing to do"
LEFI_ROOT="$T/B" "$T/B/scripts/install.sh" --update-brain --service-mode user --events ndjson >"$T/b2.ndjson" 2>/dev/null; rc=$?
expect "no-op update exits 0 and leaves B running" "$rc $(health)" "0 0.1.1"

echo; echo "Brain update (real): $PASSES passed, $FAILS failed"
[ "$FAILS" = 0 ]
