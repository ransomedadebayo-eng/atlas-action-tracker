# Security and release runbook

## Identity boundary

Ransomed is the only human allowed through Cloudflare Access. `ATLAS_OWNER_EMAILS` is an exact, comma-separated allowlist. Codex and Claude use entries in `ATLAS_API_PRINCIPALS_JSON`; each entry has its own secret and explicit scopes. Never share the owner session or one machine token across agents.

## Secret handling

Store Worker secrets with `wrangler secret put`. Keep local values in `worker/.dev.vars` and browser-proxy values in `app/.env`; both are ignored. Never place Supabase credentials in Vite-prefixed variables or client code.

## Migration sequence

1. Snapshot staging and run migration regression SQL.
2. Apply forward migrations to staging in filename order.
3. Verify grants, deletion guards, active principals, active owners, taxonomy aliases, evidence quality, and atomic action RPCs by readback.
4. Deploy the Worker and run owner, Codex, and Claude scope smoke tests.
5. Deploy the frontend and run the accessibility smoke checklist.
6. Record implemented, verified, and remaining items. Production requires owner approval.

Never use destructive rollback SQL. Correct a migration with another forward migration. Never delete actions or activity logs.

## Incident containment

On suspected credential exposure, revoke the affected principal token, review Worker request logs and `atlas_activity_log`, and issue a unique replacement. On authorization drift, disable mutations before restoring data access. Do not claim recovery until source-of-truth readback confirms the intended grants and principal roster.
