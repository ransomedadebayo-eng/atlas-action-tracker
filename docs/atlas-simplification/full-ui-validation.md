# Full UI validation — 18 October 2026

The initial simplification is live at https://atlas.ransomed.app, from merge `1bbc46682dd0484e9212365519f32a204a0256c3` ([deployment](https://github.com/ransomedadebayo-eng/atlas-action-tracker/actions/runs/39110085391)). This follow-up fixes defects found during the owner-requested full UI validation. Its release is tracked by the follow-up PR and the final task receipt.

## Coverage

Authenticated production navigation was read-only in Chrome at 1440×1000 and 390×844. Each route rendered, retained API reads returned 200, and the document width equaled the viewport. Visible button label checks found no unlabeled buttons in those normal route states. Every primary mobile route was reached through its navigation menu. Browser back/forward and task reload checks passed. Seven legacy URLs redirected correctly.

All form submissions, completions, preferences, version restores and failure injection used a separate localhost fixture with synthetic in-memory data. The fixture never forwards requests. Loading and empty reads were checked on desktop; failed reads were checked at mobile width. The final build distinguishes failures from successful empty results on all 15 routes.

| Route | Live desktop/mobile | Synthetic loading | Synthetic empty | Synthetic failure |
| --- | --- | --- | --- | --- |
| Today | Pass / Pass | Pass | Pass | Pass |
| Week | Pass / Pass | Pass | Pass | Pass |
| Projects | Pass / Pass | Pass | Pass | Pass |
| All Tasks | Pass / Pass | Pass | Pass | Pass |
| Kanban | Pass / Pass | Pass | Pass | Pass |
| Documents | Pass / Pass | Pass | Pass | Pass |
| Notifications | Pass / Pass | Pass | Pass | Pass |
| Office Digest | Pass / Pass | Pass | Pass | Pass |
| Review | Pass / Pass | Pass | Pass | Pass |
| Decide | Pass / Pass | Pass | Pass | Pass |
| Journal | Pass / Pass | Pass | Pass | Pass |
| Calendar | Pass / Pass | Pass | Pass: empty grid | Pass |
| Principals | Pass / Pass | Pass | Pass | Pass |
| Transcripts | Pass / Pass | Pass | Pass | Pass |
| Automations | Pass / Pass | Pass | Pass | Pass |

Legacy routes: cycles → dated Week; initiatives → Projects grouped by business; insights/dashboards → Projects; templates/releases/workflows → Today.

## Workflow checks

- Actions: create, required/whitespace title validation, title-only update, unchanged historical notes/status, explicit cancellation, reload, evidence-required completion, failed-save draft retention and retry. Today excludes canceled and archived records before the five-item cap.
- Action detail: focus after uncached loading, forward/reverse Tab containment, dirty Escape cancel/discard, and opener restoration. Done/Archived controls and approval/evidence rules retain their existing regression coverage.
- Capture: expanded form scrolls on 390×844 and 320×568. At 1280×480 the submit button ends at y=459; at 320×568 it ends at y=547. Empty titles trigger native validation; app errors announce as alerts.
- Mobile navigation: 320px drawer traps forward/reverse Tab, makes the background inert, consumes Escape and restores its opener.
- Projects: create, invalid start/target dates, corrected save/reload, milestone, health update, discussion, action assignment and saved board view persistence. Save feedback uses a persistent polite status region.
- Week: draft fork, missing-action validation, save, request review, publication confirmation, published v2 reload and prior-version history. Scorecard preserves completed/canceled source status without rewriting the plan.
- Documents: required title, create, title/content edits, flush and automatic save, reload, version history and restore as a new revision. Failed list/detail reads show an alert; loading has an explicit status.
- Notifications: synthetic read-all and Inbox digest preference persisted after reload. External channels were not activated.
- Journal/transcripts: synthetic create/upload, required-content/title validation and reload. No real transcript was uploaded.
- Calendar: empty grid renders; keyboard activation of 18 October opens capture with due date `2026-10-18`.

## Defects fixed

1. Today omitted the canonical `canceled` spelling from its terminal filter.
2. An uncached action detail never initialized its focus lifecycle.
3. Expanded capture clipped its submit controls on mobile and short desktop screens.
4. Mobile drawer focus escaped into background controls.
5. Empty capture titles had no native required-field feedback; save errors lacked alert semantics.
6. Project feedback lacked a persistent live announcement region.
7. Failed Documents list reads appeared empty; list loading lacked feedback; failed detail reads could remain a skeleton.
8. Decide could claim the queue was clear during a failed/loading read. Journal/Inbox showed empty copy alongside errors; Journal/Automations errors lacked alert semantics.
9. The unexecuted SQL proposal allocated audit IDs with `max(id)`. It now uses the existing identity default; the original source SQL is preserved with a warning directing execution to the maintained proposal.

## Verification and evidence

`npm run check` passes: contract, production build, Worker typecheck, **171 app tests across 30 files** and **191 Worker tests across 22 files**. `git diff --check` passes. The fixture self-check passes 26 read contracts plus CRUD, validation, conflict, version, HTTP dispatch and WebSocket frame checks. See [final check output](validation-ui.txt) and [route result summary](full-ui-route-results.json).

Independent review reports no remaining P1/P2 findings in the changed app code. Focused final state regressions: 24 tests passed. The proposal identity correction was reviewed separately from its author. No applied migration or deployment workflow was edited.

Full screenshots, DOM observations, synthetic requests/state and read-only integrity receipts are preserved in the task artifact directory `atlas-ui-validation-evidence`, alongside this checkout. Screenshot names distinguish live data from synthetic data and before/after defects. The task receipt links key images and the released version.

Before/after SELECTs during the production UI sweep (08:42:06–08:56:21 UTC) found identical complete-row fingerprints and counts: **738 actions, 30 projects, 29 documents**. Live browser traffic in the captured sweep consisted of GET requests. A separate before/after fingerprint pair covers the follow-up release and is preserved in the final receipt.

## Limits

- Chrome desktop/mobile emulation was exercised; physical iOS/Android, VoiceOver and a full WCAG audit were not performed. Existing Calendar spillover-day accessible names still use the viewed month; this is a pre-existing labeling issue outside the simplification changes.
- Synthetic owner completion does not prove machine-principal approval rejection. Production task completion and permission/credential changes were not attempted. Worker authorization/evidence tests remain the policy evidence.
- Cloudflare returned 403 to anonymous/dummy-bearer direct Worker probes, and Chrome blocked direct `/api/health` navigation. Authenticated app reads succeeded. Production retired-prefix 410 was not asserted from those blocked probes; Worker tests verify that contract.
- External delivery/verification, real integrations, database retirement, archive ACL changes, pgTAP against production and live automation-contract rollout were not executed. The exact database scope remains separately gated by the [release runbook](release-runbook.md).

To reproduce synthetic UI checks: build the app, run `python3 docs/atlas-simplification/browser-fixture.py --port 4188`, and open its localhost URL. `/__qa` offers scoped normal/empty/error/delay controls; reloads preserve synthetic edits. The harness is an aid for UI validation, not a substitute for the Worker or production integration.
