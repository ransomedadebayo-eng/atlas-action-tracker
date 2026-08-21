# Linear core conveniences

## Outcome

Atlas closes the remaining high-value Linear project-management gaps in the
production application: stable action references and backlinks, configurable
parent/sub-action completion, parent-action conversion to a project,
project-scoped action views, and cycle start/calendar controls.

## Requirements

1. Every action has a unique immutable `ATLAS-N` identifier.
2. Text containing an action identifier produces durable reference evidence;
   action-to-action references surface as automatic related links and backlinks.
3. Workflow owners can independently enable parent auto-close and sub-action
   auto-close. Automation must not complete `user_only` or approval-gated work.
4. An owner can convert a parent action to a project transactionally. The
   source and direct children become standalone actions in that project, the
   source is renamed, hierarchy edges are cleared, and an immutable receipt is
   retained.
5. A project detail page can create and switch between contextual action views
   without leaving the project.
6. An owner can start a planned cycle today. Authenticated users can download
   a standards-compliant `.ics` feed for all visible cycles or one cycle.
7. All new public tables use RLS and reject destructive deletion. Consequential
   mutations have revision checks, actor attribution, and authoritative readback.

## Non-goals

- Public unauthenticated calendar tokens.
- Historical text-reference backfill during migration.
- Automatic completion of owner-gated actions.
