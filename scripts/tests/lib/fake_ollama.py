"""TEST ONLY fake AI node for desktop_gateway_real.sh: answers Ollama's /api/tags and /api/chat.

It never pretends to be a model: the first reply asks Lefi Brain for the `greenhouse_overview`
tool, the second quotes what the tool returned. Usage: python3 fake_ollama.py PORT MODEL
"""

import json
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT, MODEL = int(sys.argv[1]), sys.argv[2]


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, body: object) -> None:
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:
        if self.path == "/api/tags":
            self._send(200, {"models": [{"name": MODEL}]})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self) -> None:
        body = json.loads(self.rfile.read(int(self.headers["content-length"])))
        last = body["messages"][-1]
        props = (body.get("format") or {}).get("properties") or {}
        if "attention" in props:  # a plant's summary (ADR-109): a TEST answer in its shape
            text = json.dumps({"summary": "TEST fake AI summary of the plant's facts.", "attention": []})
            msg = {"role": "assistant", "content": text}
        elif last["role"] == "tool":
            msg = {"role": "assistant", "content": f"TEST fake AI read: {last['content'][:200]}"}
        else:
            call = {"function": {"name": "greenhouse_overview", "arguments": {}}}
            msg = {"role": "assistant", "content": "", "tool_calls": [call]}
        self._send(200, {"model": MODEL, "message": msg, "done": True})

    def log_message(self, *_: object) -> None:
        pass


HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
