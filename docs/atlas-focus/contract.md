# Atlas project focus — implementation contract

Status: implementation and exact database proposal authorized; migration `20261019040756` applied and verified on 2026-10-19. Deployment/live verification remain separate release steps.
Baseline: `0500a24511301eb8a69f58202198d1a062dcc68b`.
Owner request: “Build this into atlas instead and I can select the project I’m working on” (2026-10-19).
Reference: [Pomodoro · Focus Room](https://pomodoro-focus-room.ransomed.chatgpt.site), private version 1, source commit `18c7fae6110e45404ade7666765d79fc592fec91`. The original remains intact; its browser-local tasks/history are not migrated. Its delivery records 41 automated tests and unverified browser visual/mobile QA; Atlas needs its own verification.

## Decision

Use the existing owner-authenticated Worker and Supabase, with dedicated state, immutable session ledger and operation receipts. One row-locking, security-invoker RPC settles time and applies a command atomically. Existing `atlas_config` JSON CAS would need a growing history blob or a cross-row completion outbox and replay protocol; dedicated relational storage is the smaller maintainable design. No action/project completion, credentials, principal scopes or existing permissions change. New objects use RLS without browser policies and the existing Worker service role only; applying those definitions/grants requires the separate owner gate.

## API

All routes are owner-only after existing authentication/authorization. Other principals stay denied without adding scopes. Errors use the shared Atlas `apiError` format (`code`, `message`, optional `details`, `request_id`); the client already accepts flat and nested errors. Missing schema returns actionable `503 FOCUS_STORAGE_UNAVAILABLE`.

- `GET /api/focus` returns state below, without creating records or completing sessions.
- `POST /api/focus/commands` accepts `{operation_id: UUID, expected_revision: nonnegative integer, command, ...payload}` and returns state. Commands: `start` with `project_id` (required for focus), `pause`, `resume`, `reset`, `skip`, `settings` with complete settings, `select_phase` with phase (ready only), and `reconcile`.
- `GET /api/focus/history?limit=20&cursor=...&project_id=...` returns `{items, next_cursor, totals: {completed_sessions, focus_ms}, projects: [{project_id, project_name, completed_sessions, focus_ms}]}`. Totals include all completed focus rows matching the project filter, regardless of history pagination. Cursor must have a stable timestamp/session-ID tie-breaker.

State shape:

```json
{
  "server_now": "ISO timestamp",
  "revision": 0,
  "settings": {"focus_minutes":25,"short_break_minutes":5,"long_break_minutes":15,"chime_enabled":false},
  "phase": "focus",
  "status": "ready",
  "session": null,
  "deadline_at": null,
  "remaining_ms": 1500000,
  "completed_focus_count": 0
}
```

`session` is `{id, project_id, project_name, business, started_at, duration_ms}`. A session has an immutable project ID and name/business snapshot obtained from the actual project row at start; archived/renamed projects retain readable history. Focus starts require a current non-archived, non-completed, non-canceled project. Breaks may retain the last project context but never add focus totals. Duration bounds: focus 1–180, short break 1–60, long break 1–120 whole minutes. Settings affect the next fresh timer; changing them does not shorten/rebase an active session.

Session ledger items: `{id, project_id, project_name, business, phase, outcome, duration_ms, focused_ms, started_at, ended_at}`, outcome `completed|reset|skipped`. `focused_ms` counts actual active time (pause excluded, capped at duration). Only completed focus rows contribute to focus totals. Reset/skip preserve an interrupted ledger entry when a session exists; a ready reset creates no history. Reset keeps the same phase ready, skip advances focus→appropriate break→focus. Phase selection allowed only when ready, never discards a running/paused session. Start/resume and pause transitions validate status, never silently overwrite a session.

The RPC locks the owner row, checks operation receipt/fingerprint and revision, then samples database time. If the current session expired, it settles once and returns the next phase ready without applying a second transition from the same click. The expired session ends at its stored deadline even when reconciled much later; subsequent phases never auto-run. Every fourth completed focus selects a long break. Identical operation retries return the committed result; reused IDs with a different payload return `OPERATION_CONFLICT`, stale revisions `REVISION_CONFLICT` (both 409). On retry the client refreshes state, retaining the operation ID after uncertain network failures and not silently replaying user commands after a revision conflict.

## UI / verification

Route `/focus`, native Atlas navigation, actual searchable project picker (authoritative IDs), clear current project, adjustable durations, opt-in chime, readable timer, pause/resume/reset/skip, four-session cycle, session history and project totals. Mobile touch targets, keyboard access, reduced motion and useful empty/loading/error states. Current session context is locked until reset/skip/completion; the next project can then be selected explicitly.

Client countdown uses server deadline plus measured server clock offset, not decrement ticks. It refetches on visibility/focus/reconnect and periodically while running; expired timers reconcile exactly once with retry/backoff and revision conflict recovery. Repeated polling cannot repeatedly chime; sound requires the owner's opt-in and a browser gesture.

Verification: meaningful app/Worker unit tests; real local PostgreSQL transaction, retry, grant/RLS and concurrency tests against the exact proposal; synthetic desktop/mobile browser workflows and screenshots; independent review; established GitHub checks/release and authenticated live smoke after required database approval. Preserve existing projects/actions/documents with before/after integrity checks. No production schema changes before explicit owner approval of the exact reviewed SQL.
