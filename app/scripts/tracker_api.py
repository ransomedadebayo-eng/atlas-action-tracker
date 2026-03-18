#!/usr/bin/env python3

import argparse
import json
import os
import pathlib
import sys
import urllib.parse
import urllib.error
import urllib.request


ROOT = pathlib.Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env"
DEFAULT_BASE_URL = os.environ.get("ATLAS_API_BASE_URL", "http://localhost:3001/api")


def load_env_value(key: str) -> str | None:
    if key in os.environ:
        return os.environ[key]

    if not ENV_PATH.exists():
        return None

    for line in ENV_PATH.read_text().splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        env_key, env_value = stripped.split("=", 1)
        if env_key == key:
            return env_value.strip().strip('"').strip("'")
    return None


def read_payload(payload_file: str | None) -> object:
    if payload_file:
        return json.loads(pathlib.Path(payload_file).read_text())

    raw = sys.stdin.read().strip()
    if not raw:
        return None
    return json.loads(raw)


def request_api(method: str, path: str, payload: object = None, actor: str | None = None) -> object:
    token = load_env_value("ATLAS_API_TOKEN")
    if not token:
        raise RuntimeError("ATLAS_API_TOKEN not found in environment or .env")

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    if actor:
        headers["X-Atlas-Actor"] = actor

    data = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")

    req = urllib.request.Request(
        url=f"{DEFAULT_BASE_URL}{path}",
        data=data,
        headers=headers,
        method=method.upper(),
    )

    try:
        with urllib.request.urlopen(req) as response:
            body = response.read().decode("utf-8")
            return json.loads(body) if body else None
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8")
        try:
            detail = json.loads(body)
        except json.JSONDecodeError:
            detail = {"error": body or exc.reason}
        raise RuntimeError(f"{exc.code} {detail.get('error', exc.reason)}") from exc


def get_action(action_id: str, actor: str | None = None) -> object:
    return request_api("GET", f"/actions/{action_id}", actor=actor)


def ensure_required_owner(action_id: str, required_owner: str, actor: str | None = None) -> None:
    action = get_action(action_id, actor=actor)
    owners = action.get("owners") or []
    if required_owner not in owners:
        raise RuntimeError(f"Action {action_id} is not owned by {required_owner}")


def main() -> int:
    parser = argparse.ArgumentParser(description="ATLAS Action Tracker API helper")
    subparsers = parser.add_subparsers(dest="command", required=True)

    def add_common(subparser: argparse.ArgumentParser) -> None:
        subparser.add_argument("--payload-file", help="Path to a JSON payload file. If omitted, reads JSON from stdin.")
        subparser.add_argument("--actor", default="claude", help="Actor name for the X-Atlas-Actor header.")

    commit_parser = subparsers.add_parser("commit-transcript", help="Commit parsed transcript results through the API")
    commit_parser.add_argument("--transcript-id", required=True, help="Transcript id to update")
    add_common(commit_parser)

    update_action_parser = subparsers.add_parser("update-action", help="Update one action through the API")
    update_action_parser.add_argument("--action-id", required=True, help="Action id to update")
    add_common(update_action_parser)

    bulk_create_parser = subparsers.add_parser("bulk-create-actions", help="Bulk-create actions through the API")
    add_common(bulk_create_parser)

    bulk_update_parser = subparsers.add_parser("bulk-update-actions", help="Bulk-update actions through the API")
    add_common(bulk_update_parser)

    list_actions_parser = subparsers.add_parser("list-actions", help="List actions through the API")
    list_actions_parser.add_argument("--owner-id")
    list_actions_parser.add_argument("--status")
    list_actions_parser.add_argument("--business")
    list_actions_parser.add_argument("--priority")
    list_actions_parser.add_argument("--search")
    list_actions_parser.add_argument("--limit", type=int)
    list_actions_parser.add_argument("--offset", type=int)
    list_actions_parser.add_argument("--sort-by")
    list_actions_parser.add_argument("--sort-dir")
    list_actions_parser.add_argument("--actor", default="claude", help="Actor name for the X-Atlas-Actor header.")

    get_action_parser = subparsers.add_parser("get-action", help="Fetch one action through the API")
    get_action_parser.add_argument("--action-id", required=True, help="Action id to fetch")
    get_action_parser.add_argument("--actor", default="claude", help="Actor name for the X-Atlas-Actor header.")

    delete_action_parser = subparsers.add_parser("delete-action", help="Delete one action through the API")
    delete_action_parser.add_argument("--action-id", required=True, help="Action id to delete")
    delete_action_parser.add_argument("--actor", default="claude", help="Actor name for the X-Atlas-Actor header.")
    delete_action_parser.add_argument("--require-owner", help="Require the current action owners to contain this member id before deleting.")

    update_action_parser.add_argument("--require-owner", help="Require the current action owners to contain this member id before updating.")
    bulk_update_parser.add_argument("--require-owner", help="Require the current action owners to contain this member id before updating.")

    args = parser.parse_args()
    payload = read_payload(getattr(args, "payload_file", None))

    if args.command == "commit-transcript":
        response = request_api("POST", f"/transcripts/{args.transcript_id}/commit", payload, args.actor)
    elif args.command == "update-action":
        if args.require_owner:
            ensure_required_owner(args.action_id, args.require_owner, actor=args.actor)
        response = request_api("PUT", f"/actions/{args.action_id}", payload, args.actor)
    elif args.command == "bulk-create-actions":
        response = request_api("POST", "/actions/bulk", payload, args.actor)
    elif args.command == "bulk-update-actions":
        updates = payload if isinstance(payload, list) else (payload or {}).get("updates", [])
        if args.require_owner:
            for item in updates:
                ensure_required_owner(item["id"], args.require_owner, actor=args.actor)
        response = request_api("PUT", "/actions/bulk", payload, args.actor)
    elif args.command == "list-actions":
        query = {
            "owner_id": args.owner_id,
            "status": args.status,
            "business": args.business,
            "priority": args.priority,
            "search": args.search,
            "limit": args.limit,
            "offset": args.offset,
            "sort_by": args.sort_by,
            "sort_dir": args.sort_dir,
        }
        encoded = urllib.parse.urlencode({key: value for key, value in query.items() if value not in (None, "")})
        path = "/actions"
        if encoded:
            path = f"{path}?{encoded}"
        response = request_api("GET", path, actor=args.actor)
    elif args.command == "get-action":
        response = get_action(args.action_id, actor=args.actor)
    elif args.command == "delete-action":
        if args.require_owner:
            ensure_required_owner(args.action_id, args.require_owner, actor=args.actor)
        response = request_api("DELETE", f"/actions/{args.action_id}", actor=args.actor)
    else:
        raise RuntimeError(f"Unsupported command: {args.command}")

    print(json.dumps(response, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1)
