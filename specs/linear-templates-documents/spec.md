# Linear Templates And Documents

## Purpose

ATLAS needs reusable action, project, and document blueprints so repeated work
starts with the right structure and properties, while retaining provenance for
reporting. Document templates must create usable first-class documents rather
than inert text blobs.

## User Stories

### US1 - Reuse action patterns

As the owner, I can define a standard action template with title, description,
status, priority, owners, tags, estimate, project/milestone defaults, and nested
sub-actions, then instantiate it transactionally.

### US2 - Require structured intake

As the owner, I can define a form-mode action template with required text,
long-text, dropdown, checkbox, date, instruction, and property fields. ATLAS
rejects missing/invalid answers and maps completed answers into the new action.

### US3 - Reuse full project plans

As the owner, I can define a project template containing project properties,
initiative associations, milestones, actions, milestone assignment, and
sub-action hierarchy, then create the entire plan atomically.

### US4 - Create documents from reusable guidance

As the owner, I can create Markdown document templates and instantiate documents
inside a project, initiative, action, cycle, or workspace. Documents preserve
version history, context, template provenance, and archive/restore state.

### US5 - Manage defaults and provenance

As the owner, I can make one active default template per type/business/audience,
duplicate a template, archive/restore it, and see which records and instances
came from each template.

## Functional Requirements

1. One canonical template entity supports `action`, `project`, and `document`
   types; standard/form mode; workspace/business scope; default audience;
   revision; usage count; archive/restore; and audit history.
2. Template configuration is typed JSON validated by both Worker and database
   constraints. Form schemas are ordered arrays of typed fields with stable
   keys, labels, required state, options, help text, and optional property maps.
3. Active defaults are unique per template type, business scope, and audience.
4. Action configuration supports status, priority, owners, tags, estimate,
   business, description, due-date offset, project/milestone defaults, and a
   bounded acyclic sub-action tree.
5. Form templates support text, long text, dropdown, checkboxes, date,
   instructions, title, priority, due date, and labels. Required values and
   option membership are enforced before creation.
6. Project configuration supports name/summary/description, status, health,
   priority, lead, members, business, date offsets, cadence, initiative IDs,
   milestones, actions, milestone keys, and sub-action parent keys.
7. Project template instantiation creates project, milestones, actions,
   sub-action relationships, and initiative memberships in one transaction.
8. Document configuration supports title, Markdown content, icon, color, and
   allowed context types.
9. First-class documents support workspace/project/initiative/action/cycle
   context, Markdown content, revision, archive/restore, and append-only version
   snapshots.
10. Every template instantiation creates an immutable instance receipt with
    form values, overrides, result entity type/id, actor, timestamp, and source
    template revision.
11. Created actions, projects, and documents retain `template_id` and
    `template_instance_id`, enabling template-based filters and usage reports.
12. Templates may be duplicated without sharing mutable identity. Templates
    and documents archive/restore; hard deletion is disabled.
13. Template changes, default transitions, document changes, and instantiations
    append evidence. Template instances and document versions are immutable.
14. Browser code calls only the Worker. New tables enforce RLS; public roles
    cannot execute instantiation or lifecycle RPCs; service-role destructive
    grants are revoked.
15. `/templates`, `/documents`, and `/documents/:id` are stable accessible
    production routes. Action and project creation surfaces expose applicable
    templates and automatically select the matching active default.

## Success Criteria

- A project template creates its project graph atomically with correct milestone,
  parent, initiative, and provenance references.
- A form template rejects missing required answers and creates one action when
  valid.
- A document template creates a context-bound document and first version.
- Defaults resolve deterministically by exact business, then workspace fallback.
- Template-based filters return only records created from that template.
- Database, Worker, UI, accessibility, production, permission, and readback
  gates pass without fixture residue.

## Edge Cases

- Duplicate action/milestone/node keys in a blueprint.
- A sub-action references a missing or later-invalid parent.
- A milestone assignment references an unknown milestone key.
- An initiative or project context is archived or missing.
- A default template is archived and therefore ceases to be default.
- A template is edited after an instance; the instance keeps its source revision.
- A required checkbox value is an empty array.

## Out Of Scope

- External email/Slack/Zapier template triggers until integrations are built.
- Multi-user team scopes; Atlas maps Linear team scope to workspace or business.
- Realtime collaborative document cursors, subscriptions, comments, and
  reactions; those remain in the collaboration slice.
