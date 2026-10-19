# Project focus

`/focus` adds an owner-only Pomodoro timer associated with actual Atlas project IDs. Default durations are 25/5/15 minutes, with a long break after four completed focuses. It supports pause/resume/reset/skip, opt-in sound, project snapshots, session history and all-history project totals. It never completes an Atlas action or project.

## Database approved and applied

The owner approved the bundled GitHub release and exact additive schema on 2026-10-19. Migration `20261019040756` was applied through the supported Supabase migration connector and verified by authoritative metadata/readback. [schema-proposal.sql](schema-proposal.sql) preserves the exact reviewed payload and its historical proposal comments; the byte-identical [canonical migration](../../migrations/20261019040756_atlas_project_focus.sql) uses the version returned by the remote ledger, rather than an invented timestamp. [schema-application.json](schema-application.json) records RLS, invoker functions, restricted new-object access and zero initial session/state/receipt rows. The API retains `503 FOCUS_STORAGE_UNAVAILABLE` for unavailable storage. No existing rows, scopes, credentials, grants or policies change in this feature.

[contract.md](contract.md) records the API, data semantics and design choice. The original [Pomodoro · Focus Room](https://pomodoro-focus-room.ransomed.chatgpt.site) remains private and unchanged; browser-local tasks/history have not been migrated.

## Verification

- App: 217 tests passed; Worker: 255 tests passed; contract, build, typecheck and whitespace checks passed. Recovery regressions cover acknowledged completion followed by failed readback, then manual refresh, window focus, polling, reconnect and query refetch; pre-acknowledgement reads cannot unlock controls or consume the pending cue.
- Exact proposal: 56 assertions on disposable PostgreSQL 17.11, including concurrent commands/retries, owner/project lock timing, paused time, immutable receipts/history, archived/renamed labels, timestamp ties and all-page totals. [Recorded result](storage-verification.json).
- Independent review: no remaining P1/P2; the project-lock timing finding was corrected and verified. [Review](REVIEW.md).
- Desktop (1496px), mobile (390px) and narrow mobile (320px): actual project selection and locked context, pause/reload/resume, settings without rebasing, natural timed completion, reset/skip without adding totals, four-focus long break, archived labels, history filters and two-way cursor pages. No horizontal overflow at 390/320px. Missing-storage responses block the timer and recover after retry. [Screenshots](evidence/).
- Production dependency audits: app zero vulnerabilities; Worker one existing moderate Hono advisory group, no high/critical findings. Dependencies unchanged.
- Production read-only [integrity baseline](integrity-before.json): 738 actions, 30 projects, 29 documents. No production focus tables or session writes during local verification.

## Local SQL/browser verification

The Python helpers require a disposable PostgreSQL cluster with a private Unix socket at `<cluster>/socket/.s.PGSQL.55429`, host listening disabled, and marker `<cluster>/.atlas-focus-disposable` containing `atlas-focus-disposable-local-only-v1`. They accept no remote database URL and read no Atlas credentials. PostgreSQL 17 Homebrew binaries are used in this Mac workspace.

```sh
python3 docs/atlas-focus/verify-storage.py --cluster /path/to/marked/disposable/cluster
```

Each invocation creates a fresh isolated local test database. For browser checks, initialize a separate synthetic `postgres` database using `LocalDatabase.bootstrap`, apply the same proposal there, build `app/dist`, then:

```sh
python3 docs/atlas-focus/browser-fixture.py --cluster /path/to/marked/disposable/cluster --port 4190
```

Other Atlas endpoints use the existing synthetic fixture. Focus endpoints execute the real SQL RPCs as the existing service-role shape. `/__qa/focus` exposes explicit local expiry/rename/archive/storage-unavailable controls. Those controls are not shipped in app/Worker code, and no request is forwarded to production. HTTP authentication/validation is tested separately in the Worker suite. Screenshots and browser history here contain synthetic projects only.

GitHub quality checks, automatic PR review and the established main-branch deployment workflow remain the release path. Schema application is complete; production deployment and live verification are the remaining release steps. Local verification alone does not establish a live release.
