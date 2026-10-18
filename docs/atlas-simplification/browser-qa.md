# Local browser QA — 2026-10-18

> Initial smoke record. The subsequent [full UI validation](full-ui-validation.md) covers all 15 production routes on desktop/mobile, synthetic workflows and loading/empty/error states, plus captured screenshots and integrity receipts.

Environment: local production Vite build, Chrome on the connected Mac, `http://127.0.0.1:4187`. The supported native computer-use interface supplied accessibility snapshots and screenshots. The fixture serves synthetic data in memory and never forwards requests to Supabase, Cloudflare, PEOS or another service. Only the dedicated Atlas QA tab was operated; HomeFinance tabs/files were preserved.

To reproduce, build the app and run `python3 docs/atlas-simplification/browser-fixture.py` from the repository root, then open the printed localhost URL. The fixture is a UI smoke harness, not a substitute for Worker integration tests or production verification.

| Check | Observed result |
| --- | --- |
| Sidebar | Today, Week, Projects, All Tasks, Kanban, Documents, Notifications, Office Digest, Review, Decide, Journal, Calendar, Principals, Transcripts, Automations |
| Projects default | `group=business`; Atlas and Personal labels from business config |
| Project list and board | Atlas simplification: 2 open actions, oldest open 47 days, STALE; Family plans: 0 open actions, No open actions |
| Week | Must wins done 1 of 2; Day focus done 1 of 1; Carried over 1 |
| Today | Two selected actions and published-weekly-guidance message |
| All Tasks/detail | Needs triage rendered for stored `open`; Canceled rendered for stored `canceled` |
| Detail selector | Needs triage, To do, In progress, Waiting, Blocked, Done, Canceled, Archived; Done/Archived disabled for the open action |
| Partial saves | Open and canceled fixtures each submitted exactly one PUT body containing only the changed title; readback retained status and historical notes |
| Kanban | Needs triage, To do, In progress, Waiting, Blocked; toggling completed on adds Done and Canceled; Archived remains hidden |
| `/cycles` | Replaced by the dated Week route |
| `/initiatives` | Replaced by Projects with business grouping |
| `/insights` | Replaced by Projects |
| `/templates`, `/releases`, `/workflows` | Replaced by Today |

The [request log](browser-requests.jsonl) records fixture API traffic and the two title-only PUT bodies. Retired API 410 and historical-alias behavior are covered in Worker tests rather than simulated by this fixture. Screenshots were visually inspected through the supported interface; no screenshot file is asserted here. Mobile behavior and the authenticated production UI remain release checks.

During QA, an app rebuild invalidated an already-open preview's lazy asset URL. Refreshing the preview loaded the current build and the remaining checks passed. The browser-tab connector also timed out; the supported native Chrome interface completed the checks without changing browser settings or touching other tasks.
