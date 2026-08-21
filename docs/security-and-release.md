# Security and release runbook

## Identity boundary

Ransomed is the only human allowed through Cloudflare Access. `ATLAS_OWNER_EMAILS` is an exact, comma-separated allowlist. Codex and Claude use entries in `ATLAS_API_PRINCIPALS_JSON`; each entry has its own secret and explicit scopes. Never share the owner session or one machine token across agents.

Project access uses `projects:read` and `projects:write`. Project archive and
restore remain owner-only even when a machine principal has `projects:write`.
Saved-view reads use `views:read`; all saved-view creation, update, favorite,
archive, and restore operations are owner-only. Project order and timeframe
RPCs are callable only through the service role and remain revision-protected.
Initiative reads and writes route through `initiatives:read` and
`initiatives:write`; archive and restore remain owner-only. Initiative graph,
membership, update, resource, and hierarchy RPCs are service-role-only, and the
hierarchy RPC enforces acyclic paths no deeper than five initiatives.
Template reads/instantiation use `templates:read` and `templates:write`, while
template configuration, defaults, duplication, and lifecycle remain owner-only.
Document reads/edits use `documents:read` and `documents:write`; document
archive/restore remains owner-only. Instantiation and lifecycle RPCs are
service-role-only and their provenance/version tables are immutable.
Discussion reads/writes use `comments:read` and `comments:write`. Comment
author/owner edit and lifecycle checks execute inside revision-protected RPCs;
thread resolution remains available to scoped writers. Attachments accept only
titled HTTPS metadata, and mentions accept only canonical principals.
Release reads/manual operations use `releases:read` and `releases:write`; CI
uses the isolated `releases:ingest` scope. A valid `x-atlas-release-key` binds
authentication to exactly one pipeline and cannot reach other Atlas APIs.
Pipeline key configuration is owner-only, hashes the raw key in the Worker,
stores only SHA-256 plus a short fingerprint, and was not invoked by this rollout.
Insight and dashboard reads/writes use `insights:read` and `insights:write`;
all saved-definition mutations remain owner-only. CSV endpoints use
`exports:read` plus an owner gate, cap rows, neutralize spreadsheet formulas,
and store only row count, filters, and SHA-256 receipt—not the exported body.
Workflow and Triage reads use `workflows:read`. Every configuration mutation,
status archive/reorder, rule activation, Triage decision, and inactivity apply
route is owner-only even if a machine principal has `workflows:write`. Rule
effect RPCs accept only non-terminal internal fields and reject completion,
archive, external send, publication, and approval-state effects. Applied event
keys are unique; Triage/rule/inactivity history is immutable.
Notification reads use `notifications:read`; Inbox transitions, target
subscriptions, and channel preferences remain owner-only. Integration reads use
`integrations:read`; connection mutation, signed endpoint verification,
activation, delivery processing, inbound review, and reference creation are
owner-only. `/hooks/:connectionId` is the sole unauthenticated integration path:
it requires an active inbound connection, a fresh timestamp, a unique delivery
ID, a bounded JSON body, and a versioned HMAC over timestamp, delivery ID,
event type, and the raw body before staging. Changing any signed header or the
body invalidates the signature; the database also rejects a repeated delivery
ID. It cannot mutate Atlas work. Raw signing secrets live only in exact
`ATLAS_INTEGRATION_SECRET_*` Worker bindings and never enter Supabase or browser
responses.
Realtime document reads use `documents:read`; edit authority is resolved from
`documents:write` or owner access before a WebSocket request is forwarded to
the `DocumentRoom` Durable Object. The room is not publicly addressable and
trusts only Worker-injected actor/client/authority headers. Connection identity,
cursor state, and rate-window counters use hibernation attachments; Supabase
alone stores canonical content, versions, accepted operations, and hash-only
conflicts. Messages are capped at 256 KiB, content at 200 KiB, clients at 20
messages/second, and overlapping changes never overwrite canonical content.

The custom domain is the owner UI route. Machine principals call the Workers.dev hostname with their bearer credential; every `/api` request is still rejected unless it passes Worker authentication and scope authorization.

## Secret handling

Store Worker secrets with `wrangler secret put`. Keep local values in `worker/.dev.vars` and browser-proxy values in `app/.env`; both are ignored. Never place Supabase credentials in Vite-prefixed variables or client code.

## Migration sequence

1. Snapshot staging and run migration regression SQL.
2. Apply forward migrations to staging in filename order.
3. Verify grants, deletion guards, active principals, active owners, taxonomy aliases, evidence quality, atomic action RPCs, the 25-assertion project regression contract, the 39-assertion action-structure contract, the 50-assertion cycle contract, the 50-assertion project-view contract, the 70-assertion initiative contract, the 81-assertion template/document contract, the 83-assertion collaboration contract, the 91-assertion releases contract, the 63-assertion Insights/export contract, the 101-assertion workflows/Triage contract, the 120-assertion notifications/integrations contract, and the 76-assertion realtime-documents contract by readback.
4. Deploy the Worker and run owner, Codex, and Claude scope smoke tests.
5. Deploy the frontend and run the accessibility smoke checklist.
6. Record implemented, verified, and remaining items. Production requires owner approval.

## Dependency-audit scope

The release gate audits production dependencies with `--omit=dev` and rejects
high or critical findings. The current release candidate passes that gate for
both the app and Worker; the Worker reports one moderate Hono advisory and the
app reports none. A broader development-toolchain audit currently reports
high/critical findings in build and local-emulation transitive dependencies.
Those do not ship in the Worker runtime, but remain maintenance debt and must
be refreshed through an explicitly authorized package-lock update. Do not
describe the full dependency tree as clean until that separate update passes.

Never use destructive rollback SQL. Correct a migration with another forward migration. Never delete actions or activity logs.

`atlas_saved_view_activity_log` intentionally has RLS enabled with no client
policy. The Worker writes it through the service role; the missing policy is a
fail-closed boundary, not an application exposure. Newly-created view indexes
may appear as unused until owner traffic exercises the corresponding view.
The six initiative tables use the same fail-closed RLS posture: no client
policies, explicit service-role grants, no destructive service-role grants, and
public RPC execution revoked. Their new indexes will report unused until the
owner creates initiative data and traffic exercises them.
Template and document tables also intentionally have no client RLS policies:
browser traffic must cross the Worker and public table/RPC grants remain
revoked. Template-instance foreign keys have dedicated indexes; unused-index
advisor notices are expected until real templates and documents exist.
Collaboration tables use the same fail-closed posture. Comment parent and
selected-resolution foreign keys have dedicated indexes; comments, reactions,
subscriptions, and collaboration history cannot be physically deleted through
the service role.
Release tables are also fail-closed with immutable CI events and action
attribution. Event keys serialize through a transaction advisory lock, stages
can freeze membership, and release completion reuses canonical completion
evidence instead of directly rewriting action status.
Analytics tables are fail-closed and snapshots/export receipts are immutable.
Prospective action timestamps populate only from real future transitions;
historical nulls must not be backfilled heuristically.
Workflow/Triage tables are also fail-closed. All 566 production actions were
assigned presentation statuses without altering their compatibility lifecycle.
Triage is disabled by default, rules are created paused, and no Worker cron was
added. Inactivity candidates require an owner preview/apply action; a future
guarded external scheduler must reuse the same idempotency and readback path.
Notification and integration tables use the same fail-closed model. Event and
attempt history are immutable; configuration, Inbox rows, outbox state, and
inbound review are non-destructive. Production intentionally has five owner
preference defaults, zero historical replay, zero connections, zero deliveries,
zero inbound receipts, and no `ATLAS_DELIVERY_ENABLED=true` binding. Creating a
Draft is not approval to verify, activate, or send to its endpoint.
Realtime document operation/conflict tables are fail-closed and immutable.
`wrangler.toml` has one forward `new_sqlite_classes=["DocumentRoom"]`
migration and no class deletion/rename. Durable Object hibernation coordinates
active sockets only; no document body is persisted in Durable Object storage.

## Incident containment

On suspected credential exposure, revoke the affected principal token, review Worker request logs and `atlas_activity_log`, and issue a unique replacement. On authorization drift, disable mutations before restoring data access. Do not claim recovery until source-of-truth readback confirms the intended grants and principal roster.
