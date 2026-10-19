"""Local-only PostgreSQL adapter for the focus proposal's real transaction tests.

Requires an explicitly marked disposable cluster, never accepts a remote URL,
and never reads Atlas credentials. psql input is passed on stdin, not a shell.
"""
import getpass
import json
import os
from pathlib import Path
import re
import subprocess


MARKER = "atlas-focus-disposable-local-only-v1"


def literal(value):
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, (dict, list)):
        return literal(json.dumps(value, separators=(",", ":"))) + "::jsonb"
    return "'" + str(value).replace("'", "''") + "'"


class LocalDatabase:
    def __init__(self, cluster, database="postgres"):
        self.cluster = Path(cluster).resolve()
        marker = self.cluster / ".atlas-focus-disposable"
        if not marker.is_file() or marker.read_text().strip() != MARKER:
            raise ValueError("Refusing a cluster without the disposable-focus marker.")
        if not (self.cluster / "socket" / ".s.PGSQL.55429").exists():
            raise ValueError("The private local focus PostgreSQL socket is unavailable.")
        if not re.fullmatch(r"[a-z][a-z0-9_]{0,60}", database):
            raise ValueError("Invalid local database name.")
        self.database = database

    def sql(self, query):
        env = {key: value for key, value in os.environ.items() if not key.startswith("PG")}
        env["PGCONNECT_TIMEOUT"] = "5"
        result = subprocess.run(
            ["/opt/homebrew/opt/postgresql@17/bin/psql", "-X", "-A", "-t", "-q",
             "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "-h", str(self.cluster / "socket"),
             "-p", "55429", "-U", getpass.getuser(), "-d", self.database],
            input=query, text=True, capture_output=True, env=env, timeout=20,
        )
        if result.returncode:
            raise RuntimeError(result.stderr.strip())
        return result.stdout.strip()

    def json(self, query):
        return json.loads(self.sql(query))

    def rpc(self, name, *args, role="service_role"):
        if name not in {"atlas_focus_get_state", "atlas_focus_command", "atlas_focus_history"}:
            raise ValueError("Unknown focus test RPC.")
        if role not in {"service_role", "anon", "authenticated"}:
            raise ValueError("Unknown local test role.")
        return self.json(f"set role {role}; select public.{name}({','.join(literal(arg) for arg in args)});")

    def bootstrap(self, projects):
        self.sql("""
          do $$ begin
            if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
            if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
            if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
          end $$;
          create table public.atlas_projects (
            id text primary key, name text not null, business text,
            status text not null default 'in_progress'
          );
          grant usage on schema public to anon, authenticated, service_role;
          -- Mirror verified existing Atlas grants: a SHARE row lock requires
          -- UPDATE privilege even though the focus RPC never updates projects.
          grant select, update on public.atlas_projects to service_role;
        """)
        self.sync_projects(projects)

    def sync_projects(self, projects):
        rows = ",".join("(" + ",".join(literal(row.get(key)) for key in ("id", "name", "business", "status")) + ")" for row in projects)
        if rows:
            self.sql("insert into public.atlas_projects(id,name,business,status) values " + rows + " on conflict (id) do update set name=excluded.name,business=excluded.business,status=excluded.status;")
