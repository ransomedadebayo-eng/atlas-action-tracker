-- Forward performance correction from production advisor readback.
create index if not exists atlas_outbox_deliveries_subscription_idx
  on public.atlas_outbox_deliveries (subscription_id, created_at desc);
