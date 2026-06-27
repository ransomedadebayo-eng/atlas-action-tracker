# Implementation Plan

## Backend
- Add `/api/journal` for listing, creating, updating review state, archiving, deleting, and promoting reviewed journal entries to Atlas actions.
- Add `/api/decide` for reading proposal/run/signal/review queues and deciding proposal packets.
- Wire both routes into the Cloudflare Worker and local Express server.

## Frontend
- Add `JournalPage` with capture form, filters, entry cards, review/archive/delete controls, and promotion to Atlas action.
- Add `DecidePage` with proposal cards, inline decision buttons, and supporting run/signal/review queues.
- Add React Query hooks and client API methods.
- Add Journal and Decide to Atlas navigation and topbar titles.

## Verification
- Build app and worker.
- Deploy Worker/assets.
- Verify in the live Chrome profile that Today, Review, Journal, Decide, All Tasks, and Kanban render without the view-error card.
