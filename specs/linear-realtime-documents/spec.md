# Linear Realtime Documents and Editor

## User value

Atlas documents should feel live across the owner's devices and authorized
agents: edits save continuously, every connected viewer sees the same canonical
revision, cursors and presence are visible, conflicts never silently overwrite
work, and Markdown authoring has useful formatting and section navigation.

## Source baseline

- Linear Documents: https://linear.app/docs/documents
- Linear Editor: https://linear.app/docs/editor
- Cloudflare Durable Object WebSockets:
  https://developers.cloudflare.com/durable-objects/best-practices/websockets/

The 2026-08-20 Linear baseline includes collaborative editing with visible
cursors, realtime save/sync, last-editor attribution, version history/revert,
author names, Markdown and formatting toolbar/slash commands, object mentions,
templates, subscriptions, inline comments, and links to document headers.

## Requirements

### Canonical revisions and operations

- Supabase remains canonical for document content, title, revision, immutable
  versions, operations, conflicts, and audit evidence. Durable Objects coordinate
  connected clients but do not become a second durable document store.
- Every accepted edit has a client ID, operation ID, base revision, applied
  revision, base/result SHA-256, merge strategy, bounded change summary,
  selection, actor, and timestamp.
- Document/client/operation identity is unique and replay returns the original
  accepted result without another revision.
- Direct edits require the current expected revision. Stale edits use a
  deterministic three-way merge against the stored base version and current
  document. Non-overlapping changes merge; overlapping changes produce a
  conflict receipt and never overwrite canonical content.
- Reverting to an earlier version creates a new head revision and operation;
  history is never rewritten or deleted.
- Content is capped at 200 KiB, title at 500 characters, operation messages at
  256 KiB, and selection offsets are validated against content length.

### Authenticated realtime rooms

- One SQLite-backed Durable Object is addressed deterministically per document.
- `/api/documents/:id/realtime` accepts only authenticated WebSocket upgrades.
  `documents:read` may view; `documents:write` or owner access may edit.
- The Worker resolves identity and edit authority before forwarding to the
  Durable Object. The room trusts only Worker-provided internal headers.
- Hibernation is enabled. Actor, client ID, authority, selection, rate-window,
  and document ID live in serialized WebSocket attachments so wake/eviction
  cannot erase connection identity.
- On connect, the client receives a canonical snapshot and the current presence
  roster. Join, leave, cursor/selection, applied edit, conflict, error, and pong
  messages use a versioned JSON envelope.
- The room serializes edit processing with `blockConcurrencyWhile`, applies the
  canonical RPC, and broadcasts only the database-confirmed document/revision.
- Each client is limited to 20 edit/presence messages per second. Invalid or
  oversized messages receive an error and repeated abuse closes the socket.
- Client reconnection uses exponential backoff from 1 to 30 seconds, resends
  presence, reloads the canonical snapshot, and preserves an unsynced local
  draft for explicit recovery.

### Editor experience

- The document detail page shows connection/sync state, current revision, last
  editor, and live actor/device presence with cursor/selection ranges.
- Title and content autosave through realtime edits after a short debounce;
  explicit Save remains as a flush control. Archived documents are read-only.
- The Markdown toolbar supports bold, italic, strikethrough, inline code,
  links, H1/H2/H3, bullets, numbered lists, checklists, blockquotes, code blocks,
  dividers, tables, and dates. A slash menu exposes the same structural blocks.
- The outline parses Markdown headings, generates stable unique slugs, scrolls
  to sections, and copies canonical `#heading` URLs.
- Version history can preview and owner-revert. Operation history shows author,
  merge strategy, and revision; conflicts show hashes/reason without storing an
  unnecessary duplicate document body.
- Existing template provenance, document subscriptions/notifications, inline
  anchored comments, replies, reactions, and resolution remain integrated.

### Failure and compatibility behavior

- WebSocket unavailability falls back to the existing revision-aware REST save
  path and clearly labels the session offline—not realtime.
- A legacy REST title/content update is broadcast to the room after canonical
  readback so connected clients do not drift.
- Conflicts show the latest canonical text and preserve the local draft in the
  browser; Atlas never auto-selects one version.
- Empty rooms incur no active compute while hibernated. No cron, external
  provider, Supabase browser key, or new credential is introduced.

### Security and verification

- New public-schema tables use RLS, public/anon/authenticated grants are
  revoked, service-role grants exclude delete and history updates, and
  privileged functions are explicitly revoked from public roles.
- Durable Object configuration uses one forward `new_sqlite_classes` migration;
  no delete/rename migration is allowed.
- Tests cover merge correctness, conflict detection, operation idempotency,
  version revert, WebSocket authority/messages/presence/reconnect, toolbar and
  outline behavior, RLS/grants, and live route/binding deployment.

## Success criteria

- The database migration passes a rolled-back production rehearsal and pgTAP;
  existing documents and versions remain unchanged and no test operation or
  conflict persists.
- `wrangler deploy --dry-run` validates the Durable Object binding/migration
  before the live deployment.
- The live Worker exposes the new WebSocket route behind existing auth,
  Cloudflare reports the Durable Object binding, and the document UI asset
  contains realtime, presence, toolbar, outline, and conflict controls.
- Repository tests, typecheck, build, production dependency audit, database
  advisors, and authoritative production readback are green.
