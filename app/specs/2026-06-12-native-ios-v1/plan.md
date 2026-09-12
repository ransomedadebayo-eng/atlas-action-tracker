# Atlas Native iOS v1 Plan

## Architecture
- Reuse the generated iOS target under `app/ios` to limit project churn.
- Replace the app entry point with a SwiftUI `@main` app.
- Keep the active app lifecycle and primary surfaces in SwiftUI; use a web view only for the Cloudflare Access sign-in handoff.
- Use `https://atlas.ransomed.app/api/actions` for protected reads and a Supabase user session for owner-scoped, row-level-security-protected writes.
- Treat non-JSON Cloudflare Access responses as `protected` instead of errors.

## Data Contract
- Decode a tolerant subset of `atlas_actions`: id, title, description, status, priority, business, work_mode, approval_state, due_date, review_date, next_action, owners, tags, and blocked flag.
- Create and edit through a user-authenticated session, include expected revisions on status writes, and require evidence before Done.

## Validation
- Build native iOS Simulator app.
- Install and launch on `AC0EF2E3-FF6A-4572-8477-EF5DF1F2A5E3`.
- Capture screenshots.
- Attempt iphoneos build with existing signing settings.
- Scan native source and built app bundle for privileged secrets.
