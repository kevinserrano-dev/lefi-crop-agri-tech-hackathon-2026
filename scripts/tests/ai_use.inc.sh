# shellcheck shell=bash
# `lefi ai use URL` against a FAKE Ollama HTTP server (python, random port) — never the real one.
# Sourced by run.sh (uses its helpers and $LINUX_BIN).

echo "== lefi ai use (fake Ollama server, temporary state)"
U="$TMP/ai-use"; mkdir -p "$U/state"
cat >"$U/fake_ollama.py" <<'PY'
# FAKE Ollama for tests: answers the endpoints `lefi ai use` calls. The model tag must be one of
# config/supported-models.tsv for the check to pass; GPU share comes from argv[2] (percent).
import json, sys
from http.server import BaseHTTPRequestHandler, HTTPServer
share = int(sys.argv[2]); size = 8_000_000_000
class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def reply(self, obj):
        b = json.dumps(obj, separators=(",", ":")).encode(); self.send_response(200)  # compact, like Ollama
        self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(b)))
        self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if self.path == "/api/version": self.reply({"version": "0.0.0-fake"})
        elif self.path == "/api/tags": self.reply({"models": [{"name": "gemma4:12b"}]})
        elif self.path == "/api/ps": self.reply({"models": [{"name": "gemma4:12b", "model": "gemma4:12b",
            "size": size, "size_vram": size * share // 100, "context_length": 4096}]})
        else: self.send_error(404)
    def do_POST(self):
        self.rfile.read(int(self.headers.get("Content-Length", 0)))
        if self.path == "/api/generate": self.reply({"response": "OK", "done": True})
        else: self.send_error(404)
srv = HTTPServer(("127.0.0.1", 0), H)
open(sys.argv[1], "w").write(str(srv.server_address[1])); srv.serve_forever()
PY
ai_use_run() {  # ai_use_run SHARE_PCT ROLES -> JSON in $U/out.json, exit code in $rc
  rm -f "$U/port"; printf 'LEFI_ROLES=%s\n' "$2" >"$U/lefi.env"
  python3 -I "$U/fake_ollama.py" "$U/port" "$1" & local srv=$!
  local i=0; while [ ! -s "$U/port" ] && [ "$i" -lt 50 ]; do sleep 0.1; i=$((i + 1)); done
  PATH="$LINUX_BIN:$PATH" HOME="$U" LEFI_SERVICE_MODE=user LEFI_STATE_DIR="$U/state" ENV_FILE="$U/lefi.env" \
    "$ROOT/bin/lefi" ai use "http://127.0.0.1:$(cat "$U/port")" --json >"$U/out.json" 2>"$U/err.txt"; rc=$?
  kill "$srv" 2>/dev/null; wait "$srv" 2>/dev/null
}
jfield() { python3 -I -c 'import json,sys; d=json.loads(open(sys.argv[1]).read().strip().splitlines()[-1]); print(d[sys.argv[2]])' "$U/out.json" "$1" 2>&1; }

ai_use_run 100 core
expect_eq "ai use: 100% on GPU -> Brain pointed at the node" \
  "$rc $(jfield result) $(jfield model) $(grep -c '^OLLAMA_BASE_URL=http://127.0.0.1:' "$U/lefi.env") $(grep -c '^LEFI_AI_GATE=passed' "$U/lefi.env")" \
  "0 ok gemma4:12b 1 1"
ai_use_run 50 core
expect_eq "ai use: 50% on GPU -> refused, configuration unchanged" \
  "$rc $(jfield code) $(grep -c '^OLLAMA_BASE_URL' "$U/lefi.env")" "1 AI_NOT_VIABLE 0"
ai_use_run 100 ai
expect_eq "ai use: refused on a PC without the Brain" "$rc $(jfield code)" "1 NO_BRAIN"
PATH="$LINUX_BIN:$PATH" HOME="$U" LEFI_SERVICE_MODE=user LEFI_STATE_DIR="$U/state" ENV_FILE="$U/lefi.env" \
  "$ROOT/bin/lefi" ai use 'http://x;reboot:1' --json >"$U/out.json" 2>/dev/null; rc=$?
expect_eq "ai use: a malformed address is refused before any request" "$rc $(jfield code)" "1 BAD_URL"

: >"$U/lefi.env"; rm -f "$U/state/services/ollama.svc"
PATH="$LINUX_BIN:$PATH" HOME="$U" LEFI_SERVICE_MODE=user LEFI_STATE_DIR="$U/state" ENV_FILE="$U/lefi.env" \
  "$ROOT/bin/lefi" ai use 'http://127.0.0.1:1' --json >"$U/out.json" 2>/dev/null; rc=$?
expect_eq "ai use: a PC with nothing installed answers NO_BRAIN, not a role error" "$rc $(jfield code)" "1 NO_BRAIN"
