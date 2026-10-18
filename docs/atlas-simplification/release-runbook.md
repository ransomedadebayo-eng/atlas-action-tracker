# Atlas simplification release and database gates

## Current authority and delivery

The owner approved implementing the spec and product defaults. Code is based on partial-save PR #9 (`10bc7d252914885288c7daf3e8d1a8e143c2acf1`), with remote main at `129e653832492809d96edc2e24360b32979c3e85`. The original dirty checkout is preserved. Implementation and review use Codex attribution; no operation impersonates Claude.

This PR is a code release candidate. No production deployment, schema/ACL change, migration dry run, live agent-contract replacement or AEGIS memory write is included in its execution evidence. The proposal SQL deliberately lives outside `migrations/` and is not picked up as an applied migration. Historical applied migrations and their recorded checksums remain unchanged.

The code works while retired tables still exist and after they are absent. The smaller alternative of hiding navigation alone was rejected: task reads would still depend on retired workflow/release/triage tables, so the database could never be safely simplified.

## Code merge and deployment gate

1. Review the stacked simplification PR and PR #9 together; preserve changed-fields-only saves, authoritative cache values and the regression tests.
2. Require the architecture contract, production build, Worker typecheck, unit/integration tests, production dependency audit and independent code/QA review. Record exact heads and CI links.
3. Obtain exact owner approval to merge/publish the tested heads. **Merging to main automatically runs the Cloudflare production deployment workflow.** No local `wrangler deploy` is permitted.
4. Merge PR #9 first, update the simplification PR base to main, resolve any actual drift and rerun required checks. Merge the simplification PR only with approved release authority.
5. Verify the provider deployment references the approved main commit. In the authenticated owner UI, read Today, Week, Projects, All Tasks, Kanban and one detail; verify legacy redirects and 410 responses for owner and machine principal. No production action edits are part of this read-only smoke check.

Before database retirement, code rollback is a source revert through the same GitHub workflow. After database retirement, never redeploy code that queries the removed public tables: first prepare a forward compatibility repair or separately approve a database restore. Do not treat reverting the code as a sufficient database rollback.

## Separate Phase 2 approval packet

Target: AEGIS project `vdezxdeushxaacyfjeeh`. Proposed transaction: [migration-proposal.sql](migration-proposal.sql). Its exact approved body/hash must be recorded immediately before execution; no SQL was applied during implementation.

The proposal locks all 18 empty-table candidates in deterministic order using `ACCESS EXCLUSIVE` before checking counts, preventing a legacy writer from inserting rows between the check and drop. These locks are held until transaction end and are part of the quiet-window approval.

The proposed scope is 18 verified-empty table drops, 18 history tables moved to `atlas_archive`, one action-pointer snapshot table, six live-trigger removals, 13 archive-trigger removals, 53 named retired-function removals, two kept-function rewrites, 10 foreign-key removals and 10 deprecated-column comments. The only live business-row edits are the FamilyOS charter context, the initiative saved-view archive flag and the Company Operations description, plus existing audit/notification side effects. No action status, owner, priority, due date, approval or evidence is rewritten.

The proposal also restricts the new archive schema/tables to service-role read-only access. **Those schema/ACL changes are unapproved until the owner approves this exact database scope.** No credentials, existing live principals, Cloudflare Access configuration or secrets are changed in the code release.

Before requesting execution approval:

- Re-run [preflight.sql](preflight.sql) read-only and compare every count and invariant. Counts captured during implementation match the spec exactly; they are evidence, not a future execution guarantee. All 53 functions exist exactly once, no template references exist, the sole initiative document is the FamilyOS charter, and Company Operations is paused. `atlas_archive` does not yet exist.
- Check views and function dependencies in every schema, the six live triggers, 13 archive triggers, foreign keys, and exact three source rows. Stop on an unexpected non-empty drop candidate, overload, dependency or pointer.
- Verify a restorable backup or PITR restore point and record its timestamp and tested recovery procedure. Preserve schema definitions, grants, triggers, functions, all 36 retired table contents, all action pointer columns, and before-images/revisions of the three edited live rows. Do not claim that a backup exists merely because a plan normally provides backups. Supabase's [backup documentation](https://supabase.com/docs/guides/platform/backups) is the operational reference.
- Review the SQL independently. Validate its syntax and rehearse against a disposable restored database with pgTAP and the acceptance queries. The edited `supabase/tests/` suites target the post-Phase-2 schema and must never run against production: some fixtures insert actions and consume identifiers even when rolled back.
- Capture action status counts, per-table counts and row fingerprints immediately before execution. Snapshot exact existing trigger/function definitions and ACLs so a repair can be designed if needed.
- Select a short quiet window outside morning/evening automations. A rolled-back production rehearsal still takes locks and advances audit/notification sequences, so it requires explicit approval too.

Only after deployed-code verification and exact approval, run the approved SQL plus acceptance checks inside `BEGIN … ROLLBACK`; use UPDATE-only trigger checks on named existing actions, never test INSERTs. Then apply the approved body once with `apply_migration`, record its actual version, and commit the versioned file using the repository ledger convention. A failure before commit rolls back transactionally. After commit, never patch half-state or issue destructive rollback SQL: compare evidence, stop writers and prepare an owner-reviewed forward repair or restore.

Postflight requires 19 archive tables, unchanged moved-table counts, unchanged action statuses apart from independently attributed owner activity, no kept public function querying a retired public table, correct charter/link/view behavior, unchanged security/performance advisor findings and restricted archive access.

## Phase 3 rollout

Prepared replacements are in [agent-contracts/](agent-contracts/); the manifest includes expected live source hashes. Replace live files only after Phase 2 and after reconciling drift. Then inspect current automation prompts and relevant live skills for actual retired Atlas instructions; generic releases, business initiatives, portal dashboards and unrelated HealthOS insights are not Atlas API callers. Preserve schedules, notification settings, history, runs, proposals and model choices.

Read-only searches of `/Users/music/aegis` and `/Users/music/Documents/Personal OS` found no runtime calls to the retired Atlas routes/tables; the HealthOS PRD's `/api/insights/weekly` and `/api/insights/patterns` are unrelated. Recheck current `aegis`/`peos` sources at rollout, including any hosted version absent from this Mac. Create a separate scoped PR for any actual client caller.

The governed AEGIS decision must describe the actual migration date and result after application. Do not submit the source spec's retrospective retirement claim before retirement has occurred, and never self-approve it. Verify the next runs of `atlas-stewardship-daily`, `agent-work-pull` and `peos-sunday-weekly-prep-brief` without creating a new monitor or changing their schedules.

## Phase 4

Separate PR/migration only: at least 14 days after actual Phase 2 application, seven days without deprecated-field warnings and explicit owner approval. Leave the archive and historical `cancelled` values intact. Do not remove uncertain secrets or broaden this release into business-value normalization, Today planning repairs or HomeFinance.

## Glossary

- **Stacked PR:** a change built on another unmerged PR; here simplification depends on the partial-save fix.
- **Preflight:** read-only checks that prove the current database matches the approved assumptions.
- **PITR:** restoring a database to a chosen prior point in time, subject to the provider plan and verified recovery setup.
- **ACL:** a database object's role permissions; archive restrictions require separate approval.
- **Forward repair:** a reviewed new change that repairs state while preserving history instead of deleting evidence.
