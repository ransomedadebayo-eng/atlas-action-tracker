# Atlas Today Rules-Based Retriage Specification

## User Value

Atlas Today should act like a daily assistant-prepared worklist. It must show an achievable set of tasks for the day, not every active or overdue Atlas action. Ransomed should be able to see why each item is present, what was intentionally left out, and what needs PEOS review after assistant execution.

## Functional Requirements

- The Today page reads from a date-specific daily plan when one exists.
- The daily plan contains selected, review, deferred, and suppressed items.
- Each item records matched rules, score, source evidence, reason text, review gate, and source action/report ids when available.
- Rules live in editable database rows and are snapshotted into immutable versions for each plan run.
- Rule changes are proposal-first. A rule proposal must be reviewable in PEOS before activation.
- The nightly Atlas stewardship lane refreshes the plan after source review and duplicate-guard preflight.
- iMessage must be represented as unavailable until a real readable connector or import path exists.
- Atlas action priority, status, owner, due date, and closure are not changed by Today selection.
- PEOS shows assistant-completed work, owner decisions, blocked sources, and rule proposals without writing assistant logs to the PEOS journal.

## Success Criteria

- Atlas Today displays only the curated daily list by default.
- A recovery-readiness day caps owner work to three selected items.
- Every selected or deferred item has a human-readable reason.
- The active rule version used for a plan is visible from Atlas and PEOS.
- A dry run can produce the plan shape without database writes.
- The nightly automation report separates implemented, verified, and remaining work.

## Out Of Scope

- Automatic iMessage ingestion.
- Automatic direct mutation of Atlas actions from Today scoring.
- External notifications or email sends outside existing automation approval gates.
- Replacing the full Atlas backlog, dashboard, kanban, or calendar views.
