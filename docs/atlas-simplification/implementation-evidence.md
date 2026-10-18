# Atlas simplification implementation evidence

Owner outcome: reduce redundant Atlas planning surfaces while preserving existing work and audit history. Specification: [Atlas simplification](../../specs/atlas-simplify-surfaces/spec.md). The accountable integration/delivery owner is Codex. App and Worker specialists own their respective directories; an independent reviewer checks the integrated result.

## Baseline

Isolated branch `codex/atlas-simplify-surfaces` starts at PR #9 head `10bc7d252914885288c7daf3e8d1a8e143c2acf1`. Before changes, `npm run check` passed: architecture contract, app build, Worker typecheck, 110 app tests and 196 Worker tests. Original checkout branch `codex/atlas-trust-overhaul` and its 48 modified tracked files/untracked work were preserved. No unrelated Office Digest, household, media or HomeFinance source was imported into this branch.

## Read-only production preflight

The local `supabase-aegis` execute tool is unavailable in this task. The hosted Supabase connector succeeded using SELECT-only queries. Table counts match the source spec exactly; all 18 drop candidates contain zero rows. All 53 specified retired functions exist exactly once. Template references are zero across actions/projects/documents; cycle document count is zero; the one initiative document is the FamilyOS charter. One initiative saved view is active, initiative pointer fields are unused and Company Operations exists with status paused. The archive schema does not exist yet.

Evidence: [table counts](preflight-table-counts.json), [function inventory](preflight-functions.json), [invariants](preflight-invariants.json). These are captured observations and must be refreshed before any future approved migration. No matching existing Atlas action title was found by the bounded simplification/partial-save title search; no filler tracking row was created.

## Validation record

Final integrated `npm run check` passes: architecture/security contract, production app build, Worker typecheck, **145 app tests across 26 files** and **191 Worker tests across 22 files**. `git diff --check` passes. Partial-save, cache refresh, retained evidence/approval controls, retired-prefix 410 responses, aliases, project metric pagination and same-revision weekly refresh have regression coverage. The [check log](validation.txt) preserves the exact local result.

Local Chrome QA used the production build against a synthetic localhost fixture only. Today, Week, Projects (list/board), All Tasks, Kanban and an action detail rendered. Business grouping, stale/age/count metrics, weekly scorecard, all six retired-page redirects, seven visible Kanban status columns and the eight-value detail selector matched the spec; Done/Archived remained protected. Title-only edits for `open` and `canceled` sent only `{title: ...}` and retained the original status and notes. See [browser observations](browser-qa.md), [synthetic request log](browser-requests.jsonl) and the reproducible [fixture server](browser-fixture.py). A preview asset mismatch after an intervening rebuild cleared on refresh; final checks used the rebuilt assets. No production action was edited.

A fresh independent reviewer rechecked the final integrated tree and reports **no remaining P1/P2 findings** after five corrections. Their [review record](independent-review.md) distinguishes static SQL inspection from executable verification.

Database migration rehearsal/application, pgTAP execution, production UI verification, live agent-contract rollout and Phase 4 remain explicitly unperformed until their [release gates](release-runbook.md) are satisfied. No historical migration was changed. The pending SQL was reviewed statically only; its presence is not an applied migration or a claim of database validation.

Production dependency audits at the repository's high-severity threshold pass. The app has no production advisories; the unchanged Worker dependency set reports one moderate Hono advisory group. No dependency or credential changes were made for that pre-existing finding.

## Glossary

- **Regression:** a previously working behavior that a change breaks; partial saves must keep unrelated fields untouched.
- **Fixture:** synthetic local data used to test a UI without changing real records.
- **Canonical status:** the fixed status displayed and accepted for new explicit changes, without rewriting old rows.
- **Readback:** checking actual saved or deployed state against the intended outcome.
- **Release gate:** evidence and exact authority required before a consequential production action.
