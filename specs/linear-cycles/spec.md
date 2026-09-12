# Linear Cycle Planning

## Purpose

ATLAS needs an execution-timebox layer that matches Linear cycles without
conflating it with Atlas Week. Atlas Week is a reviewed personal operating
plan; cycles are repeating work periods that scope actions, measure delivery,
forecast capacity, and roll unfinished work forward.

This is the third delivery slice of the broader Linear parity objective.

## Atlas Adaptation

Linear cycles belong to teams. ATLAS is owner-only and has no collaboration or
team-tenancy model, so cycle schedules belong to an optional configured
business lane. A schedule without a business is the workspace-wide default.

## User Stories

### US1 - Configure a repeating cadence

As the owner, I can enable a 1–8 week repeating cycle schedule, choose a start
date, optional whole-week cooldown, upcoming-cycle count, rollover, and active
issue capture.

### US2 - Plan cycle scope

As the owner or authorized agent, I can assign or move actions into current or
upcoming cycles and compare planned effort with forecast capacity.

### US3 - Track delivery

As the owner, I can see scope, started effort, completed effort, target pace,
success percentage, and scope-change history for each cycle.

### US4 - Close and roll forward

As the owner, I can complete a cycle transactionally. Completion freezes an
immutable snapshot and moves unfinished actions to the next cycle when
rollover is enabled.

## Functional Requirements

1. Cycle schedules support business lane, enabled state, 1–8 week duration,
   0/7/14 day cooldown, 1–15 upcoming cycles, start date, timezone,
   auto-rollover, and auto-add-active settings.
2. Configuration uses optimistic revision checks and never rewrites completed
   cycle history.
3. Reconfiguration archives superseded planned cycles rather than deleting
   them.
4. Cycles have stable numbers, names, start/end dates, planned/active/completed/
   archived state, revision, optional capacity override, and immutable
   completion snapshots.
5. An action belongs to at most one current cycle through
   `atlas_actions.cycle_id`.
6. Cycle assignment and removal are transactional and append action and cycle
   activity.
7. Completed, canceled, duplicate, and archived actions do not roll forward.
8. Open actions roll to the next cycle when the schedule enables rollover.
9. Auto-add captures newly started actions in the active matching cycle. During
   cooldown, newly completed actions may be attributed to the previous cycle,
   while newly started actions remain unassigned.
10. Completion snapshots store issue IDs, scope effort, started effort,
    completed effort, success percentage, and completion timestamp.
11. Cycle success counts completed work fully and started work at 25 percent.
12. Capacity uses the average completed effort of the previous three completed
    cycles. With no history, it uses a clearly labeled principal-based rough
    baseline or an explicit capacity override.
13. Scope events append current scope/started/completed effort whenever cycle
    membership, status, or estimate changes.
14. Completed snapshots remain fixed even if actions are later reopened or
    reassigned; detail payloads expose live/snapshot divergence.
15. Stable owner-facing routes are `/cycles` and `/cycles/:id`.
16. Cycle detail exposes actions, metrics, capacity, graph points, schedule,
    previous/next navigation, and rollover controls.
17. Action lists can filter by cycle and Action Detail can assign or remove a
    cycle.
18. Cycle, schedule, snapshot, scope-event, and activity rows cannot be
    physically deleted by application roles.
19. Cycle configuration/completion/start-now actions are owner-only. Scoped
    machine principals may read cycles and manage action membership only.
20. UI controls remain accessible and responsive on mobile and desktop.

## Success Criteria

- Configuring a schedule creates the correct active/upcoming sequence.
- Cycle scope and capacity are deterministic and estimate-aware.
- Completing a cycle freezes history and rolls only eligible actions.
- Cycle and action surfaces remain synchronized and auditable.
- Worker, app, database-contract, build, accessibility, and browser gates pass.

## Out Of Scope For This Slice

- Calendar subscription feeds.
- Multi-team cycle inheritance.
- Slack or external notifications.
- Automated scheduled execution of cycle transitions; the transactional
  contracts are ready for a later guarded automation.
