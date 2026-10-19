#!/usr/bin/env python3
"""Exercise the exact focus SQL proposal against a fresh disposable local DB.

Requires the marked private cluster from local_db.py. Each run creates an
isolated database inside that temporary cluster. No production URL/credentials.
Run: python3 docs/atlas-focus/verify-storage.py --cluster /tmp/atlas-focus-pg-...
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
import hashlib
import json
from pathlib import Path
import threading
import time
import uuid

from local_db import LocalDatabase, literal


def verify(cluster):
    admin = LocalDatabase(cluster)
    name = "focus_verify_" + uuid.uuid4().hex[:12]
    admin.sql(f"create database {name};")
    db = LocalDatabase(cluster, name)
    projects = [dict(id="p1", name="Original project", business="atlas", status="in_progress"),
                dict(id="p2", name="Second project", business="personal", status="paused")]
    projects += [dict(id=status, name=status + " project", business="atlas", status=status) for status in ["archived", "completed", "canceled"]]
    db.bootstrap(projects)
    # A pre-existing grant is deliberately outside the proposal's object set.
    db.sql("create table public.focus_test_sentinel(id text); grant select on public.focus_test_sentinel to anon;")
    proposal = Path(__file__).with_name("schema-proposal.sql").read_text()
    db.sql(proposal)
    checks = []

    def check(condition, label):
        if not condition:
            raise AssertionError(label)
        checks.append(label)

    def state():
        return db.rpc("atlas_focus_get_state", "ransomed")

    def command(kind, **extra):
        request = dict(operation_id=str(uuid.uuid4()), expected_revision=state()["revision"], command=kind, **extra)
        return db.rpc("atlas_focus_command", "ransomed", request), request

    def reject(call, needle, label):
        try:
            call()
        except RuntimeError as error:
            check(needle in str(error), label + " / correct error")
        else:
            raise AssertionError(label + " / unexpectedly accepted")

    def history(limit=100, cursor=None, project=None):
        return db.rpc("atlas_focus_history", "ransomed", limit,
                      cursor["ended_at"] if cursor else None,
                      cursor["id"] if cursor else None, project)

    def expire():
        db.sql("""
          update public.atlas_focus_state set
            deadline_at=deadline_at-(greatest(deadline_at-clock_timestamp(),interval '0')+interval '1 second'),
            running_since=running_since-(greatest(deadline_at-clock_timestamp(),interval '0')+interval '1 second'),
            started_at=started_at-(greatest(deadline_at-clock_timestamp(),interval '0')+interval '1 second')
          where owner_id='ransomed' and status='running';
        """)

    initial = state()
    check(initial["revision"] == 0 and initial["phase"] == "focus" and initial["status"] == "ready", "read-only default ready state")
    check(initial["remaining_ms"] == 1500000 and initial["settings"]["chime_enabled"] is False, "25/5/15 defaults and sound opt-in")
    check(db.sql("select count(*) from public.atlas_focus_state;") == "0", "GET never creates state")
    for role in ["anon", "authenticated"]:
        reject(lambda role=role: db.rpc("atlas_focus_get_state", "ransomed", role=role), "permission denied", role + " cannot execute state RPC")
        reject(lambda role=role: db.sql(f"set role {role}; select * from public.atlas_focus_sessions;"), "permission denied", role + " cannot read ledger")
    check(db.sql("select bool_and(relrowsecurity) from pg_class where oid in ('public.atlas_focus_state'::regclass,'public.atlas_focus_sessions'::regclass,'public.atlas_focus_operations'::regclass);") == "t", "RLS enabled on all new tables")
    check(db.sql("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'atlas_focus_%' and p.prosecdef;") == "0", "no security-definer focus functions")
    check(db.sql("select has_table_privilege('anon','public.focus_test_sentinel','select');") == "t", "existing unrelated grant preserved")
    reject(lambda: command("start", project_id="missing"), "PROJECT", "missing project rejected atomically")
    for project in ["archived", "completed", "canceled"]:
        reject(lambda project=project: command("start", project_id=project), "PROJECT", project + " project cannot start focus")
    check(db.sql("select count(*) from public.atlas_focus_state;") == "0", "invalid starts leave no partial state")
    settings = dict(focus_minutes=1, short_break_minutes=1, long_break_minutes=1, chime_enabled=False)
    reject(lambda: command("settings", settings={**settings, "focus_minutes": 0}), "INVALID", "invalid duration rejected")
    reject(lambda: command("settings", settings={**settings, "chime_enabled": "true"}), "INVALID", "sound setting type rejected")
    command("settings", settings=settings)
    started, start_request = command("start", project_id="p1")
    check(started["status"] == "running" and started["session"]["project_id"] == "p1", "authoritative project ID on start")
    check(started["session"]["project_name"] == "Original project" and started["session"]["duration_ms"] == 60000, "project snapshot and configured duration")
    replay = db.rpc("atlas_focus_command", "ransomed", start_request)
    check(replay == started, "exact receipt replay including original server time")
    reject(lambda: db.rpc("atlas_focus_command", "ransomed", {**start_request, "project_id": "p2"}), "OPERATION_CONFLICT", "operation ID cannot be reused for another payload")
    reject(lambda: db.rpc("atlas_focus_command", "ransomed", {**start_request, "operation_id": str(uuid.uuid4())}), "REVISION_CONFLICT", "stale revision rejected")
    reject(lambda: command("select_phase", phase="long_break"), "INVALID", "phase switch cannot discard active session")
    db.sql("update public.atlas_focus_state set running_since=running_since-interval '10 seconds',deadline_at=deadline_at-interval '10 seconds' where owner_id='ransomed';")
    paused, _ = command("pause")
    check(paused["status"] == "paused" and 48000 <= paused["remaining_ms"] <= 51000 and paused["deadline_at"] is None, "pause accounts active time and clears deadline")
    paused_remaining = paused["remaining_ms"]
    command("settings", settings={**settings, "focus_minutes": 2})
    check(state()["remaining_ms"] == paused_remaining and state()["session"]["duration_ms"] == 60000, "settings do not rebase paused timer")
    resumed, _ = command("resume")
    check(resumed["session"]["id"] == started["session"]["id"] and resumed["status"] == "running", "resume retains session identity")
    db.sql("update public.atlas_projects set name='Renamed project',status='archived' where id='p1';")
    expire()
    due = state()
    check(due["remaining_ms"] == 0 and due["status"] == "running", "expired GET remains read-only until reconciliation")
    req = dict(operation_id=str(uuid.uuid4()), expected_revision=due["revision"], command="reconcile")
    barrier = threading.Barrier(2)

    def concurrent_same():
        barrier.wait()
        return db.rpc("atlas_focus_command", "ransomed", req)

    with ThreadPoolExecutor(2) as pool:
        futures = [pool.submit(concurrent_same) for _ in range(2)]
        settled = [future.result() for future in futures]
    check(settled[0] == settled[1] and settled[0]["phase"] == "short_break" and settled[0]["status"] == "ready", "concurrent identical reconciliation returns one transition")
    first_history = history()
    check(len(first_history["items"]) == 1 and first_history["totals"] == dict(completed_sessions=1, focus_ms=60000), "completed focus counted exactly once")
    first = first_history["items"][0]
    check(first["project_name"] == "Original project" and first["project_id"] == "p1", "rename and archival preserve historical label/ID")
    check(first["outcome"] == "completed" and first["focused_ms"] == 60000, "completed active time excludes pause")
    check(datetime.fromisoformat(first["ended_at"].replace("Z", "+00:00")) <= datetime.fromisoformat(settled[0]["server_now"].replace("Z", "+00:00")), "late reconciliation retains actual deadline")
    command("reconcile")
    check(history()["totals"]["completed_sessions"] == 1, "repeated reconciliation adds no completion")
    command("start")
    expire()
    command("reconcile")
    check(state()["phase"] == "focus" and history()["totals"]["completed_sessions"] == 1, "break completion never adds focus totals")
    command("settings", settings=settings)
    # Project edits are a second possible lock wait after acquiring owner state.
    # A fresh focus must start after the authoritative project snapshot is locked.
    with ThreadPoolExecutor(1) as pool:
        project_held = pool.submit(db.sql, """begin;
          set local application_name='atlas_focus_project_lock_probe';
          select id from public.atlas_projects where id='p2' for update;
          select pg_sleep(0.8); commit;""")
        deadline = time.monotonic() + 4
        while db.sql("select exists(select 1 from pg_stat_activity where application_name='atlas_focus_project_lock_probe' and wait_event='PgSleep');") != "t":
            if time.monotonic() > deadline:
                raise AssertionError("project row lock probe failed to start")
            time.sleep(0.02)
        project_started, _ = command("start", project_id="p2")
        project_held.result()
    check(state()["remaining_ms"] > 59750, "fresh session starts after project lock wait with full duration")
    command("reset")
    check(state()["status"] == "ready" and state()["phase"] == "focus", "reset preserves phase ready")
    command("start", project_id="p2")
    command("skip")
    check(state()["phase"] == "short_break" and history()["totals"]["completed_sessions"] == 1, "skip does not count focus")
    command("skip")
    for expected in range(2, 5):
        command("start", project_id="p2")
        expire()
        completed, _ = command("reconcile")
        check(completed["completed_focus_count"] == expected and completed["phase"] == ("long_break" if expected == 4 else "short_break"), f"completed focus {expected} selects correct break")
        if expected < 4:
            command("skip")
    command("start")
    expire()
    command("reconcile")
    command("start", project_id="p2")
    command("skip")
    check(state()["phase"] == "short_break" and state()["completed_focus_count"] == 4, "skipped focus after fourth does not select another long break")
    command("skip")
    current = state()
    commands = [dict(operation_id=str(uuid.uuid4()), expected_revision=current["revision"], command="start", project_id="p2") for _ in range(2)]
    barrier = threading.Barrier(2)

    def concurrent_different(request):
        barrier.wait()
        try:
            return db.rpc("atlas_focus_command", "ransomed", request)
        except RuntimeError as error:
            return str(error)

    with ThreadPoolExecutor(2) as pool:
        raced = list(pool.map(concurrent_different, commands))
    check(sum(isinstance(item, dict) for item in raced) == 1 and sum(isinstance(item, str) and "REVISION_CONFLICT" in item for item in raced) == 1, "different concurrent commands have one winner")
    # The command is forced to wait past its deadline while another real
    # transaction owns the row lock. Clock must be sampled after acquisition.
    with ThreadPoolExecutor(1) as pool:
        held = pool.submit(db.sql, """begin;
          set local application_name='atlas_focus_lock_probe';
          select owner_id from public.atlas_focus_state where owner_id='ransomed' for update;
          update public.atlas_focus_state set deadline_at=clock_timestamp()+interval '150 milliseconds',
            running_since=clock_timestamp()-interval '59.85 seconds',started_at=clock_timestamp()-interval '59.85 seconds'
          where owner_id='ransomed';
          select pg_sleep(0.8); commit;""")
        deadline = time.monotonic() + 4
        while db.sql("select exists(select 1 from pg_stat_activity where application_name='atlas_focus_lock_probe' and wait_event='PgSleep');") != "t":
            if time.monotonic() > deadline:
                raise AssertionError("row lock probe failed to start")
            time.sleep(0.02)
        after_wait, _ = command("pause")
        held.result()
    check(after_wait["status"] == "ready" and after_wait["phase"] == "short_break", "clock sampled after row lock; late pause cannot pause next phase")
    totals = history()["totals"]
    check(totals == dict(completed_sessions=5, focus_ms=300000), "totals count only five unique completed focuses")
    # Populate >1 page with real reset sessions. Pagination totals must cover
    # the entire ledger, and filters must preserve archived project history.
    command("skip")
    for _ in range(23):
        command("start", project_id="p2")
        command("reset")
    # A shared microsecond timestamp forces the UUID tie-breaker to matter.
    db.sql("""set role service_role;
      insert into public.atlas_focus_sessions(id,owner_id,project_id,project_name,business,phase,outcome,duration_ms,focused_ms,started_at,ended_at)
      select gen_random_uuid(),'ransomed','p2','Second project','personal','focus','reset',60000,0,
        '2026-01-01T00:00:00.123456Z'::timestamptz,'2026-01-01T00:00:00.123456Z'::timestamptz
      from generate_series(1,3);""")
    pages, cursor = [], None
    while True:
        page = history(7, cursor)
        check(page["totals"] == totals, "all-history totals independent of page")
        pages.extend(page["items"])
        cursor = page["next_cursor"]
        if not cursor:
            break
    ids = [row["id"] for row in pages]
    check(len(ids) == len(set(ids)) and len(ids) == int(db.sql("select count(*) from public.atlas_focus_sessions;")), "cursor visits all ledger rows once")
    tied = [row for row in pages if row["ended_at"].startswith("2026-01-01T00:00:00.123456")]
    check(len(tied) == 3, "pagination preserves equal microsecond timestamps with UUID tie-breaker")
    archived_history = history(20, project="p1")
    check(archived_history["totals"] == dict(completed_sessions=1, focus_ms=60000) and archived_history["projects"][0]["project_name"] == "Original project", "archived project filter and totals preserve snapshot")
    reject(lambda: db.sql("set role service_role; delete from public.atlas_focus_sessions;"), "permission denied", "Worker cannot delete ledger")
    reject(lambda: db.sql("set role service_role; update public.atlas_focus_sessions set project_name='changed';"), "permission denied", "Worker cannot rewrite ledger")
    check(db.sql("select status from public.atlas_projects where id='p2';") == "paused", "timer never completes project")
    result = dict(passed=len(checks), checks=checks, database=name, postgres=db.sql("show server_version;"),
                  proposal_sha256=hashlib.sha256(proposal.encode()).hexdigest(), production_writes=0)
    print(json.dumps(result, indent=2))
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cluster", type=Path, required=True)
    args = parser.parse_args()
    verify(args.cluster)
