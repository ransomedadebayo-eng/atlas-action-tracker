# Implementation Plan

## Backend

- Add `/api/today` for current daily plan reads and fallback candidates.
- Add `atlas-nightly-retriage` to Worker automation jobs and schedule it overnight UTC.
- Write automation reports to `automation_run_reports` and link them to `atlas_daily_plans`.
- Add Atlas OS read routes for Review, Decide, and Journal.
- Expand `/api/automations` with registry and last-run status.

## Frontend

- Replace Today with a curated plan view.
- Add Review, Decide, Journal, and Automations navigation entries.
- Keep All Tasks/Kanban/Calendar/Team/Transcripts unchanged as backlog and supporting surfaces.

## Verification

- Build frontend and type-check Worker.
- Deploy Worker.
- Run `atlas-nightly-retriage` manually.
- Read back plan, items, and report rows.
- Verify live Atlas pages in Chrome.
