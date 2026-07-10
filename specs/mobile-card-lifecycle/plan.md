# Mobile Card Lifecycle Controls Plan

## Design

- Add a reusable `ActionCardControls` component backed by the existing completion and archive hooks.
- Keep lifecycle mutations separate from card navigation.
- Present a compact bottom action row and an accessible confirmation sheet.
- Use `expected_revision` when present to preserve optimistic concurrency.
- Integrate first with the mobile All Tasks card, the reported regression surface.

## Test Strategy

- Component-test visible controls, empty-note validation, completion evidence, archive confirmation, and click isolation.
- Run the full owner-only contract, frontend build/tests, Worker typecheck/tests, and audits.
- Deploy through the existing Worker pipeline and inspect the live app at 390x844.

## Risk Controls

- No hard-delete endpoint or UI language that implies irreversible deletion.
- No mutation during production smoke testing.
- Do not touch unrelated local iOS/spec artifacts.
