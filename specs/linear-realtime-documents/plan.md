# Implementation Plan

## Schema

- Add immutable document operation and conflict tables with hashes, revisions,
  selections, merge/revert metadata, and indexes.
- Add transactional realtime-edit, conflict-receipt, and version-revert RPCs.
- Keep the existing document audit trigger as the single source of version rows.
- Enable fail-closed RLS, revoke public access, and prevent destructive/history
  mutation.

## Worker and Durable Object

- Add pure single-change diff and deterministic three-way merge utilities.
- Add a SQLite-backed `DocumentRoom` Durable Object with hibernating WebSockets,
  serialized attachments, presence, rate limits, canonical snapshot/edit flow,
  conflict response, and broadcast.
- Add authenticated WebSocket forwarding plus legacy REST-update broadcast.
- Add the binding and one forward Durable Object migration to `wrangler.toml`.

## Frontend

- Add a reconnecting document collaboration hook with sync states, debounced
  edits, local-draft recovery, presence/selections, conflicts, and fallback.
- Upgrade Document Detail with Markdown toolbar/slash commands, heading outline
  and links, live presence, operation/conflict history, and version revert.
- Preserve existing comments, template provenance, archive/restore, and list UI.

## Verification and release

- Add pgTAP, merge, Durable Object protocol, route, hook/component,
  authorization, accessibility, and architecture-contract tests.
- Run full check, production audits, `wrangler deploy --dry-run`, migration
  rehearsal, production pgTAP/advisors/readback, then deploy and verify live
  routes/assets/bindings.

## Production evidence

- Supabase migration `atlas_realtime_documents_linear_parity` applied and the
  production pgTAP contract passed 76/76.
- Production readback: zero documents, versions, operations, conflicts,
  realtime-edited documents, or test rows; both new tables enforce RLS,
  service-role RPC execution is present, and operation-history updates are absent.
- Advisor follow-up reports no realtime-document performance finding; the two
  RLS-with-no-policy notices are the intentional Worker-only posture.
- `wrangler deploy --dry-run` reported the `DOCUMENT_ROOM (DocumentRoom)`
  Durable Object binding before release. Cloudflare version
  `5284ca69-68fa-4220-9265-a691d6bce22c` then deployed the binding, first
  SQLite-class migration, authenticated WebSocket route, and
  `DocumentsPage-yZ0I4XHA.js`.
- Live readback: `/documents` returns the SPA, document REST/WebSocket paths
  return 401 without authentication, and the UI chunk contains live presence,
  toolbar, slash commands, outline, operation, conflict, and revert controls.
