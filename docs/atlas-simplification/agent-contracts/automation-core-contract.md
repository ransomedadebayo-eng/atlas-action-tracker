# Automation Core Contract

## Jarvis lifecycle and fail-closed policy

Jarvis is a local execution journal. For progress logging only, use `begin
--caller automation --record-only` with explicit, realistic budgets. This
records the true caller, grants no execution authority, consumes no action
approval, and never launches a provider. An ordinary automation execution
approval remains exact, one-time, and independently enforced. Do not change
caller identity or fabricate approval records to get past a gate.

Perform only work authorized by the user's request and the applicable action
boundary. Missing required source identity, integrity, authority, or effect
readback blocks that dependent operation. An optional logging or telemetry
failure does not erase a separately verified outcome. For record-only logs,
`finish --telemetry-optional` still requires a named verifier, evidence, and an
accepted checkpoint; it records outcome and execution health separately.
Report what finished, the actual blocker and its owner, recovery attempted,
and the concrete resume trigger. A confirmed pre-action argument/start error
may receive one bounded correction; uncertain side effects require readback
before retry. Explicit compaction retains 90 days and protects active runs.

This is the shared rule cache for scheduled AEGIS/Atlas/PEOS/HealthOS/Wealth OS
automations. Per-automation prompts should contain schedule-specific logic only.

Any automation that creates, updates, selects, executes, reviews, or reports
Atlas work must also load `atlas-full-app-operating-contract.md`. That contract
defines when actions become projects, milestones, weekly plans, views,
documents, comments, notifications and delivery evidence, and
requires an `atlas_full_app_coverage` readback without filler records.

## Duplicate Runs

The owner disabled the local same-window preflight guard on 2026-07-23. Do not
add the guard to new or updated automation prompts. Legacy calls to
`automation-preflight-guard` return `ALLOW` without reading or writing lock
state while `${CODEX_HOME:-/Users/music/.codex}/automations/duplicate-guard-policy`
contains `bypass`.

Reruns must be safe at the authoritative mutation layer. Use stable idempotency
keys, database uniqueness constraints, existing-run/readback checks, sent-state
markers, and explicit no-op handling. A rerun may repeat source reads or
analysis, but it must not create duplicate durable records, publications,
messages, payments, or external actions. Never bypass these authoritative
idempotency controls.

Every call to `public.log_automation_run_report` must put the stable run key at
`p_artifacts.idempotency_key`. The RPC rejects missing keys and atomically
reuses the existing report and digest item for a matching
`user_id + automation_id + idempotency_key`. Do not use a clock timestamp,
random UUID, or launch/session ID as the run key; derive it from the stable
source, edition, action, or decision fingerprint named by the automation.

## Automation Paths

Resolve automation-local paths with `${CODEX_HOME:-/Users/music/.codex}` before
reading or writing memory, report artifacts, review packets, or local state. Do
not use bare `$CODEX_HOME` in shell snippets unless it has first been defaulted
or exported; unset `CODEX_HOME` can otherwise miss memory or target
`/automations`.

## Source Routes

Use local `supabase-aegis` first for AEGIS/Atlas/PEOS/Wealth OS/household
finance data. If local is unavailable or fails, try hosted Supabase fallback
and report the route used.

## Journal Boundary

Never write assistant execution logs to the PEOS journal. Use automation
reports, review queues, Atlas activity logs, agent signals, or local artifacts.

## Obsidian Studio Boundary

`/Users/music/Documents/AEGIS Studio Vault` is optional supporting context for
research, project rationale, writing, and explicit promotion candidates. It is
not a source of truth for current personal or operational state.

Interactive retrieval should search the vault before broad chat-history or
Supabase loads when noncanonical research, rationale, synthesis, reusable
patterns, or handoff context is relevant. This does not change authority
precedence: current canonical, sensitive, approval, Atlas, portal, finance,
health, family, legal, calendar, email, and operational state still require the
applicable authoritative source.

Do not create a separate Obsidian scheduler. `aegis-nightly-memory` owns the
only automated intake lane and must:

- use a local-first fast path for vault health, snapshot, and candidate
  fingerprints; when there are no explicit candidates, update local automation
  memory and finish without Supabase, Atlas, PEOS, or unfinished-chat scans;
- run `/Users/music/.codex/automations/bin/obsidian-studio-check.mjs` first;
- stop Obsidian intake when the checker reports integrity errors;
- after a successful checker run, execute
  `/Users/music/.codex/automations/bin/obsidian-studio-snapshot.sh`; if the
  snapshot or SHA-256 manifest fails, stop candidate intake and report the
  local-protection blocker;
- scan only changed files under `05 Decisions` that set both
  `status: proposed` and `aegis_candidate: true`;
- cap intake at 20 candidate files per run and deduplicate by the checker SHA-256
  fingerprint plus existing AEGIS proposals, events, reports, and automation
  memory;
- treat candidates as proposal-only and preserve approved versus applied as
  separate states; and
- report candidate files scanned, accepted, duplicate, invalid, and skipped,
  snapshot status, and `no_delta_reason` when none qualify.

Material execution continuity belongs to Jarvis receipts, rollout
reconciliation, and Atlas. This lane must not duplicate unfinished-chat
recovery or create a second execution tracker.

Never automatically scan Inbox, Research, Areas, journals, or `99 AI Staging`
into AEGIS. `aegis-goal-evolution-nightly` may consume verified AEGIS proposal
and implementation evidence derived from this lane, but must not mine the vault
directly.

## Owner Surface

Backend records are evidence, not review surfaces. Any owner decision requires
an owner-readable packet with the actual recommendation and consequence, not
only a UUID.

Before any owner-facing automation email, atomically call
`public.claim_automation_email_delivery` with the automation ID, the same
stable delivery idempotency key, and the America/Los_Angeles delivery date.
Send only when `claimed = true`. If the daily slot is already claimed, stage or
reuse the readable PEOS/digest surface and report
`delivery_deferred_daily_cap`; do not send. After the provider call, invoke
`public.finalize_automation_email_delivery` as `sent` or `failed` and read the
ledger row back. A failed or unknown provider result is not retried
automatically because the original delivery may have succeeded. This shared
ledger enforces the one owner-email-per-day cap across automations.

## Proposal Approval Boundary

For `public.ai_proposals`, owner acceptance is not implementation. Use
`approved` for accepted direction, and reserve `applied` for a later run that
actually made the change or advanced the work and verified it with tests,
readback, screenshots, source evidence, or another concrete verifier.

If an automation sees approved proposals, treat them as execution candidates:
expand the full packet, classify review gates, implement only low-risk approved
work that is allowed by protocol, then report `implemented`, `verified`, and
`remaining` separately. If implementation is blocked, leave the proposal
approved and create a clear blocker or next-decision record instead of marking
it applied.

After an automation acts on an approved proposal, it must log an
`automation_run_reports` row whose artifacts identify the proposal with
`proposal_id` or `proposal_packet_id`. PEOS uses that report as the owner-facing
final review surface. The proposal should move to `applied` only after the owner
reviews that result and closes it as done.

## Reporting Tiers

Full report: route, source counts, implemented, verified, remaining operational
work, artifacts, blockers, and escalation.

Compact report is allowed only when fewer than three sources were touched and no
proposal was created. Compact fields: status, implemented, verified, remaining,
blocker.

## Scheduler Health

Jarvis-managed automation runs must pass their exact automation ID,
occurrence key, scheduled time, approved budget, and the Codex session/thread
identity captured by the runtime. Before terminal success, reconcile the linked
rollout with `jarvis reconcile` or the automatic finish reconciliation. An
unavailable counter remains unavailable; zero is valid only after a reconciled
rollout proves no matching activity.

Use `jarvis doctor --scope core` for bounded performance/report automations.
Use strict `jarvis doctor --scope all` for global cutover, inventory, archive,
or policy-health claims. Inventory findings outside a bounded audit remain
visible limitations but do not redefine that audit's subject.

The local `jarvis monitor --once` watchdog checks every active Codex
automation against its America/Los_Angeles schedule, local automation threads,
rollout evidence, memory parity, and scheduler failure logs. It records early
or missing starts, startup failures, nonterminal runs, and parity gaps. Retry is
monitor-only by default and may occur once only for an explicitly allowlisted
startup failure that happened before an assistant turn, tool call, receipt, or
durable side effect. Never retry before the intended local scheduled time.

A scheduled automation launch with no assistant final message, no tool calls, no
same-run memory update, and no PEOS/AEGIS readback is incomplete, even when the
thread exists in the Codex session index. Count it as reviewed coverage, but
surface it as a scheduler/runtime gap rather than no-news or success.

Every scheduled run that performs tool calls or source loads must close with an
assistant final answer and either a same-run memory update or PEOS/AEGIS
readback. If a run stalls after setup, classify it as incomplete operational
work rather than allowing a local debounce lock to hide the completion gap.

View-only automation inspection is not a terminal action. If no schedule,
prompt, model, environment, or status mutation is needed, skip `automation_update`
view calls or treat them as optional diagnostics, then continue to session-close,
PEOS report, email summary when required, automation memory, and final answer.
A run must not end immediately after an automation-management view call.

For recurring automations with their own `memory.md`, PEOS/AEGIS readback and
automation memory must stay in parity. If a run logs a durable PEOS/AEGIS result
without a matching memory update, classify the durable report as implemented
and read back, and the stale or missing memory entry as a completion-writeback
gap. The next run should repair or explicitly report that memory gap.

## Proactive Assistant Loop

The following lanes describe intended responsibilities. A paused lane does
not execute them; verify replacement ownership before treating coverage as
active. A persisted next-wake field alone does not register a schedule. For a
multi-day case, retain its last verified step and verify an actual scheduled
continuation in its existing task. Do not create a duplicate automation for
behavior already owned by an active lane:

- `aegis-morning-brief`: daily front-door context, readiness, protected time,
  and one or two actionable next moves.
- `daily-email-atlas-triage`: input capture and CEO-filtered Atlas intake from
  mail; for a newly detected material case, correlate it, establish agent
  ownership, and advance the first safe steps in the same run.
- `atlas-stewardship-daily`: Atlas hygiene, stale-work detection, routing, and
  source-backed update or closure proposals; it also repairs orphaned case
  contracts and preserves agent ownership across approval waits.
- `agent-work-pull`: capped execution and resumption of eligible agent-owned
  Atlas cases, including safe portions of approval-gated workflows.
- `review-packet-digest`: at most three genuine executive exceptions after
  safe attempts, reusing authoritative same-day packets when they already
  exist.
- `aegis-nightly-memory`: local Obsidian integrity checks, verified snapshots,
  and explicit proposal-candidate intake. It does not recover unfinished chats
  or perform Atlas stewardship.
- `aegis-goal-evolution-nightly`: weekly cross-domain evidence synthesis,
  stable learning capture, and next-week leverage recommendations.
- `protocol-learning-weekly`: the sole scheduled owner for review-gated
  behavior, prompt, protocol, routing, cadence, model, sender, and
  approval-boundary change proposals. It must honor governance-backlog
  backpressure and never apply its own proposals.
- `peos-sunday-weekly-prep-brief`: weekly cross-domain synthesis and pruning.

These lanes must use the connected Atlas portfolio model defined in
`atlas-full-app-operating-contract.md`; a flat action scan is insufficient when
current project, milestone, weekly-plan, view, document, comment,
notification or portfolio-health context would change the decision.

Each run should classify its role as one or more of: `input_capture`,
`state_refresh`, `safe_execution`, `review_gate`, `learning`, or `delivery`.
Every non-duplicate run should report `work_advanced_score` in PEOS artifacts:

- `0`: summarized only.
- `1`: classified or routed.
- `2`: checked live sources.
- `3`: produced a draft, memo, checklist, artifact, or source-backed research.
- `4`: prepared an update or closure proposal.
- `5`: safely completed authorized work and verified it.

Task creation, routing, source preservation, and packet delivery do not prove
the underlying case outcome and cannot receive `5` by themselves.

Runs that find no meaningful delta should report `no_delta_reason` and avoid
creating new owner review items. If the same finding can recur, use a stable
fingerprint in `agent_signals.details_json.finding_fingerprint` or
`automation_run_reports.artifacts` before surfacing it again.

## Standard Artifact Fields

When schema supports JSON artifacts or evidence, include these fields for
proactive runs:

- `route_used`
- `context_loaded`
- `classification_used`
- `work_advanced_score`
- `source_graph`
- `evidence_checklist`
- `review_gates_hit`
- `next_loop_action`
- `delivery_status`
- `no_delta_reason`
- `case_id`
- `correlation_key`
- `case_owner`
- `case_state`
- `attempts_made`
- `waiting_on`
- `pending_approval`
- `next_wake`
- `escalation_reason`
- `obsidian_studio_check`
- `obsidian_candidate_counts`
- `obsidian_snapshot_status`
- `atlas_full_app_coverage`

## Durable Case Ownership

All material personal-operations automations must load
`${CODEX_HOME:-/Users/music/.codex}/automations/case-ownership-protocol.md`.
The system operates as an accountable company: Ransomed receives verified
outcomes and true exceptions, while the agent DRI owns investigation,
preparation, follow-through, and resumption.

- Correlate related signals into one case before creating new Atlas work.
- Store the case contract in existing Atlas/work-object/agent-run JSON fields.
- Evaluate authority per action. Do not exclude an entire case because a future
  action is a payment, send, portal change, or other review gate.
- Keep agent ownership while recording Ransomed as approver or `waiting_on`.
- Persist exact approval previews and action hashes; resume automatically on a
  matching approval.
- Use `waiting`, not generic `blocked`, for normal external or approval waits.
- Close through the live case-mutation grant only after current source
  verification and authoritative readback.
- Escalate only through the executive escalation contract in
  `communication-protocol.md`.

## Unfinished Codex Chats

Nightly scrub automations should inspect recent Codex session evidence for
owner-started task chats that ended without a final answer, verified handoff,
Atlas action, PEOS report, or explicit blocker. Treat these as continuity
intake candidates, not automatic task spam.

Only create or refresh Atlas work when the chat contains a concrete task,
material next step, or unfinished operational commitment. Deduplicate against
existing Atlas rows, agent runs, automation reports, and newer continuation
sessions before inserting anything. If the same work already exists in Atlas,
append or propose compact evidence instead of creating a duplicate row.

For each accepted unfinished-chat item, classify it with the proactive execution
protocol and advance safe internal work before review. Stop at review gates for
external sends, payments, legal, tax, identity, health, finance decisions,
portal mutations, production deploys, Atlas closures, or durable memory
corrections. Owner-facing review output must say what was recovered, what Codex
advanced, and what Ransomed should decide next; raw session IDs belong in
evidence fields, not the main review surface.

## Mutations

No deletes. Use status flips plus evidence logs. External sends, health,
finance, legal, tax, identity, public voice, and production deploys require
explicit authorization and verification.
