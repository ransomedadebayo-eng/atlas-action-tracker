# Accessibility contract

ATLAS targets WCAG 2.1 AA for the owner review and action-management workflows.

## Required behavior

- Every workflow is operable with a keyboard and retains a visible focus indicator.
- Navigation exposes a skip link and semantic landmarks.
- Dialogs have an accessible name, constrain focus while open, close with Escape, and restore focus to their trigger.
- Icon-only controls have names; form controls have persistent labels and accessible validation errors.
- Loading, stale, partial, empty, unauthorized, forbidden, failure, and success states are announced without relying on color alone.
- Motion honors `prefers-reduced-motion`; layout remains usable at 200% zoom and narrow mobile widths.
- Touch targets for primary mobile actions are at least 44 by 44 CSS pixels.
- Evidence and status content is presented as structured text before raw diagnostic data.

## Verification

CI covers component-level semantic regressions. Release smoke testing must also include keyboard-only navigation, macOS VoiceOver reading order, focus restoration, 200% zoom, reduced motion, and desktop/mobile contrast checks. Automated checks do not replace those manual tests.

Known limitations must be recorded in the overhaul rollout evidence before production deployment.
