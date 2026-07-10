# ATLAS Trust Overhaul Technical Plan

## Architecture

- React/Vite frontend with route-based navigation and shared typed contracts.
- Hono Cloudflare Worker as the single API/backend.
- AEGIS Supabase project as canonical data source.
- Guarded Codex protocol automations as the only automation writers.
- Owner Cloudflare Access JWT plus separate Codex/Claude scoped bearer principals.

## Delivery Slices

1. Contain security exposure, remove hard deletion, disable Worker automation execution, and patch dependencies.
2. Add forward migrations for principals, active-owner validation, taxonomy normalization, evidence quality, proposal timestamps, and deletion guards.
3. Consolidate Worker auth/API contracts and remove Express parity code.
4. Replace unsafe mutations with audited archive/restore and explicit completion evidence.
5. Rework frontend routing, roster, automation registry, data states, accessibility, and detail presentation.
6. Add database/API/UI tests, migration drift checks, dependency/security gates, and deployment smoke checks.

## Compatibility Strategy

- Database migrations land backward-compatibly before dependent API/UI changes.
- `DELETE /api/actions/:id` becomes `405 Method Not Allowed`; clients use archive/restore.
- Existing `evidence_json` remains readable; evidence quality is derived for legacy rows.
- Closed historical owner arrays are preserved; only active rows are normalized.
- Worker automation registry remains at the current read endpoint but becomes report-driven and read-only.

## Verification

- Local builds and type checks.
- Focused regression tests for grants, deletion, owner allowlist, scoped agents, evidence quality, archive/restore, registry read-only behavior, and pagination/error states.
- Supabase advisor comparison before/after staged migration.
- Signed-in desktop/mobile smoke tests without mutating production.

## Rollout Gate

Prepare migrations and deploy artifacts locally. Apply to staging with synthetic fixtures. Production application requires owner approval after staging security/readback evidence is complete.
