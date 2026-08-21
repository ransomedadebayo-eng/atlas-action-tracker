# Linear Integrations and Notifications

## User value

Atlas should have one trustworthy notification inbox and a safe integration
boundary. Important work changes must be visible inside Atlas immediately;
external delivery must be configurable, signed, retried, and auditable without
ever storing raw provider credentials in the database or silently enabling a
destination.

## Source baseline

- Linear Notifications: https://linear.app/docs/notifications
- Linear Slack: https://linear.app/docs/slack
- Linear Webhooks: https://linear.app/developers/webhooks

The 2026-08-20 baseline includes an always-available inbox, per-channel and
per-category preferences, immediate and digest timing, automatic subscriptions,
team/project/initiative/view notifications, Slack thread synchronization, and
organization/team-scoped signed webhooks with unique delivery IDs, a five-second
timeout, and three retries after 1 minute, 1 hour, and 6 hours.

## Requirements

### Notification events and inbox

- Activity from actions, projects, initiatives, cycles, templates/documents,
  comments/reactions, releases, analytics, and workflows normalizes into one
  append-only event stream with a unique event key, category, resource,
  action, actor, summary, urgency, target URL, and bounded payload.
- The owner always has an Atlas inbox. Each event fans out idempotently to
  recipients according to active target subscriptions and category/channel
  preferences.
- Preferences support Inbox, browser, email, Slack, and webhook channels;
  immediate, digest, or disabled delivery; category selection; and digest
  windows. External channels default disabled.
- Notifications support unread, read, and archived states, individual and bulk
  transitions, unread counts, and non-destructive history.
- Auto-subscription covers resource creation/ownership, assignment, mentions,
  comments, and explicit follow; mute wins over automatic subscription.
- At most 2,000 open Inbox notifications are retained per principal; overflow
  archives the oldest entries without deleting them.

### Integration connections and subscriptions

- Connections are typed as webhook, Slack, email, calendar, GitHub, or generic,
  and have inbound, outbound, or bidirectional direction.
- A connection stores only non-secret configuration, an HTTPS endpoint, an
  environment-secret reference, a secret fingerprint, endpoint hash,
  verification evidence, revision, and lifecycle state.
- Connections are created in Draft. Verification sends a signed challenge to
  the exact endpoint and requires the challenge to be echoed. Activation is a
  separate owner action and requires fresh verification of an unchanged
  endpoint. Pause, resume, and archive are non-destructive.
- No OAuth token, webhook signing secret, email credential, Slack token, or
  GitHub credential is stored in Supabase or returned to the browser.
- Subscriptions filter by category, resource type, business, project,
  initiative, saved view, and event action. They are inactive until their
  connection is verified and active.
- External thread/reference mappings retain provider IDs and canonical Atlas
  resources so Slack-style thread sync and Git-style work links have one
  auditable identity graph.

### Outbound webhook delivery

- A canonical event creates one outbox delivery per matching active
  subscription, protected by a unique event/subscription key.
- Payload headers include `Atlas-Delivery`, `Atlas-Event`, `Atlas-Signature`,
  and `Atlas-Timestamp`. HMAC-SHA256 signs the exact UTF-8 body.
- Delivery accepts only a public HTTPS endpoint, does not follow redirects,
  uses a five-second timeout, and never sends authorization/database secrets.
- HTTP 200 is success. Failures retry after 1 minute, 1 hour, and 6 hours. After
  the initial attempt plus three retries, the delivery dead-letters and the
  connection pauses for owner review.
- Every attempt stores immutable request hash, timing, response status, bounded
  error metadata, and next-attempt time. Response bodies and secrets are not
  retained.
- Automatic post-mutation draining is enabled only by the explicit
  `ATLAS_DELIVERY_ENABLED=true` runtime flag. A bounded owner-only process route
  handles backlog safely. No Worker cron is added.

### Inbound webhook staging

- `/hooks/:connectionId` is the only unauthenticated integration route.
- It requires an active inbound/bidirectional connection, a unique delivery
  ID, HMAC signature, timestamp within five minutes, JSON content type, and a
  bounded body.
- Verified payloads are stored once with their SHA-256 hash and processing
  status. Raw headers, credentials, and unbounded provider data are not stored.
- Inbound payloads remain staged for owner review; this slice does not allow an
  external system to mutate actions, comments, approvals, or public state.

### UI and authorization

- `/notifications` provides Inbox, Preferences, Connections, Deliveries, and
  Inbound tabs plus unread count and resource navigation.
- Notification reads use `notifications:read`; Inbox transitions and preference
  changes are owner-only.
- Integration reads use `integrations:read`; configuration, endpoint tests,
  activation, manual delivery, and inbound processing are owner-only.
- All new public-schema tables use fail-closed RLS and explicit grants. History,
  events, inbound receipts, and delivery attempts are immutable; configuration
  is archived instead of deleted.

## Success criteria

- A transactionally rehearsed migration creates the complete schema, seeds
  owner Inbox defaults, and begins producing Inbox events only from future
  activity—no historical event replay or external delivery occurs.
- Database tests cover fan-out, preferences, subscriptions, overflow,
  connection lifecycle, delivery claiming/results/retry/dead-letter,
  inbound idempotency, RLS, grants, immutability, and no-delete behavior.
- Worker tests cover endpoint safety, HMAC signing/verification, retry timing,
  payload construction, authorization, and external failure handling.
- UI tests cover Inbox transitions, preferences, connection Draft state,
  delivery visibility, inbound staging, and accessibility.
- Production deploy leaves zero configured connections, zero external delivery
  attempts, and `ATLAS_DELIVERY_ENABLED` unset/false while the live Inbox and
  complete integration boundary are verified.
