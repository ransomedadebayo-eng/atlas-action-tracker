# Atlas task-management operating model

Atlas automations now follow the shared contract at
`/Users/music/.codex/automations/atlas-full-app-operating-contract.md`.

The operating model is connected rather than action-only:

1. Intake correlates first and uses Triage when classification is incomplete.
2. Multi-step outcomes become projects with evidence-backed milestones.
3. Strategic outcomes group real projects into initiatives.
4. Cycles hold executable work only; weekly plans select higher-order outcomes
   without changing source-action semantics.
5. Project views, documents, backlinks, project updates, subscriptions, and
   analytics provide context and review surfaces.
6. Releases require real delivery evidence; empty surfaces never justify
   filler records.

## Production activation

The 2026-08-20 activation organizes the existing queue into:

- 12 projects and four initiatives;
- 16 milestones and 11 saved portfolio/project views;
- 37 projected active actions, including four property sub-actions;
- one active two-week cycle with six executable actions;
- six documents and automatic `ATLAS-N` backlinks;
- five project updates and five owner subscriptions;
- four Insights on one four-card dashboard; and
- eight compact owner Inbox notices after bootstrap-noise archival.

Two actions remain standalone by design because they do not yet justify a
project. No release or external integration record was fabricated.

## Verification

- `atlas-full-app-contract-check.mjs` validates ten automations, five protocols,
  fourteen capability clauses, and five replay cases.
- `atlas_portfolio_activation_test.sql` contains 40 database assertions.
- `atlas_portfolio_hierarchy_test.sql` contains 14 database assertions.
- The app and Worker suites, production build, Worker typecheck, and Supabase
  security/performance advisor checks must remain green.
