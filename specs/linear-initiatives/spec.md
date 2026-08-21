# Linear Initiatives And Strategic Rollups

## Purpose

ATLAS needs a strategic layer above projects so the owner can organize several
execution streams around an objective, inspect health and delivery progress at
a glance, and model nested or shared workstreams without duplicating projects.

This slice implements the current Linear Initiatives baseline in the canonical
AEGIS-backed Atlas application while preserving Atlas's owner-only identity,
append-only evidence, and forward-only migration rules.

## User Stories

### US1 - Track strategic objectives

As the owner, I can create an initiative with status, priority, owner, labels,
business scope, target date, description, resources, and update cadence, then
archive or restore it without physical deletion.

### US2 - Connect strategy to execution

As the owner, I can attach projects to initiatives and see direct and recursive
project counts, health distribution, effort progress, and completed-issue
activity without moving or copying the projects themselves.

### US3 - Model a strategic hierarchy

As the owner, I can give an initiative more than one parent and nest initiatives
up to five levels. Cycles and paths deeper than five levels are rejected
transactionally.

### US4 - Review strategic health

As the owner, I can post structured On track, At risk, or Off track updates,
review initiative and contributing project/sub-initiative history, and identify
stale objectives.

### US5 - Change the strategic view

As the owner, I can use list and timeline layouts, filter/group/order initiatives,
save and favorite views, inspect nested initiative context, and view weekly
project completion curves.

## Functional Requirements

1. Initiatives support Proposed, Planned, Active, Completed, Canceled, and
   Archived states; P0-P3 priority; owner; business; labels; description;
   start/target dates; color/icon; update cadence; manual order; revision; and
   completion/archive timestamps.
2. Initiative projects use a many-to-many join so one project may contribute to
   several objectives without duplicating its record.
3. Initiative parentage uses a directed many-to-many graph. An initiative may
   have multiple parents, but the graph must remain acyclic and no root-to-leaf
   path may exceed five initiatives.
4. Parent rollups include directly attached projects and projects from all
   descendants, deduplicated when the same project arrives through multiple
   paths.
5. Rollups expose total/active/completed projects, On track/At risk/Off track/No
   update health counts, issue and effort progress, and earliest/latest dates.
6. Initiative updates are structured health reports with body, actor, immutable
   context snapshot, and timestamps. Latest update controls initiative health.
7. Initiative overview can include initiative updates, descendant updates, and
   contributing project updates in one chronological feed.
8. Initiative resources support titled external links and internal document
   references. Resources archive instead of deleting.
9. Initiative graph data reports completed actions per contributing project by
   Pacific-local week for a bounded date window.
10. Initiative views support list and timeline layouts; grouping by owner,
    status, health, business, label, start date, or target date; ordering by
    manual rank, status, priority, updated/created/start/target/name; and timeline
    zoom of week, month, quarter, or year.
11. Saved views accept `initiative` as an entity type, may attach to an
    initiative context, are revision-protected, and archive rather than delete.
12. Project list/detail payloads expose initiative membership; project views can
    filter and group by initiative.
13. All mutations use revision checks where they alter a mutable aggregate.
14. Browser code calls only the Worker. Service-role credentials remain server
    side, public application roles cannot execute mutation RPCs, and all new
    public tables have RLS enabled.
15. Initiative, membership, hierarchy, update, and resource mutations append
    audit evidence. Core rows and history cannot be physically deleted.
16. `/initiatives` and `/initiatives/:id` work as stable production routes at
    mobile and desktop widths with accessible non-drag controls.

## Success Criteria

- A multi-parent hierarchy rolls up the same project once and rejects cycles or
  a sixth nesting level.
- One initiative aggregate reconciles project health and effort to canonical
  project/action rows.
- Saved initiative views restore list/timeline configuration from a stable URL.
- Project membership is visible from both initiative and project surfaces.
- Database, Worker, component, accessibility, production route, security, and
  readback gates pass.

## Edge Cases

- The same descendant is reachable through two parents.
- The same project is attached directly and through a descendant.
- A project has no current update, no dates, or no estimated actions.
- An initiative has multiple roots or no projects.
- An archived initiative appears in historical links but cannot be mutated
  until restored.
- Reparenting would create a cycle or increase another descendant path beyond
  five levels.

## Out Of Scope

- Slack delivery and inbox reminders until notification integrations are built.
- Full collaborative rich-text documents and update comment/reaction threads;
  resources can reference them once those slices exist.
- Multi-user/private-team visibility, which conflicts with Atlas's owner-only
  identity contract.
