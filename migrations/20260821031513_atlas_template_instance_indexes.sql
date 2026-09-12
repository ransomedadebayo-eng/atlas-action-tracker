-- Forward advisor correction for production migration 2026082009.
create index if not exists atlas_actions_template_instance_idx
  on public.atlas_actions (template_instance_id) where template_instance_id is not null;
create index if not exists atlas_projects_template_instance_idx
  on public.atlas_projects (template_instance_id) where template_instance_id is not null;
create index if not exists atlas_documents_template_instance_idx
  on public.atlas_documents (template_instance_id) where template_instance_id is not null;
