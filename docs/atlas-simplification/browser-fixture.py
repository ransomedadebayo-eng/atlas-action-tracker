#!/usr/bin/env python3
"""Portable, synthetic-only Atlas UI fixture server (Python 3.9+, standard library).

Build app/dist separately, then run:
  python3 docs/atlas-simplification/browser-fixture.py --port 4188
  python3 docs/atlas-simplification/browser-fixture.py --self-check

No requests are forwarded. All state lives in this server process and survives
browser reloads. Restart or POST /__qa/reset to restore the seed. Nothing is
written to the Atlas backend. Optional --events logs synthetic requests locally.

QA controls, separate from the production app:
  GET /__qa                       standalone controls and fixture links
  GET /__qa/state                 complete synthetic state
  GET /__qa/requests              recent request/response summaries
  POST /__qa {"scope":"/api/actions","mode":"error","methods":["PUT"]}
  POST /__qa {"scope":"/api/projects","mode":"loading","delay_ms":4000}
  POST /__qa {"scope":"/api/projects","mode":"empty"}
  POST /__qa {"scope":"/api/projects","mode":"normal"}
  POST /__qa/clear                clear all modes without resetting edited data
  POST /__qa/reset                reset edited data and modes
GET /__qa?scope=/api/projects&mode=empty also configures a mode. Scopes match
exact paths or path prefixes at a slash boundary; the longest match wins.
Modes default to GET only. methods:["POST","PUT"] targets mutation errors.
?qa=empty|error|loading&qa_delay_ms=4000 can override one direct API request.
Loading delays (0-30000 ms) return normal data afterward; no request hangs.
Empty detail requests return 404. Error responses identify synthetic QA mode.

Documents support the app's WebSocket snapshot/edit/presence messages, REST
fallback edits, revision conflicts, version history and revert. Conflict handling
is deliberately conservative; it does not emulate production three-way merges.
External integration verification/delivery is explicitly disabled, even for
synthetic connection rows. Unsupported endpoints fail explicitly (never proxy).
"""
import argparse
import base64
import copy
import hashlib
import html
import io
import json
import re
import struct
import sys
import threading
import time
import uuid
from collections import Counter, deque
from datetime import date, datetime, timedelta, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from browser_fixture_data import seed_data

STATUSES = {"open", "not_started", "in_progress", "waiting", "blocked", "done", "canceled", "archived"}
ALIASES = dict(triage="open", todo="not_started", backlog="not_started", completed="done", closed="done", cancelled="canceled")
TERMINAL = {"done", "canceled", "archived"}
RETIRED = {"cycles", "initiatives", "templates", "releases", "insights", "dashboards", "exports", "workflows", "triage"}
ACTION_FIELDS = set("title description status business priority due_date owners source_transcript_id source_label tags notes recurrence work_mode next_action definition_of_done review_date evidence_json agent_assignment_id approval_state estimate_points".split())
PROJECT_FIELDS = set("name summary description business status health priority lead_id members start_date target_date color icon update_frequency".split())
TEXT_LIMITS = dict(title=500, name=200, description=5000, notes=10000, append_note=10000, summary=10000, source_label=500)
CATEGORIES = {"all", "assignments", "mentions", "status_changes", "comments", "project_updates", "documents", "system"}
CHANNELS = {"inbox", "browser", "email", "slack", "webhook"}


def now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def canonical(value):
    value = str(value or "").strip().lower()
    return ALIASES.get(value, value)


def new_id(prefix):
    return prefix + "-" + uuid.uuid4().hex[:12]


def timestamp(value):
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (ValueError, TypeError, AttributeError):
        return None


def is_date(value):
    try:
        return isinstance(value, str) and date.fromisoformat(value).isoformat() == value
    except ValueError:
        return False


def sanitized(body, fields):
    return {key: re.sub(r"<[^>]*>", "", value).strip() if key in fields and isinstance(value, str) else value
            for key, value in body.items()}


class ApiError(Exception):
    def __init__(self, status, code, message):
        self.status, self.code, self.message = status, code, message
        super().__init__(message)


def require(condition, message, code="INVALID_REQUEST", status=400):
    if not condition:
        raise ApiError(status, code, message)


class FixtureState:
    def __init__(self):
        self.lock = threading.RLock()
        self.peers = {}
        self.requests = deque(maxlen=500)
        self.reset()

    def reset(self):
        with self.lock:
            require(not any(self.peers.values()), "Close document tabs before resetting the fixture.", "QA_DOCUMENT_OPEN", 409)
            self.data = seed_data()
            self.modes = {}
            self.requests.clear()

    def configure(self, body):
        scope = str(body.get("scope", "/api"))
        mode = body.get("mode", "normal")
        require(scope.startswith("/api") and "?" not in scope, "scope must be an /api path prefix.")
        require(mode in {"normal", "empty", "error", "loading"}, "Unknown QA mode.")
        methods = body.get("methods", [body.get("method", "GET")])
        if isinstance(methods, str):
            methods = [methods]
        require(isinstance(methods, list) and all(value in {"GET", "POST", "PUT", "ALL"} for value in methods), "Invalid QA methods.")
        delay = int(body.get("delay_ms", 4000))
        require(0 <= delay <= 30000, "delay_ms must be 0-30000.")
        with self.lock:
            if mode == "normal":
                self.modes.pop(scope, None)
            else:
                self.modes[scope] = dict(mode=mode, delay_ms=delay, methods=methods)
            return copy.deepcopy(self.modes)

    def mode_for(self, method, path, query):
        if query.get("qa"):
            return dict(mode=query["qa"], delay_ms=min(30000, max(0, int(query.get("qa_delay_ms", 4000)))))
        with self.lock:
            matches = [(scope, rule) for scope, rule in self.modes.items()
                       if (path == scope or path.startswith(scope.rstrip("/") + "/"))
                       and (method in rule["methods"] or "ALL" in rule["methods"])]
            return copy.deepcopy(max(matches, key=lambda pair: len(pair[0]))[1]) if matches else {}

    def get(self, kind, key):
        row = self.data[kind].get(key)
        require(row is not None, kind.rstrip("s").replace("_", " ").title() + " not found.", kind.rstrip("s").upper() + "_NOT_FOUND", 404)
        return row

    def revision(self, row, body, required=False, key="expected_revision"):
        value = body.get(key)
        require(not required or type(value) is int, key + " is required.", "INVALID_REVISION")
        if value is not None:
            require(type(value) is int and value >= 0, key + " must be a non-negative integer.", "INVALID_REVISION")
            require(value == row.get("revision", 0), "The record changed. Refresh and retry.", "REVISION_CONFLICT", 409)

    def touch(self, row):
        row.update(revision=row.get("revision", 0) + 1, updated_at=now(), updated_by="codex")
        return row

    def activity(self, action_id, event, body):
        self.data["activity"].insert(0, dict(id=new_id("activity"), action_id=action_id, event=event, actor="codex", new_value=json.dumps(body), created_at=now()))

    def validate_lengths(self, body):
        for key, maximum in TEXT_LIMITS.items():
            if isinstance(body.get(key), str):
                require(len(body[key]) <= maximum, f"{key} exceeds maximum length of {maximum} characters")

    def validate_refs(self, body):
        if body.get("business"):
            require(body["business"] in {row["id"] for row in self.data["businesses"]}, "business must reference a known business")
        for key in ["owners", "members"]:
            if key in body:
                require(isinstance(body[key], list) and all(isinstance(value, str) and value in {row["id"] for row in self.data["members"]} for value in body[key]), key + " must contain known principal ids")
        if body.get("lead_id"):
            require(body["lead_id"] in {row["id"] for row in self.data["members"]}, "lead_id must reference a known principal")

    def validate_action(self, body, create=False):
        result = sanitized(body, ACTION_FIELDS - {"business", "status", "priority", "recurrence", "work_mode", "owners", "tags", "evidence_json"})
        if "status" in result:
            result["status"] = canonical(result["status"])
            require(result["status"] in STATUSES, "status must be one of: " + ", ".join(sorted(STATUSES)))
            require(result["status"] not in {"done", "archived"}, "Use the completion or archive endpoint.", "EXPLICIT_TRANSITION_REQUIRED")
        if create:
            require(result.get("title") and result.get("business"), "title and business are required")
        if "priority" in result:
            result["priority"] = dict(critical="p0", high="p1", medium="p2", low="p3").get(result["priority"], result["priority"])
            require(result["priority"] in {"p0", "p1", "p2", "p3"}, "priority must be p0, p1, p2, or p3")
        if "tags" in result:
            require(isinstance(result["tags"], list) and all(isinstance(value, str) for value in result["tags"]), "tags must be an array of strings")
        for key in ["due_date", "review_date"]:
            if key in result and result[key] not in [None, ""]:
                require(is_date(result[key]), key + " must be in YYYY-MM-DD format or null")
        if result.get("work_mode"):
            require(result["work_mode"] in {"autonomous", "review_required", "user_only"}, "work_mode is invalid")
        if result.get("approval_state"):
            require(result["approval_state"] in {"not_required", "needs_review", "approved", "rejected", "deferred", "user_only"}, "approval_state is invalid")
        if result.get("recurrence"):
            require(result["recurrence"] in {"none", "daily", "weekly", "biweekly", "monthly"}, "recurrence is invalid")
        if result.get("evidence_json") is not None:
            require(isinstance(result.get("evidence_json", {}), dict), "evidence_json must be an object")
        if result.get("estimate_points") not in [None, ""]:
            require(type(result["estimate_points"]) is int and 0 <= result["estimate_points"] <= 100000, "estimate_points must be a non-negative integer up to 100000 or null")
        self.validate_lengths(result)
        self.validate_refs(result)
        return {key: value for key, value in result.items() if key in ACTION_FIELDS}

    def create_action(self, body):
        fields = self.validate_action(body, True)
        row = dict(id=new_id("action"), title="", description="", notes="", status="not_started", business=None,
                   priority="p2", owners=["ransomed"], tags=[], recurrence="none", work_mode=None, approval_state="not_required",
                   evidence_json={}, due_date=None, review_date=None, next_action=None, definition_of_done=None, estimate_points=None,
                   project_id=None, project_milestone_id=None, parent_action_id=None, archived_at=None, completed_at=None,
                   revision=0, created_at=now(), updated_at=now(), resolution=None, blocked_by=[])
        row.update(fields)
        row["identifier"] = "ATLAS-QA-" + str(len(self.data["actions"]) + 1)
        self.data["actions"][row["id"]] = row
        self.activity(row["id"], "created", fields)
        return row

    def action_rows(self, query):
        rows = list(self.data["actions"].values())
        for key in ["business", "priority", "work_mode", "approval_state", "resolution", "project_id", "parent_action_id"]:
            if query.get(key):
                values = query[key].split(",")
                rows = [row for row in rows if (row.get(key) in [None, ""] if "__null__" in values else row.get(key) in values)]
        if query.get("status"):
            allowed = {canonical(value) for value in query["status"].split(",")}
            rows = [row for row in rows if canonical(row.get("status")) in allowed]
        elif query.get("include_archived") != "true":
            rows = [row for row in rows if canonical(row["status"]) != "archived" and not row.get("archived_at")]
        if query.get("open") == "true":
            rows = [row for row in rows if canonical(row["status"]) not in TERMINAL and not row.get("archived_at")]
        if query.get("owner_id"):
            rows = [row for row in rows if query["owner_id"] in row.get("owners", [])]
        if query.get("has_blocked_by") == "true":
            rows = [row for row in rows if row.get("blocked_by")]
        if query.get("exclude_approval_state"):
            rows = [row for row in rows if row.get("approval_state") not in query["exclude_approval_state"].split(",")]
        if query.get("search"):
            term = query["search"].lower()
            rows = [row for row in rows if term in " ".join(str(row.get(key) or "") for key in ["title", "description", "notes", "identifier"]).lower()]
        if query.get("completed_within"):
            match = re.fullmatch(r"(\d+)h", query["completed_within"])
            if match:
                cutoff = datetime.now(timezone.utc) - timedelta(hours=int(match[1]))
                rows = [row for row in rows if timestamp(row.get("completed_at")) and timestamp(row["completed_at"]) >= cutoff]
        sort_by = query.get("sort_by", "priority")
        rows.sort(key=lambda row: str(row.get(sort_by) or "zzzz"), reverse=query.get("sort_dir") == "desc")
        return rows

    def page(self, rows, query):
        limit, offset = min(200, max(1, int(query.get("limit", 50)))), max(0, int(query.get("offset", 0)))
        return dict(items=rows[offset:offset + limit], total=len(rows), page_size=limit, has_more=offset + limit < len(rows))

    def project_detail(self, row):
        actions = [action for action in self.data["actions"].values() if action.get("project_id") == row["id"] and not action.get("archived_at") and action["status"] != "archived"]
        completed = [action for action in actions if canonical(action["status"]) == "done"]
        open_actions = [action for action in actions if canonical(action["status"]) in {"open", "not_started", "in_progress", "waiting", "blocked"}]
        updates = [update for update in self.data["project_updates"].values() if update["project_id"] == row["id"]]
        dates = [timestamp(value) for value in [row.get("updated_at")] + [action.get("updated_at") for action in actions] + [update.get("created_at") for update in updates]]
        last = max([value for value in dates if value], default=None)
        created = [timestamp(action.get("created_at")) for action in open_actions]
        created = [value for value in created if value]
        effort = lambda values: sum(action.get("estimate_points") if type(action.get("estimate_points")) is int else 1 for action in values)
        total_effort, completed_effort = effort(actions), effort(completed)
        dependencies = []
        for dependency in self.data["dependencies"].values():
            if dependency.get("status", "active") != "active" or row["id"] not in [dependency["blocking_project_id"], dependency["blocked_project_id"]]:
                continue
            blocking = dependency["blocked_project_id"] == row["id"]
            other_id = dependency["blocking_project_id"] if blocking else dependency["blocked_project_id"]
            dependencies.append(dict(dependency, direction="blocked_by" if blocking else "blocking", related_project=self.data["projects"].get(other_id)))
        return dict(row, actions=actions, updates=sorted(updates, key=lambda value: value["created_at"], reverse=True),
                    milestones=[value for value in self.data["milestones"].values() if value["project_id"] == row["id"]], dependencies=dependencies, activity=[],
                    progress=dict(total_issues=len(actions), completed_issues=len(completed), blocked_issues=sum(action["status"] == "blocked" for action in actions), active_issues=len(actions) - len(completed), total_effort=total_effort, completed_effort=completed_effort, progress_percent=round(completed_effort / total_effort * 100) if total_effort else 0),
                    open_action_count=len(open_actions), oldest_open_days=max(0, (datetime.now(timezone.utc) - min(created)).days) if created else None,
                    last_activity_at=last.isoformat().replace("+00:00", "Z") if last else None, is_stale=bool(row["status"] == "in_progress" and last and last < datetime.now(timezone.utc) - timedelta(days=14)))

    def validate_project(self, body, partial=False):
        fields = sanitized({key: value for key, value in body.items() if key in PROJECT_FIELDS}, PROJECT_FIELDS - {"members", "status", "health", "priority"})
        require(partial or fields.get("name"), "name is required", "INVALID_PROJECT")
        if "name" in fields:
            require(isinstance(fields["name"], str) and fields["name"], "name must be a non-empty string", "INVALID_PROJECT")
        for key, allowed in dict(status={"backlog", "planned", "in_progress", "paused", "completed", "canceled", "archived"}, health={"on_track", "at_risk", "off_track", "no_update"}, update_frequency={"weekly", "biweekly", "monthly", "never"}).items():
            if key in fields:
                require(fields[key] in allowed, key + " is invalid", "INVALID_PROJECT")
        for key in ["start_date", "target_date"]:
            if fields.get(key):
                require(is_date(fields[key]), key + " must be a valid YYYY-MM-DD date or null", "INVALID_PROJECT")
        if fields.get("start_date") and fields.get("target_date"):
            require(fields["start_date"] <= fields["target_date"], "start_date must not be after target_date", "INVALID_PROJECT")
        self.validate_lengths(fields)
        self.validate_refs(fields)
        return fields

    def document_detail(self, document):
        key = document["id"]
        return dict(document, versions=self.data["document_versions"].get(key, []), activity=[], operations=self.data["document_operations"].get(key, []), conflicts=self.data["document_conflicts"].get(key, []))

    def validate_document(self, body, partial=False):
        if "title" in body or not partial:
            require(isinstance(body.get("title"), str) and 0 < len(body["title"].strip()) <= 500, "title must be 1-500 characters", "INVALID_DOCUMENT")
        if "content" in body:
            require(isinstance(body["content"], str) and len(body["content"].encode()) <= 204800, "content must be Markdown text up to 200 KiB", "INVALID_DOCUMENT")
        context = body.get("context_type", "workspace")
        require(context in {"workspace", "project", "action"}, "context_type is invalid", "INVALID_DOCUMENT")
        require(context != "workspace" or not body.get("context_id"), "workspace documents cannot set context_id", "INVALID_DOCUMENT")
        if not partial and context != "workspace":
            require(body.get("context_id"), context + " documents require context_id", "INVALID_DOCUMENT")
        if body.get("context_id") and context != "workspace":
            self.get("projects" if context == "project" else "actions", body["context_id"])

    def edit_document(self, document, body, strategy="legacy_rest"):
        self.validate_document(body, True)
        operation_id = body.get("operation_id") or new_id("operation")
        prior = next((row for row in self.data["document_operations"].get(document["id"], []) if row["operation_id"] == operation_id), None)
        if prior:
            return document, prior
        self.revision(document, body, True)
        require(document["status"] != "archived", "Restore the document before editing it.", "DOCUMENT_ARCHIVED", 409)
        self.data["document_versions"].setdefault(document["id"], []).insert(0, dict(id=new_id("version"), document_id=document["id"], title=document["title"], content=document["content"], revision=document["revision"], actor="codex", created_at=now()))
        for key in ["title", "content", "context_type", "context_id", "icon", "color"]:
            if key in body:
                document[key] = body[key]
        self.touch(document)
        document["last_realtime_edit_at"] = now()
        operation = dict(id=new_id("doc-operation"), operation_id=operation_id, document_id=document["id"], actor="codex", client_id=body.get("client_id", "legacy-rest"), applied_revision=document["revision"], merge_strategy=strategy, created_at=now())
        self.data["document_operations"].setdefault(document["id"], []).insert(0, operation)
        self.data["document_versions"][document["id"]].insert(0, dict(id=new_id("version"), document_id=document["id"], title=document["title"], content=document["content"], revision=document["revision"], actor="codex", created_at=now()))
        # One version per revision, newest first.
        unique = {value["revision"]: value for value in reversed(self.data["document_versions"][document["id"]])}
        self.data["document_versions"][document["id"]] = sorted(unique.values(), key=lambda value: value["revision"], reverse=True)
        return document, operation

    def hydrate_week(self, row):
        if not row:
            return None
        result = copy.deepcopy(row)
        for item in result["items"]:
            item["action"] = copy.deepcopy(self.data["actions"].get(item.get("source_action_id")))
            item["action_current_as_of"] = now()
        result["diagnostics"] = dict(stale_calendar=any(value.get("coverage_status") in {"partial", "stale", "unavailable"} for value in result["commitments"]), missing_actions=[item["source_action_id"] for item in result["items"] if item.get("source_action_id") and not item["action"]])
        return result

    def week_payload(self, start, revision_id=None):
        require(is_date(start) and date.fromisoformat(start).weekday() == 0, "week_start must be a valid Pacific Monday.", "INVALID_WEEK_START")
        rows = sorted([value for value in self.data["weeks"].values() if value["week_start"] == start], key=lambda value: value["version"], reverse=True)
        find = lambda statuses: next((value for value in rows if value["status"] in statuses), None)
        published, draft = self.hydrate_week(find({"published"})), self.hydrate_week(find({"draft", "review_requested"}))
        selected = self.hydrate_week(next((value for value in rows if value["id"] == revision_id), None))
        chosen = selected or draft or published
        dates = [(date.fromisoformat(start) + timedelta(days=index)).isoformat() for index in range(7)]
        return dict(week_start=start, week_end=dates[-1], published=published, draft=draft, selected_revision=selected,
                    history=[{key: value.get(key) for key in ["id", "version", "status", "title", "summary", "revision", "created_at", "published_at"]} for value in rows],
                    days=[dict(date=value, items=[item for item in (chosen or {}).get("items", []) if item.get("plan_date") == value], commitments=[]) for value in dates], diagnostics=(chosen or {}).get("diagnostics", dict(stale_calendar=False, missing_actions=[])))

    def discussion(self, query):
        target_type, target_id = query.get("target_type"), query.get("target_id")
        require(target_type in {"action", "project", "document", "project_update", "comment"} and target_id, "target_type and target_id are required.", "INVALID_COMMENT_TARGET")
        comments = [row for row in self.data["comments"].values() if row["target_type"] == target_type and row["target_id"] == target_id]
        def reactions(kind, key):
            grouped = {}
            for reaction in self.data["reactions"].values():
                if reaction["target_type"] == kind and reaction["target_id"] == key and reaction["status"] == "active":
                    grouped.setdefault(reaction["emoji"], []).append("codex")
            return [dict(emoji=emoji, count=len(actors), actors=actors) for emoji, actors in grouped.items()]
        def hydrate(row):
            values = reactions("comment", row["id"])
            return dict(row, reactions=values, reacted_by_actor=[value["emoji"] for value in values])
        threads = [dict(hydrate(row), replies=[hydrate(reply) for reply in comments if reply.get("thread_root_id") == row["id"]]) for row in comments if not row.get("thread_root_id")]
        target_reactions = reactions(target_type, target_id)
        return dict(target_type=target_type, target_id=target_id, current_actor="codex", target_reactions=target_reactions, target_reacted_by_actor=[value["emoji"] for value in target_reactions], subscription=self.data["discussion_subscriptions"].get(target_type + ":" + target_id), threads=threads)

    def dispatch(self, method, path, body=None):
        url = urlparse(path)
        query = {key: values[-1] for key, values in parse_qs(url.query, keep_blank_values=True).items()}
        try:
            with self.lock:
                payload, status = self.route(method, unquote(url.path).rstrip("/"), query, body if body is not None else {})
                return copy.deepcopy(payload), status
        except ApiError as error:
            return dict(error=dict(code=error.code, message=error.message)), error.status

    def route(self, method, path, query, body):
        parts = path.strip("/").split("/")
        require(len(parts) >= 2 and parts[0] == "api", "Unknown fixture endpoint.", "QA_ENDPOINT_UNSUPPORTED", 404)
        resource = parts[1]
        if resource in RETIRED:
            raise ApiError(410, "ATLAS_SURFACE_RETIRED", "This Atlas surface is retired. Use Projects or Week.")
        require(method == "GET" or isinstance(body, dict) or (resource == "config" and parts[2:] == ["businesses"] and isinstance(body, list)), "A JSON object is required.", "INVALID_JSON")
        if method == "GET":
            return self.read(resource, parts[2:], query), 200
        if resource == "actions":
            return self.write_action(method, parts[2:], body)
        if resource == "projects":
            return self.write_project(method, parts[2:], body)
        if resource == "weeks":
            return self.write_week(method, parts[2:], body)
        if resource == "documents":
            return self.write_document(method, parts[2:], body)
        if resource == "comments":
            return self.write_comment(method, parts[2:], body)
        if resource == "notifications":
            return self.write_notification(method, parts[2:], body)
        return self.write_other(method, resource, parts[2:], body)

    def read(self, resource, tail, query):
        if resource == "config":
            if tail == ["businesses"]:
                return self.data["businesses"]
            if tail == ["estimates"]:
                return self.data.get("estimates", dict(enabled=True, scale="fibonacci", unestimated_value=1, options=[dict(value=value, label=str(value)) for value in [0, 1, 2, 3, 5, 8]]))
        if resource == "actions":
            if not tail:
                return self.page(self.action_rows(query), query)
            if tail == ["stats"]:
                rows = self.action_rows({key: value for key, value in query.items() if key == "business"})
                active = [row for row in rows if canonical(row["status"]) not in TERMINAL]
                overdue = sum(bool(row.get("due_date") and row["due_date"] < date.today().isoformat()) for row in active)
                blocked = sum(row["status"] == "blocked" for row in active)
                done = sum(canonical(row["status"]) == "done" for row in rows)
                return dict(total=len(rows), active_total=len(active), ready_not_overdue=sum(row["status"] != "blocked" and (not row.get("due_date") or row["due_date"] >= date.today().isoformat()) for row in active), overdue_active=overdue,
                            blocked_active=blocked, needs_review_active=sum(row.get("approval_state") == "needs_review" for row in active),
                            completedThisWeek=done, completed_this_week=done, active=len(active), total_active=len(active), totalActive=len(active), overdue=overdue,
                            blocked=blocked, pendingReview=1, pending_review=1)
            if tail[0] == "by-owner" and len(tail) == 2:
                return self.action_rows(dict(query, owner_id=tail[1]))
            row = self.get("actions", tail[0])
            if len(tail) == 1:
                return row
            if tail[1:] == ["structure"]:
                children = [value for value in self.data["actions"].values() if value.get("parent_action_id") == row["id"]]
                relations = []
                for relation in self.data["relations"].values():
                    if relation.get("status") != "active" or row["id"] not in [relation["source_action_id"], relation["target_action_id"]]:
                        continue
                    outgoing = relation["source_action_id"] == row["id"]
                    direction = ("blocking" if outgoing else "blocked_by") if relation["relation_type"] == "blocks" else "related"
                    other = relation["target_action_id"] if outgoing else relation["source_action_id"]
                    relations.append(dict(relation, direction=direction, related_action=self.data["actions"].get(other)))
                return dict(action_id=row["id"], parent=self.data["actions"].get(row.get("parent_action_id")), children=children,
                            child_progress=dict(total=len(children), completed=sum(canonical(value["status"]) == "done" for value in children), total_issues=len(children), completed_issues=0, progress_percent=0),
                            relations=relations, canonical_action=self.data["actions"].get(row.get("duplicate_of_id")), estimate_settings=dict(unestimated_value=1), text_references=[], backlinks=[], as_of=now())
        if resource == "projects":
            if tail:
                return self.project_detail(self.get("projects", tail[0]))
            rows = [self.project_detail(row) for row in self.data["projects"].values() if row["status"] != "archived"]
            for key in ["status", "health", "business", "lead_id"]:
                if query.get(key):
                    rows = [row for row in rows if row.get(key) in query[key].split(",")]
            if query.get("search"):
                rows = [row for row in rows if query["search"].lower() in (row["name"] + " " + row.get("summary", "")).lower()]
            rows.sort(key=lambda row: str(row.get(query.get("sort_by", "priority")) or "zzzz"), reverse=query.get("sort_dir") == "desc")
            return self.page(rows, query)
        if resource == "members":
            if tail == ["stats"]:
                results = []
                for member in self.data["members"]:
                    rows = self.action_rows(dict(owner_id=member["id"], include_archived="true"))
                    counts = Counter(canonical(row["status"]) for row in rows)
                    results.append(dict(member_id=member["id"], id=member["id"], principal_type=member["principal_type"], total=len(rows),
                                        active=sum(count for key, count in counts.items() if key not in TERMINAL), overdue=0,
                                        done=counts["done"], not_started=counts["not_started"], in_progress=counts["in_progress"], waiting=counts["waiting"], blocked=counts["blocked"]))
                return results
            if tail:
                member = next((value for value in self.data["members"] if value["id"] == tail[0]), None)
                require(member, "Principal not found.", "MEMBER_NOT_FOUND", 404)
                return self.action_rows(dict(query, owner_id=tail[0])) if tail[1:] == ["actions"] else member
            return self.data["members"]
        if resource == "views":
            return [row for row in self.data["views"].values() if row.get("status", "active") != "archived"
                    and all(query.get(key) in [None, ""] or (row.get(key) in [None, ""] if query[key] == "__null__" else row.get(key) == query[key]) for key in ["entity_type", "context_project_id"])]
        if resource == "activity":
            return [row for row in self.data["activity"] if tail and row["action_id"] == tail[0]]
        if resource == "today":
            rows = [value for value in self.data["actions"].values() if value["id"] in {"open", "active", "waiting", "done", "canceled", "legacy-cancelled", "archived"}]
            return dict(source="weekly_plan_guidance", date=query.get("date", date.today().isoformat()), plan=None,
                        items=[dict(id="today-" + row["id"], source_action_id=row["id"], title=row["title"], reason="Selected in the synthetic weekly plan.", action=row) for row in rows])
        if resource == "updates" and tail == ["office-digest"]:
            rows = []
            for row in self.data["actions"].values():
                status = canonical(row["status"])
                bucket = "done" if status == "done" else "waiting_on_owner" if status not in TERMINAL and row.get("approval_state") == "needs_review" else "blocked_by_office" if status not in TERMINAL and row.get("blocked_by") else None
                if bucket:
                    rows.append(dict(row, digest_bucket=bucket))
            return dict(source="atlas_office_digest_v1", as_of=now(), counts={key: sum(row["digest_bucket"] == key for row in rows) for key in ["done", "waiting_on_owner", "blocked_by_office"]}, items=rows)
        if resource == "weeks":
            if tail == ["review"]:
                return dict(weeks=[row for row in self.data["weeks"].values() if row["status"] == "review_requested"])
            if len(tail) == 1:
                return self.week_payload(tail[0], query.get("revision_id"))
        if resource == "documents":
            if tail:
                return self.document_detail(self.get("documents", tail[0]))
            rows = [row for row in self.data["documents"].values() if row["status"] == query.get("status", "active")]
            for key in ["context_type", "context_id"]:
                if query.get(key):
                    rows = [row for row in rows if row.get(key) == query[key]]
            if query.get("search"):
                rows = [row for row in rows if query["search"].lower() in (row["title"] + row["content"]).lower()]
            return self.page(rows, query)
        if resource == "comments":
            return self.discussion(query)
        if resource == "notifications":
            if tail == ["summary"]:
                return dict(unread_count=sum(row["status"] == "unread" for row in self.data["notifications"].values()), preferences=list(self.data["preferences"].values()), subscriptions=list(self.data["subscriptions"].values()))
            if tail == ["unread-count"]:
                return dict(count=sum(row["status"] == "unread" for row in self.data["notifications"].values()))
            rows = [row for row in self.data["notifications"].values() if row["status"] in (["unread", "read"] if query.get("status", "open") == "open" else [query["status"]])]
            return dict(items=rows, unread=sum(row["status"] == "unread" for row in rows), as_of=now())
        if resource == "integrations":
            connections = [dict(row, subscriptions=[value for value in self.data["integration_subscriptions"].values() if value["connection_id"] == row["id"]]) for row in self.data["connections"].values() if row["status"] != "archived"]
            return dict(connections=connections, deliveries=self.data["deliveries"], inbound=self.data["inbound"], delivery_enabled=False)
        if resource == "journal":
            rows = list(self.data["journal"].values())
            for key in ["kind", "review_state"]:
                if query.get(key) and query[key] != "all":
                    rows = [row for row in rows if row[key] == query[key]]
            if query.get("include_archived") != "true":
                rows = [row for row in rows if not row.get("archived_at")]
            if query.get("search"):
                rows = [row for row in rows if query["search"].lower() in (row["title"] + row["body"]).lower()]
            return dict(entries=rows)
        if resource == "decide":
            return dict(proposals=[row for row in self.data["proposals"].values() if row["status"] in {"pending", "approved"}], reports=self.data["reports"], runs=[], signals=[], reviews=[], source_errors=[])
        if resource == "automations":
            if not tail:
                return dict(runtime="guarded_codex_protocols", execution_enabled=False, registry_url="/api/automations/registry")
            return dict(runtime="guarded_codex_protocols", execution_enabled=False, jobs=[dict(id=row["automation_id"], status=row["status"], schedule="Daily (synthetic)", writes_to=["Review", "Decide"], route_used="synthetic_fixture", latest_report=row) for row in self.data["reports"]])
        if resource == "transcripts":
            if tail:
                return self.get("transcripts", tail[0])
            return [row for row in self.data["transcripts"].values() if not query.get("status") or row["status"] == query["status"]]
        if resource == "atlas-os":
            if tail == ["journal"]:
                return dict(entries=list(self.data["journal"].values()))
            if tail == ["review"]:
                return dict(actions=self.action_rows(dict(work_mode="review_required")), reports=self.data["reports"], signals=[], weeklyPlans=self.read("weeks", ["review"], {})["weeks"])
            return dict(ruleProposals=[], signals=[])
        if resource == "briefing":
            return dict(briefing=None)
        raise ApiError(404, "QA_ENDPOINT_UNSUPPORTED", "No synthetic contract for this endpoint: /api/" + resource)

    def write_action(self, method, tail, body):
        if not tail and method == "POST":
            return self.create_action(body), 201
        require(tail, "Action id required.")
        row = self.get("actions", tail[0])
        if len(tail) == 1 and method == "PUT":
            self.revision(row, body)
            fields = self.validate_action(body)
            require(fields, "No fields to update")
            row.update(fields)
            self.touch(row)
            self.activity(row["id"], "updated", fields)
            return row, 200
        operation = tail[1] if len(tail) > 1 else ""
        self.revision(row, body)
        if operation == "complete":
            evidence = body.get("evidence") or {}
            require(isinstance(evidence, dict) and isinstance(evidence.get("summary"), str) and evidence["summary"].strip(), "Completion evidence needs a non-empty summary.", "INVALID_COMPLETION_EVIDENCE")
            row.update(status="done", completed_at=now(), evidence_json=evidence, resolution="completed")
        elif operation == "archive":
            row.update(status_before_archive=row["status"], status="archived", archived_at=now())
        elif operation == "restore":
            row.update(status=row.get("status_before_archive", "not_started"), archived_at=None)
        elif operation == "agent-assignment":
            require(not row.get("agent_assignment_id"), "Action already has an agent assignment.", "ASSIGNMENT_EXISTS", 409)
            row["agent_assignment_id"] = new_id("assignment")
            self.touch(row)
            return dict(id=row["agent_assignment_id"], title="Atlas: " + row["title"], status="queued", source_action_id=row["id"]), 201
        elif operation == "sub-actions":
            self.revision(row, body, key="expected_parent_revision")
            child = self.create_action({"business": row["business"], "owners": row["owners"], **body})
            child.update(parent_action_id=row["id"], project_id=row.get("project_id"))
            return child, 201
        elif operation == "parent":
            parent_id = body.get("parent_action_id")
            if parent_id:
                self.get("actions", parent_id)
                require(parent_id != row["id"], "An action cannot be its own parent.")
            row["parent_action_id"] = parent_id
        elif operation == "relations":
            if len(tail) > 3:
                relation = self.get("relations", tail[2])
                relation["status"] = "resolved" if tail[3] == "resolve" else "archived"
                return relation, 200
            self.get("actions", body.get("target_action_id"))
            require(body.get("relation_type") in {"related", "blocks", "duplicate"}, "relation_type is invalid.")
            relation = dict(id=new_id("relation"), source_action_id=row["id"], target_action_id=body["target_action_id"], relation_type=body["relation_type"], status="active", created_at=now())
            self.data["relations"][relation["id"]] = relation
            return relation, 201
        elif operation == "duplicate":
            self.get("actions", body.get("canonical_action_id"))
            require(body["canonical_action_id"] != row["id"], "Choose a different canonical action.")
            row.update(status="done", resolution="duplicate", duplicate_of_id=body["canonical_action_id"], completed_at=now())
        elif operation == "restore-duplicate":
            row.update(status="not_started", resolution=None, duplicate_of_id=None, completed_at=None)
        elif operation == "convert-to-project":
            project, _ = self.write_project("POST", [], dict(name=body.get("name") or row["title"], summary=row.get("description", ""), business=row["business"]))
            row["project_id"] = project["id"]
            self.touch(row)
            return dict(project=project, action=row), 201
        else:
            raise ApiError(405, "QA_ENDPOINT_UNSUPPORTED", "Unsupported synthetic action operation.")
        self.touch(row)
        self.activity(row["id"], operation, body)
        return row, 200

    def write_project(self, method, tail, body):
        if not tail and method == "POST":
            fields = self.validate_project(body)
            row = dict(id=new_id("project"), name="", summary="", description="", business=None, status="planned", health="no_update", priority=None,
                       lead_id="ransomed", members=["ransomed"], start_date=None, target_date=None, update_frequency="weekly", sort_order=1000,
                       revision=0, created_at=now(), updated_at=now(), created_by="codex", updated_by="codex", archived_at=None)
            row.update(fields)
            self.data["projects"][row["id"]] = row
            return row, 201
        row = self.get("projects", tail[0])
        if len(tail) == 1 and method == "PUT":
            self.revision(row, body, True)
            require(row["status"] != "archived", "Restore the project before editing it.", "PROJECT_ARCHIVED", 409)
            fields = self.validate_project(body, True)
            require(fields.get("status") != "archived", "Use the archive endpoint.", "PROJECT_TRANSITION_REQUIRED")
            require(fields, "No project fields were provided.", "NO_PROJECT_CHANGES")
            row.update(fields)
            return self.touch(row), 200
        operation = tail[1] if len(tail) > 1 else ""
        if operation in {"archive", "restore", "reorder", "move-timeline"}:
            self.revision(row, body)
        if operation in {"archive", "restore"}:
            row.update(status="archived" if operation == "archive" else "planned", archived_at=now() if operation == "archive" else None)
        elif operation == "milestones":
            if len(tail) == 2:
                require(isinstance(body.get("name"), str) and body["name"].strip(), "name is required", "INVALID_MILESTONE")
                milestone = dict(id=new_id("milestone"), project_id=row["id"], name=body["name"].strip(), status=body.get("status", "planned"), target_date=body.get("target_date"), revision=0, created_at=now(), updated_at=now())
                self.data["milestones"][milestone["id"]] = milestone
                return milestone, 201
            milestone = self.get("milestones", tail[2])
            self.revision(milestone, body)
            milestone.update({key: value for key, value in body.items() if key in {"name", "status", "target_date", "sort_order"}})
            if tail[-1] == "archive":
                milestone["status"] = "archived"
            return self.touch(milestone), 200
        elif operation == "updates":
            require(body.get("health") in {"on_track", "at_risk", "off_track"} and isinstance(body.get("body"), str) and body["body"].strip(), "health and update body are required", "INVALID_PROJECT_UPDATE")
            update = dict(id=new_id("project-update"), project_id=row["id"], health=body["health"], body=body["body"], created_by="codex", created_at=now())
            self.data["project_updates"][update["id"]] = update
            row["health"] = update["health"]
            self.touch(row)
            return update, 201
        elif operation == "dependencies":
            if len(tail) == 2:
                blocking = body.get("blocking_project_id")
                self.get("projects", blocking)
                require(blocking != row["id"], "A project cannot depend on itself.")
                dependency = dict(id=new_id("dependency"), blocking_project_id=blocking, blocked_project_id=row["id"], status="active", note=body.get("note", ""), created_at=now())
                self.data["dependencies"][dependency["id"]] = dependency
                return dependency, 201
            dependency = self.get("dependencies", tail[2])
            dependency["status"] = "resolved" if tail[-1] == "resolve" else "archived"
            return dependency, 200
        elif operation == "actions" and len(tail) == 4:
            action = self.get("actions", tail[2])
            action.update(project_id=row["id"] if tail[3] == "assign" else None, project_milestone_id=body.get("milestone_id") if tail[3] == "assign" else None)
            if "estimate_points" in body:
                action["estimate_points"] = body["estimate_points"]
            return self.touch(action), 200
        elif operation == "reorder":
            before = self.data["projects"].get(body.get("before_project_id"), {})
            row["sort_order"] = before.get("sort_order", 3000) - 1
        elif operation == "move-timeline":
            for key in ["start_date", "target_date"]:
                if key in body:
                    require(body[key] is None or is_date(body[key]), key + " is invalid.")
                    row[key] = body[key]
        else:
            raise ApiError(405, "QA_ENDPOINT_UNSUPPORTED", "Unsupported synthetic project operation.")
        return self.touch(row), 200

    def write_week(self, method, tail, body):
        if tail == ["drafts"]:
            start = body.get("week_start", "")
            self.week_payload(start)
            existing = next((row for row in self.data["weeks"].values() if row["week_start"] == start and row["status"] in {"draft", "review_requested"}), None)
            if existing:
                return existing, 200
            row = dict(id=new_id("week"), week_start=start, title=body.get("title", ""), summary=body.get("summary", ""), status="draft", version=1,
                       revision=0, items=[], commitments=[], source_coverage={}, calendar_acknowledged=False, created_at=now(), updated_at=now(), published_at=None)
            versions = [value["version"] for value in self.data["weeks"].values() if value["week_start"] == start]
            row["version"] = max(versions, default=0) + 1
            self.data["weeks"][row["id"]] = row
            return row, 201
        require(len(tail) >= 2 and tail[0] == "revisions", "Weekly revision id required.")
        row = self.get("weeks", tail[1])
        operation = tail[2] if len(tail) > 2 else "save"
        if operation == "fork":
            existing = next((value for value in self.data["weeks"].values() if value["week_start"] == row["week_start"] and value["status"] in {"draft", "review_requested"}), None)
            if existing:
                return existing, 200
            draft = copy.deepcopy(row)
            draft.update(id=new_id("week"), status="draft", version=max(value["version"] for value in self.data["weeks"].values() if value["week_start"] == row["week_start"]) + 1, revision=0, created_at=now(), updated_at=now(), published_at=None)
            self.data["weeks"][draft["id"]] = draft
            return draft, 201
        self.revision(row, body)
        require(row["status"] in {"draft", "review_requested"}, "Published weekly plans are immutable; fork a draft.", "INVALID_WEEKLY_PLAN", 409)
        if operation == "save":
            require(isinstance(body.get("items"), list), "items must be an array.", "INVALID_WEEKLY_PLAN")
            items = []
            for index, value in enumerate(body["items"]):
                require(isinstance(value, dict) and value.get("kind") in {"must_win", "day_focus", "risk", "deferred", "carryover", "context"}, f"items[{index}].kind is invalid.", "INVALID_WEEKLY_PLAN")
                require(isinstance(value.get("title"), str) and value["title"].strip(), f"items[{index}].title is required.", "INVALID_WEEKLY_PLAN")
                if value["kind"] in {"must_win", "day_focus", "deferred", "carryover"}:
                    self.get("actions", value.get("source_action_id"))
                item = {key: value.get(key) for key in ["kind", "plan_date", "rank", "source_action_id", "title", "notes", "rationale"]}
                item["id"] = new_id("week-item")
                items.append(item)
            row.update(title=body.get("title", ""), summary=body.get("summary", ""), items=items, commitments=copy.deepcopy(body.get("commitments", [])), calendar_acknowledged=body.get("calendar_acknowledged", False), source_coverage=body.get("source_coverage", {}))
        elif operation == "request-review":
            row["status"] = "review_requested"
        elif operation == "publish":
            require(row["status"] == "review_requested", "Request review before publishing.", "INVALID_WEEKLY_PLAN")
            for value in self.data["weeks"].values():
                if value["week_start"] == row["week_start"] and value["status"] == "published":
                    value["status"] = "superseded"
            row.update(status="published", published_at=now())
        else:
            raise ApiError(405, "QA_ENDPOINT_UNSUPPORTED", "Unsupported synthetic weekly operation.")
        return self.touch(row), 200

    def write_document(self, method, tail, body):
        if not tail:
            self.validate_document(body)
            row = dict(id=new_id("document"), title=body["title"].strip(), content=body.get("content", ""), context_type=body.get("context_type", "workspace"), context_id=body.get("context_id"), status="active", revision=0, created_at=now(), updated_at=now(), created_by="codex", updated_by="codex", last_realtime_edit_at=None)
            self.data["documents"][row["id"]] = row
            self.data["document_versions"][row["id"]] = [dict(id=new_id("version"), document_id=row["id"], title=row["title"], content=row["content"], revision=0, actor="codex", created_at=now())]
            return row, 201
        row = self.get("documents", tail[0])
        if len(tail) == 1 and method == "PUT":
            row, operation = self.edit_document(row, body)
            self.broadcast_document(row["id"], dict(type="edit.external", document=self.document_detail(row), operation=operation))
            return row, 200
        self.revision(row, body, True)
        if tail[1] == "revert":
            old = next((value for value in self.data["document_versions"].get(row["id"], []) if value["revision"] == body.get("target_revision")), None)
            require(old, "Document version not found.", "DOCUMENT_NOT_FOUND", 404)
            row, operation = self.edit_document(row, dict(body, title=old["title"], content=old["content"]))
            self.broadcast_document(row["id"], dict(type="edit.external", document=self.document_detail(row), operation=operation))
        elif tail[1] in {"archive", "restore"}:
            row["status"] = "archived" if tail[1] == "archive" else "active"
            self.touch(row)
            self.broadcast_document(row["id"], dict(type="edit.external", document=self.document_detail(row)))
        else:
            raise ApiError(405, "QA_ENDPOINT_UNSUPPORTED", "Unsupported synthetic document operation.")
        return row, 200

    def write_comment(self, method, tail, body):
        if tail == ["subscription"]:
            key = str(body.get("target_type")) + ":" + str(body.get("target_id"))
            require(body.get("status") in {"active", "muted"}, "A subscription must be active or muted.")
            self.data["discussion_subscriptions"][key] = dict(body, principal_id="codex")
            return self.data["discussion_subscriptions"][key], 200
        if tail == ["reactions", "toggle"]:
            require(body.get("emoji") and len(body["emoji"]) <= 32, "A compact emoji is required.", "INVALID_REACTION")
            key = ":".join(str(body.get(value, "")) for value in ["target_type", "target_id", "emoji"])
            row = self.data["reactions"].setdefault(key, dict(body, id=new_id("reaction"), actor="codex", status="inactive"))
            row["status"] = "active" if row["status"] != "active" else "inactive"
            return row, 200
        if not tail or method == "PUT":
            require(isinstance(body.get("body"), str) and 0 < len(body["body"].strip()) <= 20000, "body must be 1-20000 characters", "INVALID_COMMENT")
            attachments = body.get("attachments", [])
            require(isinstance(attachments, list) and len(attachments) <= 20 and all(isinstance(value, dict) and value.get("title") and str(value.get("url", "")).startswith("https://") for value in attachments), "attachments must be up to 20 titled HTTPS resources", "INVALID_COMMENT")
        if not tail:
            self.discussion(body)  # validate the target shape
            parent = self.get("comments", body["parent_comment_id"]) if body.get("parent_comment_id") else None
            row = dict(id=new_id("comment"), target_type=body["target_type"], target_id=body["target_id"], body=body["body"].strip(),
                       parent_comment_id=body.get("parent_comment_id"), thread_root_id=(parent.get("thread_root_id") or parent["id"]) if parent else None,
                       attachments=body.get("attachments", []), mentions=body.get("mentions", []), anchor=body.get("anchor"), status="active", revision=0,
                       author_id="codex", created_by="codex", updated_by="codex", resolved_at=None, resolved_by=None, created_at=now(), updated_at=now())
            self.data["comments"][row["id"]] = row
            return row, 201
        row = self.get("comments", tail[0])
        self.revision(row, body, method == "PUT")
        if method == "PUT":
            row.update(body=body["body"], mentions=body.get("mentions", []), attachments=body.get("attachments", []))
        elif len(tail) > 1 and tail[1] in {"archive", "restore"}:
            row["status"] = "archived" if tail[1] == "archive" else "active"
        elif len(tail) > 1 and tail[1] in {"resolve", "reopen"}:
            row.update(resolved_at=now() if tail[1] == "resolve" else None, resolved_by="codex" if tail[1] == "resolve" else None)
        else:
            raise ApiError(405, "QA_ENDPOINT_UNSUPPORTED", "Unsupported synthetic comment operation.")
        return self.touch(row), 200

    def write_notification(self, method, tail, body):
        if tail == ["preferences"]:
            require(body.get("channel") in CHANNELS and body.get("category") in CATEGORIES and body.get("delivery_mode") in {"immediate", "digest", "disabled"}, "A supported channel, category, and delivery mode are required.", "NOTIFICATION_PREFERENCE_INVALID")
            existing = next((row for row in self.data["preferences"].values() if row["channel"] == body["channel"] and row["category"] == body["category"]), None)
            row = existing or dict(id=new_id("preference"), principal_id="codex", revision=0)
            self.revision(row, body)
            row.update({key: body.get(key) for key in ["channel", "category", "delivery_mode", "digest_window_minutes"]})
            self.touch(row)
            self.data["preferences"][row["id"]] = row
            return row, 200
        if tail == ["read-all"]:
            count = 0
            for row in self.data["notifications"].values():
                if row["status"] == "unread":
                    row["status"] = "read"
                    self.touch(row)
                    count += 1
            return dict(updated_count=count), 200
        if tail and tail[0] == "subscriptions":
            if len(tail) == 1:
                row = dict(body, id=new_id("subscription"), principal_id="codex", status="active", revision=0, created_at=now(), updated_at=now())
                self.data["subscriptions"][row["id"]] = row
                return row, 201
            row = self.get("subscriptions", tail[1])
            self.revision(row, body)
            row["status"] = dict(follow="active", mute="muted", archive="archived").get(tail[-1], "active")
            return self.touch(row), 200
        if len(tail) == 2 and tail[1] in {"read", "unread", "archived"}:
            row = self.get("notifications", tail[0])
            self.revision(row, body)
            row["status"] = tail[1]
            return self.touch(row), 200
        raise ApiError(405, "QA_ENDPOINT_UNSUPPORTED", "Unsupported synthetic notification operation.")

    def write_other(self, method, resource, tail, body):
        if resource == "views":
            if not tail:
                require(body.get("name") and body.get("entity_type", "action") in {"action", "project"}, "A name and supported entity type are required.")
                row = dict(body, id=new_id("view"), revision=0, status="active", created_at=now(), updated_at=now())
                self.data["views"][row["id"]] = row
                return row, 201
            row = self.get("views", tail[0])
            self.revision(row, body)
            row.update({key: value for key, value in body.items() if key != "expected_revision"})
            if len(tail) > 1:
                row["status"] = "archived" if tail[1] == "archive" else "active"
            return self.touch(row), 200
        if resource == "config":
            if tail == ["businesses"]:
                require(isinstance(body, list), "businesses must be an array")
                self.data["businesses"] = copy.deepcopy(body)
                return body, 200
            if tail == ["estimates"]:
                self.data["estimates"] = copy.deepcopy(body)
                return body, 200
        if resource == "journal":
            if not tail:
                require(isinstance(body.get("body"), str) and body["body"].strip(), "Journal entry body is required.")
                row = dict(body, id=new_id("journal"), title=body.get("title", ""), kind=body.get("kind", "thought"), source="atlas_user_journal", review_state="unreviewed", promoted_targets=[], archived_at=None, captured_at=now(), created_at=now(), updated_at=now())
                self.data["journal"][row["id"]] = row
                return row, 201
            row = self.get("journal", tail[0])
            if len(tail) == 1:
                row.update({key: value for key, value in body.items() if key in {"title", "body", "kind", "tags", "review_state"}})
            elif tail[1] == "archive":
                row.update(archived_at=now(), review_state="archived")
            elif tail[1] == "promote":
                require(row["review_state"] in {"reviewed", "promoted"}, "Review the journal entry before promotion.")
                action = self.create_action(dict(title=body.get("title") or row["title"], business=body.get("business", "personal"), description=row["body"], priority=body.get("priority", "p2"), next_action=body.get("next_action")))
                row.update(review_state="promoted", promoted_targets=[dict(target_type="action", target_id=action["id"])])
                return dict(entry=row, action=action), 201
            else:
                raise ApiError(405, "QA_ENDPOINT_UNSUPPORTED", "Unsupported synthetic journal operation.")
            row["updated_at"] = now()
            return row, 200
        if resource == "decide" and len(tail) == 3 and tail[0] == "proposals" and tail[2] == "decision":
            row = self.get("proposals", tail[1])
            decision = body.get("decision")
            require(decision in {"approve", "reject", "defer", "close"}, "Unknown decision.")
            require((row["status"] == "pending" and decision != "close") or (row["status"] == "approved" and decision in {"close", "reject", "defer"}), "Accept before closing as done.")
            row.update(status=dict(approve="approved", reject="rejected", defer="deferred", close="applied")[decision], applied_at=now())
            return row, 200
        if resource == "transcripts":
            if not tail:
                require(body.get("title"), "title is required")
                self.validate_lengths(body)
                row = dict(body, id=new_id("transcript"), status=body.get("status", "pending"), created_at=now(), actions=[], action_count=0)
                self.data["transcripts"][row["id"]] = row
                return row, 201
            row = self.get("transcripts", tail[0])
            row.update(body)
            return row, 200
        if resource == "members" and tail:
            row = next((value for value in self.data["members"] if value["id"] == tail[0]), None)
            require(row is not None, "Principal not found.", "MEMBER_NOT_FOUND", 404)
            row.update(body)
            return row, 200
        if resource == "integrations":
            if tail == ["connections"]:
                require(body.get("name") and str(body.get("endpoint_url", "")).startswith("https://"), "Name and an HTTPS endpoint are required.")
                row = dict(body, id=new_id("connection"), endpoint_host=urlparse(body["endpoint_url"]).hostname, status="draft", revision=0, created_at=now(), updated_at=now(), secret_fingerprint=None)
                self.data["connections"][row["id"]] = row
                return row, 201
            if tail and (tail[-1] == "verify" or tail[:2] == ["deliveries", "process"]):
                raise ApiError(409, "QA_EXTERNAL_IO_DISABLED", "The synthetic harness never sends verification, delivery, or other external requests.")
            if len(tail) >= 3 and tail[0] == "connections":
                row = self.get("connections", tail[1])
                if tail[2] == "subscriptions":
                    value = dict(body, id=new_id("integration-subscription"), connection_id=row["id"], status="draft", revision=0)
                    self.data["integration_subscriptions"][value["id"]] = value
                    return value, 201
                require(tail[2] in {"pause", "archive"}, "Verification and activation are not simulated.", "QA_EXTERNAL_IO_DISABLED", 409)
                row["status"] = "paused" if tail[2] == "pause" else "archived"
                return self.touch(row), 200
        raise ApiError(405, "QA_ENDPOINT_UNSUPPORTED", "Unsupported synthetic mutation; no request was forwarded.")

    def broadcast_document(self, document_id, message):
        for peer in list(self.peers.get(document_id, [])):
            try:
                peer.send(message)
            except (OSError, ValueError):
                pass

    def presence(self, document_id):
        return [dict(actor="codex", client_id=peer.client_id, selection=peer.selection, revision=self.data["documents"][document_id]["revision"]) for peer in self.peers.get(document_id, [])]

    def websocket_message(self, document_id, client_id, message):
        with self.lock:
            document = self.get("documents", document_id)
            require(message.get("type") in {"edit", "presence", "ping"}, "Unknown document message.")
            if message["type"] != "edit":
                return None
            if document["status"] == "archived":
                return dict(type="error", code="DOCUMENT_ARCHIVED")
            if message.get("base_revision") != document["revision"] or message.get("base_content_sha256") != hashlib.sha256(document["content"].encode()).hexdigest():
                conflict = dict(id=new_id("conflict"), type="edit.conflict", reason="overlapping_change", operation_id=message.get("operation_id"), document=self.document_detail(document), created_at=now())
                self.data["document_conflicts"].setdefault(document_id, []).insert(0, {key: value for key, value in conflict.items() if key not in {"type", "document"}})
                return conflict
            document, operation = self.edit_document(document, dict(message, expected_revision=message["base_revision"], client_id=client_id), "direct")
            return dict(type="edit.applied", operation_id=message.get("operation_id"), document=self.document_detail(document), operation=operation)

    def empty(self, path):
        payload, status = self.dispatch("GET", path)
        if status != 200:
            return payload, status
        resource_path = urlparse(path).path.rstrip("/")
        if re.fullmatch(r"/api/(actions|projects|documents|members|transcripts)/[^/]+", resource_path) and not resource_path.endswith("/stats"):
            return dict(error=dict(code="QA_EMPTY_DETAIL", message="Synthetic empty detail: no record exists in this QA mode.")), 404
        if resource_path.startswith("/api/weeks/") and not resource_path.endswith("/review"):
            return dict(payload, published=None, draft=None, selected_revision=None, history=[], days=[], diagnostics=dict(stale_calendar=False, missing_actions=[])), 200
        def zero(value):
            if isinstance(value, list):
                return []
            if isinstance(value, dict):
                return {key: zero(item) for key, item in value.items()}
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                return 0
            return value
        return zero(payload), 200


class WebSocketPeer:
    """Small RFC6455 transport for local text frames; not a general WS server."""
    def __init__(self, handler, client_id):
        self.handler, self.client_id, self.selection = handler, client_id, None
        self.lock = threading.Lock()

    def send(self, message):
        self.send_frame(json.dumps(message).encode(), 1)

    def send_frame(self, payload, opcode):
        length = len(payload)
        header = bytes([0x80 | opcode, length]) if length < 126 else bytes([0x80 | opcode, 126]) + struct.pack("!H", length) if length < 65536 else bytes([0x80 | opcode, 127]) + struct.pack("!Q", length)
        with self.lock:
            self.handler.wfile.write(header + payload)
            self.handler.wfile.flush()

    def receive(self):
        stream = self.handler.rfile
        header = stream.read(2)
        if len(header) < 2:
            return None, None
        first, second = header
        require(first & 0x80, "Fragmented frames are not supported by this local fixture.")
        length = second & 0x7F
        if length == 126:
            length = struct.unpack("!H", stream.read(2))[0]
        elif length == 127:
            length = struct.unpack("!Q", stream.read(8))[0]
        require(length <= 512000, "Document WebSocket frame is too large.")
        mask = stream.read(4) if second & 0x80 else None
        payload = stream.read(length)
        require(len(payload) == length, "Incomplete WebSocket frame.")
        if mask:
            payload = bytes(value ^ mask[index % 4] for index, value in enumerate(payload))
        return first & 0x0F, payload


class Handler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(args[2].dist), **kwargs)

    def log_message(self, *_args):
        pass

    @property
    def state(self):
        return self.server.state

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Atlas-Fixture", "synthetic-local-only")
        self.send_header("Content-Security-Policy", f"connect-src 'self' ws://127.0.0.1:{self.server.server_port} ws://localhost:{self.server.server_port}; form-action 'self'; base-uri 'self'")
        super().end_headers()

    def send_json(self, payload, status=200):
        raw = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def record(self, body, status, mode=None):
        record = dict(at=now(), method=self.command, path=self.path, body=body, status=status, qa_mode=mode or "normal")
        with self.state.lock:
            self.state.requests.append(record)
            if self.server.events:
                with self.server.events.open("a", encoding="utf-8") as stream:
                    stream.write(json.dumps(record) + "\n")

    def body(self):
        length = int(self.headers.get("Content-Length", 0))
        require(0 <= length <= 1048576, "Fixture JSON body must be at most 1 MiB.", "INVALID_JSON", 413)
        try:
            return json.loads(self.rfile.read(length) or b"{}")
        except (UnicodeError, ValueError):
            raise ApiError(400, "INVALID_JSON", "Invalid JSON body.")

    def qa_controls(self, path, query, body):
        try:
            if path == "/__qa/reset":
                self.state.reset()
            elif path == "/__qa/clear":
                with self.state.lock:
                    self.state.modes.clear()
            elif path == "/__qa/requests":
                return self.send_json(list(self.state.requests))
            elif path == "/__qa/state":
                return self.send_json(copy.deepcopy(self.state.data))
            elif self.command == "POST" or "mode" in query:
                self.state.configure(body if self.command == "POST" else query)
            result = dict(synthetic_only=True, modes=self.state.modes, counts={key: len(value) for key, value in self.state.data.items() if isinstance(value, (dict, list))}, control_url="/__qa")
            if self.command != "GET" or query.get("format") == "json" or "application/json" in self.headers.get("Accept", ""):
                return self.send_json(result)
            links = [("Today", "/today"), ("Week", "/week"), ("Projects", "/projects"), ("All Tasks", "/tasks"), ("Kanban", "/tasks?view=kanban"), ("Documents", "/documents"), ("Notifications", "/notifications"), ("Office Digest", "/updates/office-digest"), ("Review", "/review"), ("Decide", "/decide"), ("Journal", "/journal"), ("Calendar", "/calendar"), ("Principals", "/settings/principals"), ("Transcripts", "/transcripts"), ("Automations", "/automations")]
            markup = "<!doctype html><meta charset=utf-8><title>Atlas synthetic QA controls</title><style>body{font:16px system-ui;max-width:960px;margin:40px auto;padding:20px;color:#202124}a{display:inline-block;margin:6px}input,select,button{font:inherit;margin:4px;padding:8px}pre{white-space:pre-wrap;background:#eee;padding:16px}</style><h1>Atlas synthetic QA controls</h1><p>All data and writes stay in this server process. Browser reloads retain edits. No request is forwarded.</p>" + " ".join(f'<a href="{url}">{label}</a>' for label, url in links)
            markup += '<h2>Scoped response mode</h2><form action="/__qa"><label>API prefix <input name="scope" value="/api/projects"></label><label>Mode <select name="mode"><option>normal</option><option>empty</option><option>error</option><option>loading</option></select></label><label>Method <select name="method"><option>GET</option><option>PUT</option><option>POST</option><option>ALL</option></select></label><label>Delay ms <input name="delay_ms" value="4000" type="number" min="0" max="30000"></label><button>Apply</button></form><p>Reload the app after changing a mode. <a href="/__qa/clear">Clear modes</a> <a href="/__qa/reset">Reset fixture</a> (close document tabs first). Reset also clears request history.</p><p><a href="/__qa/state">Inspect state</a><a href="/__qa/requests">Inspect requests</a><a href="/actions/open">Open seed action</a><a href="/projects/p1">Open seed project</a><a href="/documents/document-qa">Open seed document</a></p><pre>' + html.escape(json.dumps(result, indent=2)) + "</pre>"
            raw = markup.encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
        except (ApiError, ValueError) as error:
            self.send_json(dict(error=dict(code=getattr(error, "code", "INVALID_QA_MODE"), message=str(error))), getattr(error, "status", 400))

    def handle_api(self, body=None):
        parsed = urlparse(self.path)
        query = {key: values[-1] for key, values in parse_qs(parsed.query, keep_blank_values=True).items()}
        if parsed.path.startswith("/__qa"):
            return self.qa_controls(parsed.path.rstrip("/"), query, body)
        rule = self.state.mode_for(self.command, parsed.path.rstrip("/"), query)
        mode = rule.get("mode", "normal")
        if mode == "loading":
            time.sleep(rule.get("delay_ms", 4000) / 1000)
        if mode == "error":
            payload, status = dict(error=dict(code="QA_SYNTHETIC_ERROR", message=f"Synthetic QA error for {self.command} {parsed.path}; clear it at /__qa.")), 503
        elif mode == "empty" and self.command == "GET":
            payload, status = self.state.empty(self.path)
        elif parsed.path.endswith("/realtime") and self.command == "GET":
            return self.document_socket(parsed.path, query)
        else:
            payload, status = self.state.dispatch(self.command, self.path, body)
        self.record(body, status, mode)
        self.send_json(payload, status)

    def document_socket(self, path, query):
        document_id = unquote(path.split("/")[3])
        try:
            require(self.headers.get("Upgrade", "").lower() == "websocket", "Use a WebSocket upgrade for realtime document collaboration.", "WEBSOCKET_UPGRADE_REQUIRED", 426)
            with self.state.lock:
                document = self.state.get("documents", document_id)
                require(re.fullmatch(r"[A-Za-z0-9_.:-]{8,128}", query.get("client_id", "")), "client_id must be 8-128 safe characters.", "DOCUMENT_CLIENT_ID_INVALID")
            key = self.headers.get("Sec-WebSocket-Key", "")
            require(key, "WebSocket key required.")
            accept = base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()).decode()
            self.send_response(101)
            self.send_header("Upgrade", "websocket")
            self.send_header("Connection", "Upgrade")
            self.send_header("Sec-WebSocket-Accept", accept)
            self.end_headers()
            self.wfile.flush()
            peer = WebSocketPeer(self, query["client_id"])
            with self.state.lock:
                self.state.peers.setdefault(document_id, []).append(peer)
                peer.send(dict(type="snapshot", document=self.state.document_detail(document), operations=self.state.data["document_operations"].get(document_id, []), conflicts=self.state.data["document_conflicts"].get(document_id, []), presence=self.state.presence(document_id)))
                self.state.broadcast_document(document_id, dict(type="presence", presence=self.state.presence(document_id)))
            self.record(None, 101)
            try:
                while True:
                    opcode, payload = peer.receive()
                    if opcode is None or opcode == 8:
                        break
                    if opcode == 9:
                        peer.send_frame(payload, 10)
                        continue
                    if opcode != 1:
                        continue
                    message = json.loads(payload)
                    with self.state.lock:
                        if message.get("type") == "presence":
                            peer.selection = message.get("selection")
                            self.state.broadcast_document(document_id, dict(type="presence", presence=self.state.presence(document_id)))
                        else:
                            response = self.state.websocket_message(document_id, peer.client_id, message)
                            if response and response["type"] == "edit.applied":
                                self.state.broadcast_document(document_id, response)
                            elif response:
                                peer.send(response)
                    self.record(dict(websocket=message), 200)
            except (OSError, ValueError, ApiError) as error:
                try:
                    peer.send(dict(type="error", code=getattr(error, "code", "QA_SOCKET_CLOSED")))
                except OSError:
                    pass
            finally:
                with self.state.lock:
                    self.state.peers[document_id].remove(peer)
                    self.state.broadcast_document(document_id, dict(type="presence", presence=self.state.presence(document_id)))
                try:
                    peer.send_frame(b"", 8)
                except OSError:
                    pass
                self.close_connection = True
        except ApiError as error:
            self.send_json(dict(error=dict(code=error.code, message=error.message)), error.status)

    def do_GET(self):
        path = urlparse(self.path).path
        if path.startswith(("/api/", "/__qa")):
            return self.handle_api()
        # SPA history fallback; assets remain restricted to the selected dist tree.
        requested = (self.server.dist / unquote(path.lstrip("/"))).resolve()
        if not requested.is_relative_to(self.server.dist):
            return self.send_json(dict(error="Path outside fixture dist."), 403)
        if not requested.is_file():
            self.path = "/index.html"
        super().do_GET()

    def write_request(self):
        try:
            return self.handle_api(self.body())
        except ApiError as error:
            self.send_json(dict(error=dict(code=error.code, message=error.message)), error.status)

    do_POST = write_request
    do_PUT = write_request


class FixtureServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, dist, events=None):
        self.dist = Path(dist).resolve()
        self.events = Path(events).resolve() if events else None
        self.state = FixtureState()
        super().__init__(address, Handler)


def self_check():
    """Contract smoke checks without creating a socket, server, or browser."""
    state = FixtureState()
    def call(method, path, body=None, expected=200):
        payload, status = state.dispatch(method, path, body)
        assert status == expected, (method, path, status, payload)
        json.dumps(payload)  # Every response must remain serializable.
        return payload
    start = state.data["weeks"]["week-qa"]["week_start"]
    endpoints = ["/api/config/businesses", "/api/config/estimates", "/api/members", "/api/members/stats", "/api/members/codex/actions",
                 "/api/actions", "/api/actions/stats", "/api/actions/open", "/api/actions/open/structure", "/api/projects", "/api/projects/p1", "/api/views",
                 "/api/today", "/api/weeks/" + start, "/api/weeks/review", "/api/documents", "/api/documents/document-qa",
                 "/api/comments?target_type=action&target_id=open", "/api/notifications", "/api/notifications/summary", "/api/integrations",
                 "/api/updates/office-digest", "/api/journal", "/api/decide", "/api/transcripts", "/api/automations/registry"]
    for endpoint in endpoints:
        call("GET", endpoint)
        empty, status = state.empty(endpoint)
        assert status in {200, 404}
        json.dumps(empty)
    assert call("GET", "/api/projects/p1")["is_stale"] is True
    assert call("GET", "/api/actions?status=canceled")["total"] == 2
    created = call("POST", "/api/actions", dict(title="New synthetic action", business="atlas", status="todo", owners=["codex"]), 201)
    assert created["status"] == "not_started"
    call("PUT", "/api/actions/legacy-cancelled", dict(title="Renamed historical action"))
    assert call("GET", "/api/actions/legacy-cancelled")["status"] == "cancelled"
    call("PUT", "/api/actions/open", dict(notes="x" * 10001), 400)
    call("PUT", "/api/actions/open", dict(status="done"), 400)
    call("POST", "/api/actions/open/complete", dict(evidence={}), 400)
    call("POST", "/api/actions/" + created["id"] + "/complete", dict(expected_revision=0, evidence=dict(kind="manual_attestation", summary="Synthetic proof")))
    call("POST", "/api/actions/" + created["id"] + "/archive", {})
    call("POST", "/api/actions/" + created["id"] + "/restore", {})
    project = call("POST", "/api/projects", dict(name="Synthetic new project", business="atlas", members=["codex"]), 201)
    project = call("PUT", "/api/projects/" + project["id"], dict(expected_revision=0, summary="Saved project summary"))
    call("PUT", "/api/projects/" + project["id"], dict(expected_revision=0, summary="Stale update"), 409)
    assert call("GET", "/api/projects/" + project["id"])["summary"] == "Saved project summary"
    milestone = call("POST", "/api/projects/" + project["id"] + "/milestones", dict(name="Check readback"), 201)
    call("POST", "/api/projects/" + project["id"] + "/milestones/" + milestone["id"] + "/archive", dict(expected_revision=0))
    draft = call("POST", "/api/weeks/revisions/week-qa/fork", {}, 201)
    draft = call("PUT", "/api/weeks/revisions/" + draft["id"], dict(expected_revision=draft["revision"], title="Edited synthetic week", summary="Saved", items=draft["items"], commitments=[], calendar_acknowledged=True))
    draft = call("POST", "/api/weeks/revisions/" + draft["id"] + "/request-review", dict(expected_revision=draft["revision"]))
    draft = call("POST", "/api/weeks/revisions/" + draft["id"] + "/publish", dict(expected_revision=draft["revision"]))
    assert call("GET", "/api/weeks/" + start)["published"]["title"] == "Edited synthetic week"
    assert state.data["weeks"]["week-qa"]["status"] == "superseded"
    document = call("POST", "/api/documents", dict(title="New synthetic document", content="# Draft", context_type="workspace"), 201)
    document = call("PUT", "/api/documents/" + document["id"], dict(title="Saved document", content="# Saved", expected_revision=0, operation_id="rest-qa"))
    call("PUT", "/api/documents/" + document["id"], dict(title="Stale document", expected_revision=0), 409)
    assert {version["revision"] for version in call("GET", "/api/documents/" + document["id"])["versions"]} == {0, 1}
    response = state.websocket_message(document["id"], "browser:selfcheck", dict(type="edit", operation_id="ws-qa", base_revision=1, base_content_sha256=hashlib.sha256(b"# Saved").hexdigest(), title="WebSocket saved", content="# Synced"))
    assert response["type"] == "edit.applied" and response["document"]["revision"] == 2
    for _ in range(2):
        response = state.websocket_message(document["id"], "browser:selfcheck", dict(type="edit", base_revision=0))
        assert response["type"] == "edit.conflict"
        json.dumps(response)
    document = call("POST", "/api/documents/" + document["id"] + "/revert", dict(expected_revision=2, target_revision=0))
    assert document["content"] == "# Draft" and document["revision"] == 3
    comment = call("POST", "/api/comments", dict(target_type="action", target_id="open", body="Synthetic comment"), 201)
    reply = call("POST", "/api/comments", dict(target_type="action", target_id="open", parent_comment_id=comment["id"], body="Synthetic reply"), 201)
    comment = call("PUT", "/api/comments/" + comment["id"], dict(expected_revision=0, body="Edited synthetic comment"))
    call("POST", "/api/comments/" + comment["id"] + "/resolve", dict(expected_revision=1))
    discussion = call("GET", "/api/comments?target_type=action&target_id=open")
    assert next(row for row in discussion["threads"] if row["id"] == comment["id"])["replies"][0]["id"] == reply["id"]
    call("POST", "/api/notifications/n1/read", dict(expected_revision=1))
    preference = call("PUT", "/api/notifications/preferences", dict(channel="browser", category="all", delivery_mode="digest", digest_window_minutes=60, expected_revision=0))
    assert preference["delivery_mode"] == "digest"
    call("POST", "/api/notifications/read-all", {})
    assert call("GET", "/api/notifications/summary")["unread_count"] == 0
    assert any(row["delivery_mode"] == "digest" for row in call("GET", "/api/notifications/summary")["preferences"])
    for retired in RETIRED:
        call("GET", "/api/" + retired, expected=410)
    state.configure(dict(scope="/api/actions", mode="error", methods=["PUT"]))
    assert state.mode_for("GET", "/api/actions/open", {}) == {}
    assert state.mode_for("PUT", "/api/actions/open", {})["mode"] == "error"
    state.configure(dict(scope="/api/actions", mode="normal"))
    assert state.mode_for("PUT", "/api/actions/open", {}) == {}
    # Frame encode/decode works independently of sockets, including a masked browser frame.
    class MemoryHandler:
        wfile = io.BytesIO()
        rfile = None
    handler = MemoryHandler()
    peer = WebSocketPeer(handler, "browser:qa")
    peer.send(dict(type="snapshot", content="x" * 1000))
    raw = handler.wfile.getvalue()
    assert raw[0] == 0x81 and raw[1] == 126
    payload, mask = b'{"type":"presence"}', b"abcd"
    handler.rfile = io.BytesIO(bytes([0x81, 0x80 | len(payload)]) + mask + bytes(value ^ mask[index % 4] for index, value in enumerate(payload)))
    assert peer.receive() == (1, payload)
    # Exercise the actual HTTP dispatch/control methods with in-memory streams.
    class MemoryRequest(Handler):
        def __init__(self, path, method="GET", body=None, headers=None, wire=b""):
            from types import SimpleNamespace
            encoded = json.dumps(body).encode() if body is not None else wire
            self.server = SimpleNamespace(state=state, events=None, server_port=4188)
            self.path, self.command = path, method
            self.headers = {"Accept": "application/json", "Content-Length": str(len(encoded)), **(headers or {})}
            self.rfile, self.wfile = io.BytesIO(encoded), io.BytesIO()
            self.response_status, self.response_headers = None, {}
        def send_response(self, status, _message=None):
            self.response_status = status
        def send_header(self, key, value):
            self.response_headers[key] = value
        def end_headers(self):
            pass
    request = MemoryRequest("/__qa", "POST", dict(scope="/api/projects", mode="error"))
    request.do_POST()
    assert request.response_status == 200
    request = MemoryRequest("/api/projects")
    request.do_GET()
    assert request.response_status == 503 and b"QA_SYNTHETIC_ERROR" in request.wfile.getvalue()
    request = MemoryRequest("/__qa?scope=/api/projects&mode=empty")
    request.do_GET()
    request = MemoryRequest("/api/projects")
    request.do_GET()
    assert json.loads(request.wfile.getvalue())["items"] == []
    request = MemoryRequest("/__qa/clear", "POST", {})
    request.do_POST()
    request = MemoryRequest("/api/projects?qa=loading&qa_delay_ms=0")
    request.do_GET()
    assert json.loads(request.wfile.getvalue())["total"] >= 3
    request = MemoryRequest("/api/actions/legacy-cancelled")
    request.do_GET()
    assert json.loads(request.wfile.getvalue())["title"] == "Renamed historical action"
    request = MemoryRequest("/api/documents/document-qa/realtime?client_id=browser:selfcheck", headers={"Upgrade": "websocket", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ=="}, wire=bytes([0x88, 0x80]) + b"abcd")
    request.do_GET()
    assert request.response_status == 101 and request.response_headers["Sec-WebSocket-Accept"] == "s3pPLMBiTxaQ9kYGzzhZRbK+xOo="
    assert b'"type": "snapshot"' in request.wfile.getvalue() and not state.peers["document-qa"]
    print(f"Self-check passed: {len(endpoints)} read contracts, persistent CRUD/lifecycles, alias validation, conflicts, versions, HTTP QA dispatch and WebSocket handshake/frames; no server or browser started.")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--port", type=int, default=4188)
    parser.add_argument("--host", choices=["127.0.0.1", "localhost"], default="127.0.0.1")
    parser.add_argument("--dist", type=Path, default=Path(__file__).resolve().parents[2] / "app" / "dist")
    parser.add_argument("--events", type=Path, help="Optional local JSONL request log; in-memory /__qa/requests is always available.")
    parser.add_argument("--self-check", action="store_true", help="Run pure in-memory checks and exit; binds no port.")
    args = parser.parse_args()
    if args.self_check:
        return self_check()
    require((args.dist / "index.html").is_file(), "Build app/dist first or supply --dist with a built app.")
    server = FixtureServer((args.host, args.port), args.dist, args.events)
    print(f"Synthetic-only Atlas fixture: http://{args.host}:{server.server_port} · controls /__qa · dist {server.dist}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
