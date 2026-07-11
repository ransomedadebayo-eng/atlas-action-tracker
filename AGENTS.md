Atlas action tracker is an execution surface for AEGIS/Atlas work.

Current operating rule:
- Treat the AEGIS Supabase project `vdezxdeushxaacyfjeeh` and its
  `public.atlas_actions` path as the current canonical backend unless the owner
  explicitly decides otherwise in the source-of-truth reconciliation pass.
- Treat `atlas.ransomed.app` as an access/application layer until the worker and
  migrations are fully mapped.
- Historical references to Turso or project `mnfovwxgmhacfljcpkio` are stale
  unless verified in the current backend-map artifact.
- Local Atlas credential/cache files belong under
  `/Users/music/.config/atlas-action-tracker/`, not inside this repo.

Before broad scheduled automation loads, run:
`/Users/music/.codex/automations/bin/automation-preflight-guard --automation-id <automation_id> --ttl-minutes <window>`

Never use destructive rollback SQL. Do not `DELETE` Atlas actions or activity
logs. Use status transitions plus `atlas_activity_log` evidence.

Do not commit local credentials or generated auth/cache files:
`.encryption_key`, `token_cache*.json`, `.wrangler/`, `worker/.wrangler/`, or
`*.key`.

Reports must separate implemented, verified, and remaining operational work.
