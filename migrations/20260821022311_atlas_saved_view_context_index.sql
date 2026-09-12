-- Forward correction for production migration 2026082004: cover the contextual
-- project foreign key independently of the entity-first view lookup index.
create index if not exists atlas_saved_views_context_project_idx
  on public.atlas_saved_views (context_project_id)
  where context_project_id is not null;
