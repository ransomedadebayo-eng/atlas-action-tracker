# ATLAS Action Tracker

ATLAS is the owner-only execution surface for AEGIS. Ransomed is the sole human owner; Codex and Claude are scoped machine principals. The application is not collaborative and does not support invitations, sharing, or additional active people.

## Architecture

- `app/`: React/Vite UI and Capacitor wrapper.
- `worker/`: canonical Hono Cloudflare Worker API and static asset host.
- `migrations/`: forward-only AEGIS Supabase migrations.
- `specs/atlas-trust-overhaul/`: current product and delivery contract.
- `specs/linear-project-foundation/`: first-class project-management contract.
- `specs/linear-issue-structure/`: hierarchy, typed relations, duplicate resolution, and estimates.
- `specs/linear-cycles/`: repeating execution cycles, capacity, snapshots, and rollover.
- `specs/linear-project-views/`: durable project views plus list, board, and dependency-aware timeline layouts.
- `specs/linear-initiatives/`: strategic objectives, multi-parent hierarchy, recursive project rollups, health, resources, and graphs.
- `specs/linear-templates-documents/`: standard/form action templates, full project templates, document templates, provenance, and versioned Markdown documents.
- `specs/linear-collaboration/`: cross-surface comments, replies, reactions, resolutions, inline anchors, attachments, and subscriptions.
- `specs/linear-releases/`: continuous/scheduled delivery pipelines, stages, CI evidence, release attribution, notes, and changelogs.
- `specs/linear-insights-exports/`: real-time Insights, dashboards, lifecycle metrics, snapshots, drill-down, and audited CSV exports.
- `specs/linear-workflows-triage/`: business-scoped statuses, Triage decisions, deterministic rules, and inactivity receipts.
- `specs/linear-integrations-notifications/`: Inbox events, preferences, verified connections, signed webhooks, retries, and inbound staging.
- `specs/linear-realtime-documents/`: canonical edit operations/conflicts, Durable Object rooms, presence, merge-safe autosave, rich Markdown controls, and version revert.
- Guarded Codex protocols are the only automation runtime. The Worker automation registry is read-only.

The AEGIS Supabase project `vdezxdeushxaacyfjeeh` and `public.atlas_actions` are canonical. The Worker is the only application backend; browser code never receives Supabase or machine-principal secrets.

The owner UI uses `atlas.ransomed.app` behind Cloudflare Access. Codex and Claude use the authenticated Workers.dev API endpoint because Cloudflare Access intentionally intercepts non-owner traffic on the custom domain before Worker authentication.

ATLAS Projects add an outcome-level layer over actions: portfolio and project
detail routes, milestones, health updates, dependencies, action effort, and
progress rollups. Saved project views preserve filters and display settings;
the portfolio supports list, status-board, and dependency-aware timeline
layouts with manual ordering, completion windows, milestones, zoom, and guarded
timeframe movement. These slices are implemented and test-verified in this
release candidate. Owner-UI visibility is not considered deployed until the
main deployment and authenticated route readback pass.

ATLAS action structure adds inherited sub-actions, parent/child effort rollups,
typed related/blocking/duplicate edges, explicit duplicate resolution, and
configurable estimate scales. Structured blockers remain synchronized with the
legacy `blocked_by` readiness field during migration.

ATLAS Cycles add business-scoped or workspace schedules, capacity based on the
previous three completed cycles, estimate-aware scope graphs, immutable
completion snapshots, active-action capture, and transactional rollover. They
remain distinct from the reviewed Atlas Week plan.

ATLAS Initiatives add the strategy layer above projects: owner/status/priority/
labels/target properties, list and timeline views, five-level multi-parent
hierarchies, deduplicated recursive project rollups, structured health updates,
resources, and weekly completion graphs. Initiative and project surfaces share
one canonical membership graph.

ATLAS Templates provide reusable standard and structured-form action blueprints,
transactional project plans with milestones/actions/sub-actions/initiatives, and
document blueprints. Defaults resolve by exact business then workspace fallback,
and every instance retains immutable provenance. ATLAS Documents are first-class,
context-bound Markdown records with optimistic revisions, immutable versions,
and archive/restore lifecycle.

ATLAS Collaboration provides one canonical discussion system for actions,
projects, initiatives, documents, and project/initiative updates. It supports
one-level reply threads, selected resolutions, Unicode reactions, canonical
mentions, HTTPS attachment metadata, revision-bound inline text anchors,
follow/mute state, author/owner editing, and non-destructive archive/restore.

ATLAS Releases separates completed work from delivered work using continuous or
scheduled pipelines, ordered environments/stages, freeze-on-start membership,
version/commit identity, action attribution, deterministic/manual notes,
changelogs, completion evidence automation, and idempotent CI events. Pipeline
access keys are SHA-256 hashed and remain unconfigured until explicitly set.

ATLAS Insights adds issue count, effort, cycle/lead/triage time, and issue-age
measures; flexible filters/slices/segments; bar/scatter/burn-up/metric/table
views; drill-down; reusable dashboards; immutable snapshots; and formula-safe
CSV exports with hashed receipts. Lifecycle timing is prospective and unknown
historical starts remain explicitly missing.

ATLAS Workflows adds one ordered status model per business lane, fixed lifecycle
categories, custom names/colors/defaults, a reserved Duplicate state, and a
special Triage inbox with accept, decline, duplicate, and snooze decisions.
Owner-activated rules evaluate top-to-bottom, retain conflicts, and write
idempotent receipts; they cannot complete, archive, send, publish, or bypass an
approval boundary. Inactivity handling is preview-first and owner-triggered.

ATLAS Notifications provides a future-only owner Inbox, unread/read/archive
lifecycle, per-channel preferences, target subscriptions, and a 2,000-open-item
retention boundary. The integration layer adds draft connections, exact HTTPS
endpoint verification, environment-only signing secrets, HMAC payloads, stable
delivery IDs, a five-second timeout, three backoff retries, immutable attempts,
dead-letter pausing, external reference/thread identities, and signed inbound
staging. Production has no configured destination and automatic draining is off.

ATLAS Documents now coordinate authenticated realtime rooms through a
SQLite-backed Cloudflare Durable Object while Supabase remains canonical.
Connected clients receive live snapshots, presence and cursor selections;
autosave operations are idempotent and three-way merged when disjoint, while
overlapping edits retain the local draft and write a hash-only conflict receipt.
The editor adds Markdown formatting and slash commands, heading outlines and
links, reconnect/offline fallback, operation attribution, and append-only
version revert.

ATLAS actions now receive immutable `ATLAS-N` identifiers. Pasting an identifier
into an action, project, document, or comment creates durable reference evidence;
action-to-action references also create automatic related links and backlinks.
Workflow settings can safely auto-close parents or eligible sub-actions without
crossing owner/review gates. Parent actions can be converted transactionally
into projects, with their direct children preserved as standalone project work.
Projects expose contextual saved action-view tabs, and Cycles support explicit
start-today realignment plus authenticated `.ics` downloads.

Task-management automations use the full connected Atlas portfolio through the
shared no-filler operating contract. The canonical queue is organized into projects,
initiatives, milestones, contextual boards, one bounded execution cycle,
documents/backlinks, project updates, Inbox subscriptions, and a portfolio
dashboard. See [task-management operating model](docs/task-management-operating-model.md).

## Local development

1. Copy `worker/.dev.vars.example` to `worker/.dev.vars` and provide local secrets.
2. Copy `app/.env.example` to `app/.env` and set the local proxy token.
3. Run `npm run install:all` from the repository root.
4. Run `./launch.command`, or run `npm run dev --prefix worker -- --port 3001` and `npm run dev --prefix app` separately.

## Verification

Run `npm run check` from the repository root. CI builds the UI, typechecks and tests the Worker, and rejects high/critical production dependency advisories before deployment. Database verification includes the 50-assertion project-view, 72-assertion initiative, 81-assertion template/document, 83-assertion collaboration, 91-assertion releases, 63-assertion Insights/export, 101-assertion workflows/Triage, 120-assertion notifications/integrations, 76-assertion realtime-documents, 36-assertion core-conveniences, 40-assertion portfolio-activation, and 14-assertion portfolio-hierarchy pgTAP contracts.

## Release boundary

Database migrations are forward-only. Never delete Atlas actions or activity records; archive or restore them through audited transitions. Production migrations and deployments require staged readback evidence and owner approval.
