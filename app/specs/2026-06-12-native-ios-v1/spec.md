# Atlas Native iOS v1 Spec

## User Value
Ransomed needs Atlas on iPhone to feel like a native execution surface, not a browser wrapper. The v1 app should open directly into a SwiftUI experience, show Atlas primary workflows, and handle protected Cloudflare Access state cleanly.

## Scope
- Native SwiftUI iOS app for bundle `app.ransomed.atlas`.
- Tabs for Today, Actions, Review, Calendar, and Settings.
- Owner-authenticated reads and revision-checked writes through the Atlas Worker and Supabase user session.
- Signed-out/protected state when Cloudflare Access blocks API reads.
- No service-role keys, API bearer tokens, Cloudflare Access secrets, or Supabase privileged tokens in native source or bundle.

## Out Of Scope
- Hard-deleting Atlas actions or activity history.
- Service-role or unauthenticated direct database access from iOS.
- Bypassing Cloudflare Access.
- Production deploys, commits, or database mutations.

## Acceptance Criteria
- App launch target starts native SwiftUI, not `CAPBridgeViewController` or a `WKWebView`.
- Simulator build installs and launches on iPhone 17 Pro, iOS 26.2.
- Protected state is visible and not blank when unauthenticated.
- Signed-in owners can create and edit tasks, perform revision-checked status changes, and attach completion evidence.
- Native source and built bundle pass focused secret scan.
