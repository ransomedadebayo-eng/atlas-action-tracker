# Weekly Plan Integration Contract

Atlas owns the weekly-plan lifecycle and the web review surface. The guarded
Sunday Weekly Prep automation owns source gathering and draft composition.

Machine principal configuration should grant Codex and Claude
`weeks:read`, `weeks:write`, and `weeks:request_review`; the publish route stays
owner-only regardless of machine scopes.

## Sunday Weekly Prep

1. Resolve the next Monday in `America/Los_Angeles`.
2. Read canonical `atlas_actions` and the approved calendar source.
3. Build safe calendar commitment rows containing only `source_ref`, `title`,
   `starts_at`, `ends_at`, `all_day`, `source_label`, `captured_at`,
   `source_as_of`, and `coverage_status`.
4. Call `POST /api/weeks/drafts` (or the equivalent service-role RPC) with a
   stable `source_fingerprint` and idempotency key.
5. Populate the returned draft through the revision save RPC. If a draft has
   already been edited or review-requested, do not overwrite it; surface the
   newer source fingerprint as refresh-available.
6. Request review after the draft passes the automation’s source-coverage and
   action-link checks. Publication remains owner-only.

The Worker never runs the planner or calendar connector. Calendar rows are
read-only snapshots and must not be used to mutate action due dates,
ownership, status, or priority.

## Daily stewardship

Daily stewardship reads the latest `published` weekly revision for the current
Pacific week. It may adapt the day’s active plan for urgent or completed work,
but it records `source_weekly_revision_id` on the daily plan, the matching
`source_weekly_item_id` on guided items, and a human-readable
`weekly_deviation_reason` when it diverges. Draft weekly revisions never feed
Today. A newly published midweek revision affects subsequent daily retriage,
not already-written history.
