# Atlas Today Rules-Based Retriage Plan

## Architecture

The database owns the rules registry, rule versions, daily plans, daily plan items, and rule proposals. Atlas Worker and local Express expose the same `/api/today` contract. The React Today page renders the daily plan if available and uses the legacy action-derived view only as a visible fallback.

PEOS reads the same tables directly from Supabase and adds a Today Review route for owner-facing review of assistant output, rule proposals, unavailable sources, and plan evidence.

## Data Flow

1. Automation runs duplicate guard.
2. Source scout loads bounded Atlas, PEOS, automation report, calendar, Gmail, Codex-thread, and AEGIS context.
3. Rule engine applies hard gates, scored rules, and capacity caps.
4. Plan writer upserts one daily plan and item set for the local date.
5. PEOS report/readback records implemented, verified, and remaining work.
6. Atlas Today and PEOS Today Review read the same daily plan and rule version.

## API Contracts

- `GET /api/today?date=YYYY-MM-DD`: returns the current daily plan or an empty plan response.
- `GET /api/today/rules`: returns active rules and latest active rule version metadata.
- `POST /api/today/dry-run`: computes a plan preview without writes.
- `POST /api/today`: upserts a daily plan payload.
- `POST /api/today/rule-proposals`: records a PEOS-reviewable rule proposal.
- `POST /api/today/rule-proposals/:id/activate`: activates an approved proposal by creating a new rule version.

## Rules

Hard gates suppress done/closed tasks, FYIs, blocked rows with no owner-actionable next step, frozen business work, and disallowed Riddim Exchange execution work. Scored rules add weight for due pressure, material consequences, life priority, source freshness, owner-only requirements, calendar fit, health readiness, and communication urgency.

Capacity caps select three items on recovery days, three to five on normal days, and at most one deep-work item plus light admin/review on high-capacity build days.

## Execution Notes

Frontend changes must follow `$impeccable` product-register guidance: restrained, dense, predictable product UI with no decorative dashboard clutter. Implementation must keep PEOS journal boundaries intact and must report whether local `supabase-aegis` or hosted Supabase was used for live database work.
