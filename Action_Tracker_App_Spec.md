# ATLAS Action Tracker Application Specification

## Product contract

ATLAS is Ransomed's owner-only execution board inside AEGIS. It is not a collaboration product. The only active principals are:

- `ransomed`: sole human owner and approval authority.
- `codex`: scoped machine principal.
- `claude`: scoped machine principal.

Other people may appear only as immutable historical provenance on closed actions. They cannot sign in, receive assignments, appear in active filters, or become active members.

## Source of truth and architecture

- Canonical database: AEGIS Supabase project `vdezxdeushxaacyfjeeh`, especially `public.atlas_actions`.
- Canonical application backend: the Hono Cloudflare Worker in `worker/`.
- Review surface: the React/Vite app in `app/`, served by the Worker in production.
- Automation runtime: guarded Codex protocols. The Worker may display their reports but cannot execute them.
- Historical Turso and Supabase project `mnfovwxgmhacfljcpkio` references are stale.

The browser communicates only with `/api`. It never receives Supabase service credentials. Ransomed authenticates through an exact Cloudflare Access email allowlist. Codex and Claude authenticate independently with scoped machine credentials; a shared all-powerful bearer is prohibited.

## Core behavior

ATLAS supports capture, prioritization, assignment among the three principals, status transitions, next actions, blockers, review gates, journal/decision context, transcript intake, saved views, and read-only automation status.

Actions and activity evidence are never physically deleted. The removal workflow is an audited archive transition with an explicit restore operation. Completing an action requires honest evidence classification:

- `manual_attestation`: a human or agent note asserting completion.
- `verified_execution`: evidence backed by a source readback or execution artifact.
- `legacy_unverified`: a historical closed record lacking sufficient evidence.

The application never fabricates proof and never reopens a grandfathered closed action solely to backfill evidence.

## Canonical taxonomy

Active business references normalize to stable identifiers, including one `real_estate`, one `riddim_exchange`, and one `wealth-os` lane. Wealth, Investments, and Wealth & Investments are aliases of `wealth-os`, not separate active businesses.

## API principles

- Mutations validate active principals, references, allowed transitions, and optional expected revisions.
- Completion, archive, and restore are atomic database operations that append activity evidence.
- `DELETE /api/actions/:id` returns `405 Method Not Allowed`.
- Collection endpoints provide bounded pagination or an explicit complete result.
- Errors have stable codes and do not leak credentials or internal stack traces.
- `GET /api/automations` is report-driven and read-only; manual run endpoints do not exist.

## Experience requirements

The first view answers what matters now, what is blocked, what requires Ransomed, and what Codex or Claude can advance. Metrics reflect complete server-side counts rather than the currently loaded page. Loading, empty, stale, partial, unauthorized, forbidden, and failed states are distinct.

Primary workflows are keyboard operable, WCAG AA, reduced-motion safe, and usable on desktop and mobile. Controls use semantic buttons and labels, focus is visible and restored after dialogs, status is not conveyed by color alone, and evidence is presented summary-first rather than as raw JSON.

## Operational safety

- Migrations are forward-only and must preserve historical evidence.
- Never use destructive rollback SQL or delete Atlas activity records.
- Production migration/deployment requires staged verification and owner approval.
- Reports separate implemented, verified, and remaining operational work.

The detailed current acceptance criteria and delivery slices live in `specs/atlas-trust-overhaul/`.
