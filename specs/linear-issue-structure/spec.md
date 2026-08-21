# Linear Issue Structure

## Purpose

ATLAS actions need the structural capabilities that Linear issues use to break
down work, expose dependencies, distinguish duplicates, and roll up effort.
This slice builds parent/sub-actions, typed action relations, duplicate
resolution, and configurable estimates on top of the existing owner-only
action lifecycle.

This is the second delivery slice of the broader Linear parity objective. It
does not redefine that objective as complete.

## Users

- Ransomed is the sole human owner.
- Codex and Claude may create hierarchy and ordinary relations when their
  machine credentials contain `actions:write`.
- Marking an action as a duplicate is a completion-class transition and
  requires `actions:complete`.
- No new human collaboration or tenancy model is introduced.

## User Stories

### US1 - Break work into sub-actions

As the owner, I can create a sub-action from an existing action, attach an
existing action to a parent, remove its parent, and see child progress so that
work is decomposed without creating unnecessary projects.

### US2 - See and manage dependencies

As the owner, I can mark actions as related, blocking, or blocked by another
action and resolve or archive the relation without deleting history.

### US3 - Resolve duplicates honestly

As the owner or an authorized completing agent, I can mark one action as a
duplicate of a canonical action. The duplicate receives an explicit duplicate
resolution, points to the canonical action, and remains distinguishable from
ordinary completion.

### US4 - Estimate and roll up effort

As the owner, I can assign estimate points to actions and see child progress by
issue count and effort. Unestimated actions count as one point unless the
estimate configuration says otherwise.

## Functional Requirements

1. `atlas_actions.parent_action_id` models a self-referencing hierarchy.
2. A hierarchy mutation must reject self-parenting, cycles, missing actions,
   archived parents, and stale revisions.
3. Creating a sub-action inherits the parent's business, priority, project,
   project milestone, and work mode. Tags are not inherited.
4. Removing a parent preserves the action and all audit history.
5. Action detail exposes the parent, direct children, child count/effort
   progress, active relations, and duplicate canonical action.
6. `atlas_action_relations` models `related`, `blocks`, and `duplicate`
   relationships with active/resolved/archived state.
7. `blocks` is directional: the source blocks the target. `related` is
   symmetric and duplicate pairs are prevented regardless of input order.
8. Completing a blocking action converts its active blocking relations to
   related state, or resolves the blocking relation if that related pair
   already exists.
9. Duplicate resolution is transactional: create the canonical relation, set
   the source action to `done`, set `resolution='duplicate'`, store
   `duplicate_of_id`, append typed evidence, increment revision, and append
   activity.
10. Ordinary completion sets `resolution='completed'` unless a more specific
    resolution already exists.
11. `estimate_points` accepts null or a non-negative integer in the configured
    scale. Zero is distinct from unestimated when allowed.
12. Estimate settings support linear, Fibonacci, exponential, and T-shirt
    scales, optional extended values, zero estimates, and a configurable
    unestimated default.
13. Action create, update, bulk, list filters, and Action Detail all understand
    parent and estimate fields.
14. Lists can filter top-level actions, sub-actions, children of a named parent,
    and actions with children.
15. Relation and hierarchy records cannot be physically deleted by
    application roles.
16. Every hierarchy, relation, duplicate, and estimate change appends auditable
    evidence.
17. UI controls remain keyboard operable and usable at representative mobile
    and desktop widths.

## Success Criteria

- A parent action can create and display an inherited child, attach/detach an
  existing child, and show deterministic child progress.
- Related, blocks, and blocked-by relationships can be created and retired;
  blocker completion has deterministic follow-on behavior.
- Duplicate resolution cannot be confused with verified or manually attested
  ordinary completion.
- Worker typecheck/tests, app tests/build, browser verification, and staged SQL
  regression contracts pass.

## Assumptions

- The staged project foundation migration introduces `estimate_points`,
  `project_id`, and `project_milestone_id` before this migration runs.
- The Worker remains the only browser-facing backend.
- Production migration, dependency updates, and deployment remain separately
  approval-gated.

## Out Of Scope For This Slice

- Parent auto-close and child auto-close settings.
- Converting an action hierarchy into a project.
- Comment-to-sub-action conversion.
- Cycles, issue templates, comments, reactions, and external integrations.
