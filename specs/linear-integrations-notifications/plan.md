# Implementation Plan

## Schema

- Add notification events, per-principal Inbox rows, preferences, target
  subscriptions, connections, connection subscriptions, external references,
  outbox deliveries, immutable attempts, inbound receipts, and integration
  activity history.
- Add generic activity-log fan-out triggers for Atlas work surfaces and a
  collaboration-aware mention/subscription path.
- Add revisioned lifecycle, Inbox transition, delivery claim/result, inbound
  receipt, and retention RPCs with service-role-only execution.
- Enable RLS, revoke public roles, remove destructive service-role privileges,
  and index every foreign key and queue scan.

## Worker

- Add HTTPS endpoint validation, deterministic payloads, HMAC helpers,
  verification challenge flow, timeout/redirect controls, retry timing, and a
  bounded outbox dispatcher.
- Add `/api/notifications` and `/api/integrations` routes plus signed
  `/hooks/:connectionId` ingestion before the authenticated API boundary.
- Add optional post-mutation draining behind `ATLAS_DELIVERY_ENABLED=true` and
  keep the production flag disabled for this rollout.

## Frontend

- Add a lazy `/notifications` route and navigation item.
- Build Inbox read/archive/bulk controls, category/channel preferences,
  draft connection and subscription forms, verification/activation controls,
  delivery receipts, and inbound staging review.

## Verification and release

- Add pgTAP, delivery utility, route, component, authorization, and architecture
  contract tests.
- Run contract, build, typecheck, all tests, production dependency audits, and
  diff checks.
- Rehearse/apply production migrations, run pgTAP/advisors/readback, deploy via
  Wrangler, and verify live routes/assets/auth boundaries with no connection or
  delivery configured.

## Production evidence

- Supabase migrations `atlas_notifications_integrations_linear_parity` and
  `atlas_outbox_subscription_index` applied successfully.
- Production pgTAP passed 120/120; 566 actions remain, five owner preferences
  were seeded, and notification events, Inbox rows, connections, subscriptions,
  deliveries, attempts, inbound events, and external references all read back
  at zero after the rolled-back test.
- Advisor follow-up reports no notification/integration foreign-key finding.
  RLS-with-no-policy notices are the intentional Worker-only posture.
- Cloudflare version `44277b5a-6ad8-49cb-9851-1512b899aa84` serves
  `/notifications`, `NotificationsPage-CuhL_akD.js`, authenticated API
  boundaries, and the unauthenticated-but-HMAC-required `/hooks/*` boundary.
- No `ATLAS_INTEGRATION_SECRET_*` or `ATLAS_DELIVERY_ENABLED=true` binding was
  added, and no external verification or delivery was attempted.
