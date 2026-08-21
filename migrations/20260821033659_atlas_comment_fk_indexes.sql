-- Forward advisor correction for production migration 2026082011.
create index if not exists atlas_comments_parent_idx
  on public.atlas_comments(parent_comment_id) where parent_comment_id is not null;
create index if not exists atlas_comments_resolution_idx
  on public.atlas_comments(resolution_comment_id) where resolution_comment_id is not null;
