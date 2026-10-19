#!/usr/bin/env python3
"""Atlas focus browser fixture backed by the exact proposal in disposable PostgreSQL.

Build app/dist, initialize/apply the proposal to a marked local cluster, then:
  python3 docs/atlas-focus/browser-fixture.py --cluster /tmp/atlas-focus-pg-... --port 4190

Other Atlas APIs use synthetic in-memory data. Focus APIs call real SQL RPCs
as the existing service-role shape. No requests are proxied, no credentials
are read, and no production data is loaded. /__qa/focus contains local-only
expiry/project-rename controls; production has no clock-control parameter.
Worker HTTP validation/authentication is covered separately by Worker tests.
"""
import argparse
import base64
import copy
import html
import importlib.util
import json
from pathlib import Path
import sys
from urllib.parse import parse_qs, urlparse
from http.server import ThreadingHTTPServer

from local_db import LocalDatabase

BASE = Path(__file__).resolve().parents[1] / "atlas-simplification"
sys.path.insert(0, str(BASE))
spec = importlib.util.spec_from_file_location("atlas_base_fixture", BASE / "browser-fixture.py")
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)


class FocusState(base.FixtureState):
    def __init__(self, cluster):
        self.db = LocalDatabase(cluster)
        self.storage_available = True
        super().__init__()
        self.db.sync_projects(self.data["projects"].values())

    def route(self, method, path, query, body):
        if path != "/api/focus" and not path.startswith("/api/focus/"):
            return super().route(method, path, query, body)
        if not self.storage_available:
            raise base.ApiError(503, "FOCUS_STORAGE_UNAVAILABLE", "Focus storage is unavailable pending the reviewed database setup.")
        try:
            if method == "GET" and path == "/api/focus":
                return self.db.rpc("atlas_focus_get_state", "ransomed"), 200
            if method == "POST" and path == "/api/focus/commands":
                result = self.db.rpc("atlas_focus_command", "ransomed", body)
                return result, 200
            if method == "GET" and path == "/api/focus/history":
                cursor = None
                if query.get("cursor"):
                    try:
                        cursor = json.loads(base64.urlsafe_b64decode(query["cursor"] + "=" * (-len(query["cursor"]) % 4)))
                    except (ValueError, KeyError):
                        raise base.ApiError(400, "INVALID_CURSOR", "Invalid focus history cursor.")
                result = self.db.rpc("atlas_focus_history", "ransomed", int(query.get("limit", 20)),
                                     cursor.get("ended_at") if cursor else None,
                                     cursor.get("id") if cursor else None, query.get("project_id") or None)
                if result.get("next_cursor"):
                    result["next_cursor"] = base64.urlsafe_b64encode(json.dumps(result["next_cursor"]).encode()).decode().rstrip("=")
                return result, 200
            raise base.ApiError(404, "NOT_FOUND", "Unknown focus fixture endpoint.")
        except RuntimeError as error:
            message = str(error)
            known = ["REVISION_CONFLICT", "OPERATION_CONFLICT", "PROJECT_NOT_FOUND", "PROJECT_UNAVAILABLE", "INVALID_FOCUS_COMMAND", "INVALID_FOCUS_STATE", "INVALID_FOCUS_SETTINGS", "INVALID_REQUEST"]
            code = next((item for item in known if item in message), None)
            if code:
                status = 409 if code.endswith("CONFLICT") or code in {"PROJECT_UNAVAILABLE", "INVALID_FOCUS_STATE"} else 400
                raise base.ApiError(status, code, message.splitlines()[0])
            if "does not exist" in message:
                raise base.ApiError(503, "FOCUS_STORAGE_UNAVAILABLE", "Focus storage is awaiting the reviewed database setup.")
            raise base.ApiError(500, "FOCUS_QA_DATABASE_ERROR", message.splitlines()[0])

    def expire(self):
        # Shift local timestamps by the same interval, keeping duration/elapsed
        # invariants intact while exercising the unmodified completion RPC.
        return self.db.sql("""
          update public.atlas_focus_state set
            deadline_at = deadline_at - (greatest(deadline_at - clock_timestamp(), interval '0') + interval '1 second'),
            running_since = running_since - (greatest(deadline_at - clock_timestamp(), interval '0') + interval '1 second'),
            started_at = started_at - (greatest(deadline_at - clock_timestamp(), interval '0') + interval '1 second')
          where owner_id='ransomed' and status='running';
        """)


class Handler(base.Handler):
    def qa_controls(self, path, query, body):
        if path != "/__qa/focus":
            return super().qa_controls(path, query, body)
        action = (body or {}).get("action") if self.command == "POST" else query.get("action")
        if action == "expire":
            self.state.expire()
        elif action in {"storage_unavailable", "restore_storage"}:
            self.state.storage_available = action == "restore_storage"
        elif action in {"rename", "archive", "restore"}:
            project = self.state.data["projects"]["p1"]
            if action == "rename":
                project["name"] = "Atlas renamed after session start"
            else:
                project["status"] = "archived" if action == "archive" else "in_progress"
            self.state.db.sync_projects([project])
        result = dict(synthetic_only=True, state=self.state.db.rpc("atlas_focus_get_state", "ransomed"), history=self.state.db.rpc("atlas_focus_history", "ransomed", 100))
        if self.command == "POST" or query.get("format") == "json":
            return self.send_json(result)
        markup = "<!doctype html><meta charset=utf-8><title>Atlas focus synthetic controls</title><style>body{font:16px system-ui;max-width:1000px;margin:30px auto;padding:20px}a{display:inline-block;margin:8px}pre{white-space:pre-wrap;background:#eee;padding:15px}</style><h1>Focus: local PostgreSQL controls</h1><p>Synthetic disposable cluster only. The production timer RPC is unmodified.</p><a href='/focus'>Open Focus</a><a href='/__qa/focus?action=expire'>Expire current running session</a><a href='/__qa/focus?action=rename'>Rename seed project</a><a href='/__qa/focus?action=archive'>Archive seed project</a><a href='/__qa/focus?action=restore'>Restore seed project</a><a href='/__qa/focus?action=storage_unavailable'>Simulate missing storage</a><a href='/__qa/focus?action=restore_storage'>Restore storage responses</a><pre>" + html.escape(json.dumps(result, indent=2)) + "</pre>"
        raw = markup.encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--cluster", type=Path, required=True)
    parser.add_argument("--port", type=int, default=4190)
    parser.add_argument("--dist", type=Path, default=Path(__file__).resolve().parents[2] / "app" / "dist")
    parser.add_argument("--events", type=Path)
    args = parser.parse_args()
    if not (args.dist / "index.html").is_file():
        parser.error("Build app/dist first.")
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    server.daemon_threads = True
    server.dist = args.dist.resolve()
    server.events = args.events.resolve() if args.events else None
    server.state = FocusState(args.cluster)
    print(f"Synthetic Atlas + real local focus RPCs: http://127.0.0.1:{args.port}/focus", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
