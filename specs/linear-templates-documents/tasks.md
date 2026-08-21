# Templates And Documents Tasks

## Database

- [x] Add template/document/provenance tables and columns with audit/RLS guards.
- [x] Implement typed transactional instantiation for action, project, and document templates.
- [x] Implement default, duplicate, document lifecycle, and version RPCs.
- [x] Add and pass the template/document pgTAP regression contract.

## Worker

- [x] Add template/document scopes and owner-only configuration/lifecycle gates.
- [x] Implement blueprint/form validation and template/default/instance routes.
- [x] Implement document list/detail/version/lifecycle routes.
- [x] Add template filtering/provenance to action and project APIs.

## Application

- [x] Add template/document API clients, hooks, routes, and navigation.
- [x] Add typed template editor, defaults, duplication, archive, and use flows.
- [x] Add dynamic form-template input and result navigation.
- [x] Add document list, context filters, editor, versions, archive/restore.
- [x] Integrate templates/defaults into Quick Capture and project creation.
- [x] Add component, accessibility, and route tests.

## Release

- [x] Run full repository verification and production dependency audits.
- [x] Rehearse/apply/test/read back production migration and advisors.
- [x] Deploy Worker/UI, verify live routes/assets/security, and update parity.
- [ ] Run authenticated owner-session desktop/mobile interaction smoke when a Cloudflare Access browser session is available.
