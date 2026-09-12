-- Forward performance correction from production advisor readback.
create index if not exists atlas_triage_entries_canonical_action_idx
  on public.atlas_triage_entries (canonical_action_id)
  where canonical_action_id is not null;

create index if not exists atlas_triage_events_action_idx
  on public.atlas_triage_events (action_id, created_at desc);

create index if not exists atlas_triage_settings_accept_status_idx
  on public.atlas_triage_settings (default_accept_status_id)
  where default_accept_status_id is not null;
