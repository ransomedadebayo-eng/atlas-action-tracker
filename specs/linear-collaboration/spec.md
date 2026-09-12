# Linear Collaboration: Comments, Threads, Reactions, And Inline Anchors

## Purpose

ATLAS needs discussions attached directly to execution and strategy records so
questions, decisions, feedback, and evidence remain in context. One canonical
discussion model must support actions, projects, initiatives, documents, and
project/initiative updates without creating incompatible per-feature comment
systems.

## User Stories

### US1 - Discuss work in context

As the owner, I can comment on an action, project, initiative, document, project
update, or initiative update and see the conversation on that surface.

### US2 - Continue and resolve a thread

As the owner or an authorized agent, I can reply to a root comment, resolve or
reopen the thread, and optionally designate one reply as the resolution.

### US3 - React without adding noise

As a participant, I can toggle Unicode emoji reactions on work records,
updates, comments, and threads. Reaction counts and actors remain visible.

### US4 - Ground comments in exact text and evidence

As the owner, I can anchor a comment to selected text in an action description,
project/initiative overview, or document revision, and attach titled HTTPS
links with MIME/size metadata.

### US5 - Follow conversations

As a participant, I am automatically subscribed when I comment, reply, or am
mentioned. I can explicitly follow or mute a discussion without deleting its
history.

## Functional Requirements

1. Comments support target type/id, root/reply hierarchy, Markdown body,
   canonical mentions, link attachments, optional inline anchor, revision,
   creator/editor, archive/restore, and timestamps.
2. Targets include actions, projects, initiatives, documents, project updates,
   and initiative updates. Target existence is validated transactionally.
3. Replies belong to the same target and one root. Reply depth is one thread
   level; replies to replies resolve to the same root.
4. Root comments may resolve/reopen. A resolution may reference the root or one
   active reply in the same thread and records resolver/time.
5. Comment editing and archive/restore are limited to the original actor or the
   owner. Resolution is allowed to scoped writers.
6. Hard deletion is disabled. Comment transitions and edits append audit
   evidence; archived text remains recoverable.
7. Reactions support official Unicode emoji on actions, projects, initiatives,
   documents, project/initiative updates, and comments. Toggling is idempotent
   per actor/emoji/target and preserves removed reaction history.
8. Attachments are metadata-only HTTPS resources in this slice: title, URL,
   optional MIME type, and non-negative byte size. No secret or local path may
   enter attachment metadata.
9. Inline anchors contain field, quoted text, optional start/end offsets, and
   source revision. Anchors are immutable context snapshots even when source
   content later changes.
10. Mentions are limited to active canonical principals. Comment authors and
    mentions auto-subscribe to the target discussion.
11. Subscriptions support active and muted state and never delete participation
    history.
12. One read API returns target reactions, root comments, ordered replies,
    resolution state, reaction aggregates/actors, and the caller subscription.
13. A reusable accessible UI component supports posting, replying, editing,
    archiving/restoring, resolving/reopening, reactions, link attachments,
    subscriptions, and inline-anchor display.
14. The component appears on Action Detail, Project Detail, Initiative Detail,
    Document Detail, and project/initiative update cards.
15. Browser code calls only the Worker. New public tables enforce RLS, public
    roles cannot execute mutation RPCs, and service-role destructive grants are
    revoked.

## Success Criteria

- One root with two replies loads as one ordered thread and can resolve to the
  second reply.
- A reply cannot cross targets or create deeper nested branches.
- Reaction toggles create, remove, and restore one actor reaction without
  duplicate active rows.
- Selected document text persists as a revision-bound anchor.
- Attachments reject non-HTTPS URLs, negative sizes, and local paths.
- Comments/reactions work on every named surface with scoped authorization.
- Database, Worker, component, accessibility, production, permission, and
  readback gates pass without fixture residue.

## Out Of Scope

- Binary upload storage; links can point to already-authorized file stores.
- Slack synchronization, email/inbox delivery, and push notifications until the
  integrations/notifications slice.
- AI-generated thread summaries.
- Multi-user guest/private-team permissions, which conflict with Atlas's
  owner-only identity contract.
