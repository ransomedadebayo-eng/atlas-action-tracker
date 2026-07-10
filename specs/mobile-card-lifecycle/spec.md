# Mobile Card Lifecycle Controls

## Problem

Mobile ATLAS cards expose task details but no visible lifecycle controls. The owner cannot complete or remove work without first opening the full detail drawer.

## Requirements

1. Active mobile task cards show visible `Complete` and `Archive` actions with at least 44px touch targets.
2. Completion requires a non-empty owner attestation and uses the existing atomic completion endpoint.
3. Removal is an audited archive transition, never a hard delete, and requires explicit confirmation.
4. Lifecycle actions do not accidentally open the task detail drawer.
5. Dialogs are keyboard accessible, named, Escape-dismissible, and return focus when still possible.
6. Pending, failure, and validation states are visible and announced accessibly.
7. Successful lifecycle transitions refresh task, statistics, principal, and Today surfaces.

## Acceptance Criteria

- The mobile All Tasks card visibly exposes both controls.
- Tapping `Complete` opens a completion-note dialog and refuses an empty note.
- Tapping `Archive` explains that the task remains recoverable and requires confirmation.
- Component tests cover both guarded mutations and event isolation.
- The production mobile UI shows both controls without horizontal clipping.
