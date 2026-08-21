# Templates And Documents Technical Plan

## Architecture

1. Add template, instance, template-activity, document, document-version, and
   document-activity tables plus provenance columns on actions/projects.
2. Keep blueprints and form schemas as typed JSON on the template row. Enforce
   top-level JSON shape in Postgres and detailed type/reference integrity in the
   Worker and instantiation RPC.
3. Implement one security-definer instantiation RPC that locks the template,
   validates form values, snapshots the source revision, and branches by type.
4. For projects, build local key-to-ID maps inside PL/pgSQL, then create
   milestones, actions, sub-action parent links, and initiative memberships
   before returning the instance receipt.
5. Add template CRUD/default/duplicate/archive/restore and document
   list/detail/update/archive/restore/version routes with scoped authorization.
6. Add React Query hooks and lazy-loaded Templates/Documents pages. Use a typed
   editor with an advanced JSON blueprint surface so every supported property
   remains expressible without hiding complexity.
7. Bind template discovery/default resolution into Quick Capture and Project
   creation, while keeping explicit instantiation available from Templates.

## Data Contracts

- `atlas_templates`: typed reusable blueprint and form schema.
- `atlas_template_instances`: immutable provenance receipt.
- `atlas_template_activity_log`: append-only template audit ledger.
- `atlas_documents`: versioned Markdown record with one optional work context.
- `atlas_document_versions`: immutable content snapshots.
- `atlas_document_activity_log`: append-only document audit ledger.
- `atlas_actions` / `atlas_projects`: nullable template provenance columns.

## Integrity

- Template key uniqueness and reference validation happen before any instance
  writes.
- Instantiation is all-or-nothing and rejects archived templates or referenced
  work records.
- Default uniqueness excludes archived templates.
- Documents may have at most one context and the referenced record must exist.
- No template instance or document version can be updated or deleted.

## Test Strategy

- pgTAP: schema, grants/RLS, defaults, form validation, action/sub-action
  creation, project graph creation, initiative membership, document versioning,
  provenance, duplicate/archive/restore, and non-deletion.
- Worker: blueprint/form validation, default resolution, scope boundaries, and
  error mapping.
- UI: template editor/list/use flow, dynamic form fields, document list/editor/
  history, default selection, and axe checks.
- Full contract/build/typecheck/test/audit gate, transactional production
  rehearsal, committed pgTAP, advisors, row/grant readback, deploy, and live
  route/asset/API verification.

## Rollout

- The 81-assertion migration rehearsal rolled back cleanly, then passed against
  the committed production schema.
- Production preserved 566 actions, five saved views, and zero template,
  document, or fixture rows; existing provenance columns remain null.
- Missing provenance foreign-key indexes were added in a forward correction and
  the advisor findings cleared.
- Worker/UI version `987bfcf9-bad5-4715-9ccc-9d718d592423` serves Templates and
  Documents routes plus default-template creation integration.
- Authenticated owner interaction smoke remains pending a usable Access browser
  session; routes, chunks, health, API denial, and Access redirects are verified.
