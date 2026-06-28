# Atlas-First Automation Simplification

## User Value

Atlas is the daily execution surface. The Today page should show only the work Ransomed is meant to complete today, while backlog, review, approvals, and personal journal capture live in separate Atlas surfaces.

## Behavior

- Today reads `atlas_daily_plans` and renders selected daily items only.
- If no plan exists, Today shows a clear diagnostic plus bounded fallback candidates from due and overdue Atlas actions.
- Nightly retriage writes one plan per local date with selected, deferred, suppressed, and review items.
- Morning Brief should summarize the Atlas Today plan instead of independently generating a competing list.
- Review shows assistant output, blocked/completed work, and review-gated actions.
- Decide shows approvals, rule proposals, protocol proposals, and high-risk decision signals.
- Journal remains user-authored personal capture only.

## Success Criteria

- A manual or scheduled retriage run creates a current `atlas_daily_plans` row and 3-5 selected items.
- Today does not render the full backlog.
- Missing plans are visible as an operational diagnostic, not an empty day.
- Review/Decide/Journal work inside Atlas without relying on PEOS pages.
