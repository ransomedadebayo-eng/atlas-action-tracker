# Atlas Full-App Operating Contract

Owner-authorized on 2026-08-20 by the instruction to update task-management
automations and protocols to use the complete live Atlas build and to make the
current queue occupy the appropriate project-management surfaces.

This contract governs any automation, agent, or protocol that creates,
updates, selects, executes, reviews, or reports Atlas work. It extends the
action-boundary, case-ownership, proactive-execution, project-continuity, and
automation-core contracts. It grants no external authority and never turns
empty product surfaces into a reason to create filler work.

## Operating outcome

Atlas is a connected operating system, not a flat task table:

- **Actions** are executable units with immutable `ATLAS-N` references.
- **Parent/sub-actions** express real decomposition. Completion is explicit; completing a parent or child never closes another action automatically.
- **Projects** hold bounded multi-step outcomes.
- **Milestones** represent verifiable project stages, not decorative headings.
- **Weekly plans** choose higher-order outcomes and dated focus from current
  projects and milestones without rewriting source-action semantics.
- **Triage** is the temporary intake lane for material work whose project,
  owner, or status still needs classification.
- **Saved views** provide useful project/workspace perspectives that an owner
  will revisit.
- **Documents** hold durable specifications, evidence memos, decisions, and
  operating context that is too substantial for an action field.
- **Comments and project updates** record collaboration and health changes.
- **Notifications** surface subscriptions, assignments, mentions, material
  state changes, and exact approval interrupts without duplicating work.
## No-filler rule

Use every relevant surface, but never manufacture scope. A row, project,
milestone, weekly-plan selection, view, document, comment or notification must answer a real operating question.

Do not:

- create one project per trivial action;
- put dormant, waiting-external, waiting-approval, or user-only work into the
  weekly plan unless it has a concrete executable step in the week;
- create duplicate views that differ only by name;
- copy action notes into documents without adding durable context;
- emit comments, notifications, or project updates as activity theater;
- assign estimates where the work is too ambiguous to estimate honestly; or
- claim delivery without a real delivered artifact and verifier.

## Interactive working loop

This contract applies during ordinary collaboration, not only scheduled runs.

- **Start:** when Ransomed asks to track work, or the work is material,
  multi-step, resumable, or already represented in Atlas, correlate and resume
  the canonical action/project before execution. Simple questions and trivial
  one-step work stay outside Atlas.
- **Work:** use the project document, milestones, comments/updates, relations,
  weekly-plan selection, and action evidence as shared working context. Checkpoint a
  material decision, artifact, blocker, source change, or verifier result—not
  every tool call.
- **Handoff:** if work continues, persist the next action, case owner,
  `waiting_on`, exact gate, next wake, artifact references, and resume trigger.
- **Finish:** close only verified agent-owned outcomes. Personal/user-only work
  requires owner confirmation or authoritative external evidence. A delivered
  artifact is linked in action evidence only after its delivery verifier passes.
- **Coordination:** the root assistant or accountable core lead is the single
  Atlas writer. Specialists return checkpoint inputs and never create competing
  tasks, projects, documents, or status claims.

## Intake and correlation

Before creating an action:

1. Search identifiers, source references, correlation keys, titles, projects,
   documents, and active/archived actions for an existing canonical case.
2. If a material signal belongs to an existing case, update the source graph,
   action ledger, or comment instead of creating a new action.
3. If classification is incomplete, create or refresh one action with status `open` (Needs triage). Do not
   guess a project merely to avoid Triage.
4. When creating new work, populate the smallest defensible execution
   contract: outcome-oriented title, business, owner, work mode, priority,
   source, next action, definition of done, approval state, and evidence.
5. Reference related work with `ATLAS-N` in durable text so automatic links and
   backlinks are available. Do not depend only on opaque UUIDs.

## Project architecture

Promote actions into a project when any of these is true:

- the outcome has at least two meaningful actions;
- it crosses more than one source, contributor, or approval gate;
- it needs staged dates, milestones, health reporting, or durable context;
- it spans more than one week; or
- an existing parent action has become a durable outcome and the owner-approved
  conversion contract applies.

Project rules:

- Reuse an existing project by stable outcome/correlation key.
- Set one accountable lead, realistic status, priority, start/target dates,
  update cadence, and a concise summary.
- Create milestones only for stages with distinct verifier evidence.
- Assign actions transactionally and clear stale milestone membership when the
  project changes.
- Keep project health at `no_update` until evidence supports `on_track`,
  `at_risk`, or `off_track`.
- Add a project update only for a material state, health, scope, risk, or
  decision change.
- Maintain at least one useful contextual action view for a multi-action
  project. Prefer `Open work`, `Needs review`, or a milestone/status board.

## Planning and capacity rules

- Projects grouped by business are the single container for multi-step work.
- The published weekly plan selects must-wins and day focus; Today consumes that cadence.
- Planning must not change a source action's status, priority, owner, due date, approval state or evidence.
- Apply estimates only when sufficiently defined; otherwise preserve `unestimated`.
- Triage means actions whose status is `open`; use the Needs triage status filter.
- Canonical statuses are open, not_started, in_progress, waiting, blocked, done, canceled and archived. Existing historical aliases are displayed canonically without rewriting rows.

## Execution and collaboration

During safe execution:

- Work from the action's project, milestone, dependencies, references,
  document context, and prior comments before opening a wider source graph.
- Update the action ledger/evidence after meaningful progress.
- Add a concise comment when collaboration context would otherwise be lost.
- Update a project document for durable specifications, research, or decisions.
- Post a project health update only when project state materially changes.
- Resolve blockers and relations when authoritative evidence changes them.
- Close actions only through the existing evidence-bearing lifecycle.
- Parent and sub-action completion always requires the existing explicit evidence-bearing lifecycle; never bypass `user_only`, `needs_review`, or `deferred` protections.

## Review and notification

- One case has one owner-facing exception. Notifications, Today, weekly plans,
  email digests, and project views may point to it but must not duplicate it.
- Subscribe the accountable principal to material projects/cases when useful.
- Use an exact approval interrupt for consequential actions; the case remains
  agent-owned and resumes from the same action hash.
- Prefer Atlas Inbox and contextual project views for normal operating state.
  Email or messaging is reserved for material owner attention under the
  communication and delivery contracts.

## Portfolio health

The Projects list shows open action count, oldest open age and a stale flag for in-progress projects without activity for more than 14 days.
Use action status filters for blocked, waiting and Needs triage work.
Do not create Insights, dashboards or export receipts; these Atlas surfaces are retired.

## Automation lane responsibilities

### `daily-email-atlas-triage`

- Correlate mail with existing actions/projects/documents first.
- Use Triage for genuinely material but unclassified intake.
- Create at most the existing bounded number of new cases.
- Attach a newly created action to a known project only when the match is
  authoritative; otherwise leave its status `open` for triage for stewardship.

### `atlas-stewardship-daily`

- Own portfolio architecture and hygiene: unprojected work, project/milestone
  membership, useful views, weekly-plan readiness, estimates, dependencies,
  project health, stale Triage, and duplicate/orphaned cases.
- Make only narrow reversible internal mutations authorized by the live case
  grant and this owner instruction, with stable idempotency and readback.
- Do not force all actions into projects.

### `agent-work-pull`

- Prefer eligible items from this week's published weekly plan, then the highest-priority healthy projects, while allowing due resumptions outside the plan.
- Load project/milestone/document/relation/comment context before execution.
- Persist collaboration and project-health changes when material.

### `peos-sunday-weekly-prep-brief`

- Select higher-order outcomes from current projects and milestones before falling back to isolated actions.
- Preserve the Four-Lane capacity contract and source-action semantics.
- Keep weekly-plan selection read-only with respect to source action semantics.

### case-owning finance, health, family, property, and business automations

- Reuse a domain project when the case is multi-step or durable.
- Keep the exact sensitive mutation gated while using projects, documents,
  milestones, references, and comments for safe preparation and continuity.

### learning and review automations

- Read portfolio metrics and project state; do not mutate architecture.
- Propose durable changes through the governed protocol-learning lane.

## Required readback

Any run that mutates Atlas structure must record and verify:

- canonical action identifiers and case correlation;
- action/project/milestone/weekly-plan selection before and after;
- revisions and idempotency keys;
- created or reused views/documents and evidence records;
- notification or approval state when applicable;
- absence of unintended status, priority, owner, due-date, approval, or
  evidence changes; and
- `implemented`, `verified`, and `remaining_work` separately.

Report a compact `atlas_full_app_coverage` object in automation evidence:

```json
{
  "actions_considered": 0,
  "actions_projected": 0,
  "triage_pending": 0,
  "projects_touched": 0,
  "milestones_touched": 0,
  "views_touched": 0,
  "documents_touched": 0,
  "comments_or_updates_touched": 0,
  "no_filler_assertion": true,
  "source_action_semantic_diff": {}
}
```

`triage_pending` counts actions with status `open`.

Zero is valid when the surface is not relevant; it must be intentional and
explained, not silently omitted.
