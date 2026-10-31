"""Local server for the Living Dex app.

Serves the app and stores caught progress in progress.json next to this file,
so it survives browser restarts and clearing browser data.

    python server.py            # http://localhost:8642
    python server.py --port 9000
"""
import argparse
import json
import os
import shutil
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PROGRESS = ROOT / "progress.json"
BACKUP_DIR = ROOT / "backups"
MAX_BACKUPS = 20


def read_progress():
    if not PROGRESS.exists():
        return {"caught": []}
    return json.loads(PROGRESS.read_text(encoding="utf8"))


def write_progress(data):
    # Keep a timestamped copy of the previous file (at most one per minute), then write atomically.
    if PROGRESS.exists():
        BACKUP_DIR.mkdir(exist_ok=True)
        stamp = datetime.now().strftime("%Y-%m-%d_%H-%M")
        backup = BACKUP_DIR / f"progress_{stamp}.json"
        if not backup.exists():
            shutil.copy2(PROGRESS, backup)
            for old in sorted(BACKUP_DIR.glob("progress_*.json"))[:-MAX_BACKUPS]:
                old.unlink()
    tmp = PROGRESS.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf8")
    os.replace(tmp, PROGRESS)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def send_json(self, status, payload):
        body = json.dumps(payload).encode("utf8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/api/progress":
            return self.send_json(200, read_progress())
        if self.path.startswith(("/progress.json", "/backups", "/server.py")):
            return self.send_error(404)
        return super().do_GET()

    def do_PUT(self):
        if self.path != "/api/progress":
            return self.send_error(404)
        try:
            data = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
            if not isinstance(data.get("caught"), list) or not all(isinstance(x, str) for x in data["caught"]):
                raise ValueError("caught must be a list of strings")
        except (ValueError, json.JSONDecodeError) as e:
            return self.send_json(400, {"error": str(e)})
        write_progress({"caught": sorted(set(data["caught"])), "saved": datetime.now().isoformat(timespec="seconds")})
        self.send_json(200, {"ok": True})

    def end_headers(self):
        # Always serve fresh app files so updates show up without a hard refresh.
        if not self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, fmt, *args):
        if self.command == "PUT" or not str(args[1] if len(args) > 1 else "").startswith(("2", "3")):
            super().log_message(fmt, *args)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8642)
    port = parser.parse_args().port
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"Living Dex running at http://localhost:{port}  (progress saved to {PROGRESS})")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
