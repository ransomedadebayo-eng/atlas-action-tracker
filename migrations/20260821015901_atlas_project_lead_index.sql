create index if not exists atlas_projects_lead_idx
  on public.atlas_projects (lead_id)
  where lead_id is not null;
