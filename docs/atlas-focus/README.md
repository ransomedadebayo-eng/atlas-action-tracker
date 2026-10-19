# Project focus

`/focus` adds an owner-only Pomodoro timer associated with actual Atlas project IDs. Default durations are 25/5/15 minutes, with a long break after four completed focuses. It supports pause/resume/reset/skip, opt-in sound, project snapshots, session history and all-history project totals. It never completes an Atlas action or project.

## Database decision pending

The code is ready for review; production storage is **not applied**. [schema-proposal.sql](schema-proposal.sql) is an additive proposal, deliberately outside the automatically applied migration directory. The API returns `503 FOCUS_STORAGE_UNAVAILABLE` until the reviewed objects and new-object-only access exist. See [SCHEMA-APPROVAL.md](SCHEMA-APPROVAL.md) for the exact owner decision. No existing rows, scopes, credentials, grants or policies change in this feature.

[contract.md](contract.md) records the API, data semantics and design choice. The original [Pomodoro · Focus Room](https://pomodoro-focus-room.ransomed.chatgpt.site) remains private and unchanged; browser-local tasks/history have not been migrated.

## Verification

- App: 210 tests passed; Worker: 255 tests passed; contract, build, typecheck and whitespace checks passed.
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

GitHub quality checks, automatic PR review and the established main-branch deployment workflow remain the release path. Production deployment/live verification are pending the database owner decision; local verification does not establish a live release.
