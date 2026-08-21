# Collaboration Technical Plan

## Architecture

1. Add canonical comment, reaction, subscription, and activity tables with
   polymorphic target validation triggers and fail-closed RLS.
2. Store only one parent/root level. The create RPC normalizes any reply target
   to its root and rejects cross-target references.
3. Implement security-definer RPCs for comment creation/edit/lifecycle,
   resolution, reaction toggle, and subscription state; revoke public execution.
4. Aggregate discussions in the Worker into roots/replies and reaction groups,
   preserving actor lists and caller subscription state.
5. Build one `DiscussionThread` component and integrate it on all work and
   update surfaces. Use textarea selection offsets for document inline anchors.
6. Keep external notifications and uploaded binary storage outside this slice;
   immutable HTTPS attachment metadata remains usable immediately.

## Data Contracts

- `atlas_comments`: revisioned root/reply record plus resolution/anchor/evidence.
- `atlas_reactions`: actor/emoji/target state with active/removed transitions.
- `atlas_discussion_subscriptions`: active/muted target participation.
- `atlas_collaboration_activity_log`: append-only audit ledger.

## Integrity And Security

- Polymorphic target validation covers every supported target table.
- Root/reply target IDs must match; comment trees cannot exceed one reply level.
- Resolution IDs must belong to the root thread.
- Mentions are canonical and unique; attachment and anchor JSON shapes are
  validated in Worker and database triggers.
- Editing/archiving checks actor ownership inside RPCs, not only in UI.
- No physical delete or history rewrite grant exists for the service role.

## Test Strategy

- pgTAP: schema/RLS/grants, target validation, root/reply normalization,
  cross-target rejection, resolution selection, edit ownership, archive/restore,
  attachment/anchor validation, reaction idempotency, subscriptions, audit, and
  non-deletion.
- Worker: payload validation, thread aggregation, reaction grouping, scopes,
  and owner/author boundary mapping.
- UI: post/reply/edit/resolve/react/follow/link/inline-anchor states on full and
  compact surfaces plus axe checks.
- Full repository verification, transactional production rehearsal, committed
  pgTAP, advisors/readback, Cloudflare deploy, and live route/asset/API checks.

## Rollout

- The 83-assertion database rehearsal rolled back cleanly after correcting the
  polymorphic audit trigger, then passed against production.
- Production preserved 566 actions and created zero real/test comments,
  reactions, subscriptions, or collaboration events.
- Parent and selected-resolution foreign-key advisor findings were corrected
  forward with dedicated indexes.
- Worker/UI version `d0ea1fe5-bd0d-4661-b2fd-e3174654b183` serves the separate
  discussion bundle on action, project, initiative, document, and update surfaces.
- Authenticated owner interaction smoke remains pending a usable Access browser
  session; assets, routes, health, API denial, and Access redirect are verified.
