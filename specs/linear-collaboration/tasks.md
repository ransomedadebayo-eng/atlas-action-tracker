# Collaboration Tasks

## Database

- [x] Add comment, reaction, subscription, and activity tables with RLS/audit guards.
- [x] Implement create/edit/archive/restore/resolve/reaction/subscription RPCs.
- [x] Validate targets, one-level threads, anchors, mentions, and attachments.
- [x] Add and pass the collaboration pgTAP regression contract.

## Worker

- [x] Add comment scopes and route authorization.
- [x] Implement validation, aggregation, and mutation routes.
- [x] Add helper and HTTP boundary tests.

## Application

- [x] Add collaboration API client and React Query hooks.
- [x] Build reusable DiscussionThread UI with all thread/reaction states.
- [x] Integrate actions, projects, initiatives, documents, and update cards.
- [x] Add document selected-text anchor flow.
- [x] Add component and accessibility tests.

## Release

- [x] Run full repository verification and production dependency audits.
- [x] Rehearse/apply/test/read back production migration and advisors.
- [x] Deploy, verify live assets/routes/security, and update parity.
- [ ] Run authenticated owner-session desktop/mobile interaction smoke when a Cloudflare Access browser session is available.
