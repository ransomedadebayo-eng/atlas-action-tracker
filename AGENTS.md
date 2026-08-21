Atlas action tracker is an execution surface for AEGIS/Atlas work.

Current operating rule:
- Treat the AEGIS Supabase project `vdezxdeushxaacyfjeeh` and its
  Atlas tables as the canonical backend unless the owner explicitly decides
  otherwise in the source-of-truth reconciliation pass.
- Treat `atlas.ransomed.app` and the Cloudflare Worker as the live application
  and API surface. Supabase remains canonical data; the Worker is the only app
  backend and Cloudflare Access protects the owner surface.
- Historical references to Turso or project `mnfovwxgmhacfljcpkio` are stale
  unless verified in the current backend-map artifact.
- Local Atlas credential/cache files belong under
  `/Users/music/.config/atlas-action-tracker/`, not inside this repo.

For task creation, project work, execution, planning, or reporting, load
`/Users/music/.codex/automations/atlas-full-app-operating-contract.md`. Use the
live action/project/milestone/initiative/cycle/view/document/collaboration/
notification/Insight/release model while work is underway. Correlate and resume
before creating, checkpoint material changes, and preserve the no-filler rule.

The local duplicate-run preflight guard is disabled. Do not add it to prompts
or treat it as a completion signal. Durable writes must use database-level
idempotency and authoritative readback.

Never use destructive rollback SQL. Do not `DELETE` Atlas actions or activity
logs. Use status transitions plus `atlas_activity_log` evidence.

Do not commit local credentials or generated auth/cache files:
`.encryption_key`, `token_cache*.json`, `.wrangler/`, `worker/.wrangler/`, or
`*.key`.

Reports must separate implemented, verified, and remaining operational work.
