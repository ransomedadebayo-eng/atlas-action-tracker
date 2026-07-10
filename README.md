# ATLAS Action Tracker

ATLAS is the owner-only execution surface for AEGIS. Ransomed is the sole human owner; Codex and Claude are scoped machine principals. The application is not collaborative and does not support invitations, sharing, or additional active people.

## Architecture

- `app/`: React/Vite UI and Capacitor wrapper.
- `worker/`: canonical Hono Cloudflare Worker API and static asset host.
- `migrations/`: forward-only AEGIS Supabase migrations.
- `specs/atlas-trust-overhaul/`: current product and delivery contract.
- Guarded Codex protocols are the only automation runtime. The Worker automation registry is read-only.

The AEGIS Supabase project `vdezxdeushxaacyfjeeh` and `public.atlas_actions` are canonical. The Worker is the only application backend; browser code never receives Supabase or machine-principal secrets.

## Local development

1. Copy `worker/.dev.vars.example` to `worker/.dev.vars` and provide local secrets.
2. Copy `app/.env.example` to `app/.env` and set the local proxy token.
3. Run `npm run install:all` from the repository root.
4. Run `./launch.command`, or run `npm run dev --prefix worker -- --port 3001` and `npm run dev --prefix app` separately.

## Verification

Run `npm run check` from the repository root. CI builds the UI, typechecks and tests the Worker, and rejects high/critical production dependency advisories before deployment.

## Release boundary

Database migrations are forward-only. Never delete Atlas actions or activity records; archive or restore them through audited transitions. Production migrations and deployments require staged readback evidence and owner approval.
