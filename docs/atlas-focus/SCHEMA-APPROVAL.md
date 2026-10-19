# Owner decision: enable durable project focus

Recommendation: approve the exact reviewed additive schema below so Atlas can persist timer state and session history. This decision is required by the owner's instruction to report gated schema work and avoid permission changes without approval.

Target: apply [schema-proposal.sql](schema-proposal.sql) once to canonical AEGIS Supabase project `vdezxdeushxaacyfjeeh`, then verify metadata and use the established tested GitHub release workflow. Exact SQL SHA256:

`119965d41dd5c9a393a0828cc0aef482ddc2de889fa6a0978819792881bff3b7`

The proposal creates:

- `atlas_focus_state`, `atlas_focus_sessions`, `atlas_focus_operations`, with constraints/indexes and immutable history/receipt triggers.
- Eight security-invoker helper/API functions under `atlas_focus_*`; one transaction and owner-row lock settle completion, transition state and store an idempotency receipt.
- RLS on the three new tables with no browser policies. Public/anon/authenticated access to these new objects is revoked.
- Access for the **existing** Worker `service_role` to these new objects only: SELECT/INSERT/UPDATE on state; SELECT/INSERT on sessions/receipts; EXECUTE on focus functions. DELETE/TRUNCATE/history UPDATE are unavailable. No roles, attributes, credentials, existing grants, policies, principal scopes or project/action data are changed.

Decision options:

- **Approve:** authorize this exact SQL, including only the stated new-object access, followed by database readback, GitHub release and authenticated live UI verification.
- **Reject/defer:** leave production untouched. The code stays reviewable, and durable focus remains unavailable until a separately approved storage approach exists.

Consequence if deferred: existing Atlas continues normally, but the new timer cannot save sessions or run durably. No browser-only fallback will pretend persistence succeeded.

Verified source: current Atlas repository/backend contract, read-only production metadata confirming the existing Worker role's project SELECT/UPDATE/BYPASSRLS privileges, 56 local PostgreSQL assertions against this exact SQL, independent code/SQL review, and synthetic desktop/mobile browser screenshots. No production migration has been attempted. This is **pending**, not denied and not an uncertain prior application.

Effort to apply after approval: one additive migration, metadata/readback verification and the existing GitHub deployment; live UI smoke and integrity checks follow. No destructive rollback is proposed.
