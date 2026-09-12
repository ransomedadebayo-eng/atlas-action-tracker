begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(31);

select has_column('public','atlas_media_plan_items','eligible_from','media items have eligibility start');
select has_column('public','atlas_media_plan_items','eligible_until','media items have eligibility end');
select has_column('public','atlas_media_plan_items','window_group','media items have a daily window group');
select has_table('public','atlas_media_daily_allowances','daily allowances table exists');
select has_table('public','atlas_media_daily_allowance_activity','allowance activity exists');
select has_table('public','atlas_media_external_sync_runs','external sync runs exist');
select has_table('public','atlas_media_external_sync_items','external sync items exist');
select has_function('public','start_atlas_media_twitter_allowance',array['date','text','text','bigint'],'owner Twitter-start RPC exists');
select has_function('public','record_atlas_media_sync_manifest',array['date','text','text','text','text','jsonb','text','text'],'sync manifest RPC exists');
select has_trigger('public','atlas_media_daily_allowance_activity','atlas_media_allowance_activity_reject_mutation','allowance activity is immutable');
select has_trigger('public','atlas_media_external_sync_runs','atlas_media_sync_runs_reject_mutation','sync runs are immutable');
select has_trigger('public','atlas_media_external_sync_items','atlas_media_sync_items_reject_mutation','sync items are immutable');

select throws_ok($$select public.upsert_atlas_media_plan(
  date '2026-08-31',null,'recovery','complete','recovery-two',
  '[{"source_key":"morning","platform":"other","category":"brief_news","item_type":"consumable","title":"Morning","planned_date":"2026-08-31","trigger_kind":"weekday_morning","purpose":"p","rank":0},{"source_key":"later","platform":"other","category":"growth","item_type":"consumable","title":"Later","planned_date":"2026-08-31","trigger_kind":"daytime_transition_1","purpose":"p","rank":1}]'::jsonb,
  'codex','daily-cap-recovery')$$,'22023','ATLAS_MEDIA_DAILY_CAP','Recovery rejects two consumables on one day');

select lives_ok($$select public.upsert_atlas_media_plan(
  date '2026-08-31',null,'standard','complete','standard-two',
  '[{"source_key":"morning","platform":"other","category":"brief_news","item_type":"consumable","title":"Morning","planned_date":"2026-08-31","trigger_kind":"weekday_morning","purpose":"p","rank":0},{"source_key":"later","platform":"other","category":"growth","item_type":"consumable","title":"Later","planned_date":"2026-08-31","trigger_kind":"daytime_transition_1","purpose":"p","rank":1},{"source_key":"reset","platform":"other","category":"reset","item_type":"reset","title":"Reset","trigger_kind":"after_work_reset","purpose":"p","rank":2}]'::jsonb,
  'codex','daily-cap-standard')$$,'Standard permits morning plus later');
select is((select window_group from public.atlas_media_plan_items where source_key='morning'),'morning','morning trigger maps to morning group');
select is((select window_group from public.atlas_media_plan_items where source_key='later'),'later','transition trigger maps to later group');
select is((select (eligible_from at time zone 'America/Los_Angeles')::time from public.atlas_media_plan_items where source_key='morning'),time '05:30','morning starts at 5:30 Pacific');
select is((select (eligible_until at time zone 'America/Los_Angeles')::time from public.atlas_media_plan_items where source_key='later'),time '14:00','first transition ends at 2 PM Pacific');

select throws_ok($$select public.upsert_atlas_media_plan(
  date '2026-09-07',null,'standard','complete','two-later',
  '[{"source_key":"later-1","platform":"other","category":"growth","item_type":"consumable","title":"One","planned_date":"2026-09-07","trigger_kind":"daytime_transition_1","purpose":"p","rank":0},{"source_key":"later-2","platform":"other","category":"growth","item_type":"consumable","title":"Two","planned_date":"2026-09-07","trigger_kind":"daytime_transition_2","purpose":"p","rank":1}]'::jsonb,
  'codex','daily-window-duplicate')$$,'22023','ATLAS_MEDIA_DAILY_WINDOW_DUPLICATE','Standard rejects two later windows on one day');

select lives_ok($$select public.start_atlas_media_twitter_allowance_at(date '2026-08-29','ransomed','twitter-start-1',null,timestamptz '2026-08-30 01:30:00+00')$$,'owner can start Twitter inside the Pacific window');
select lives_ok($$select public.start_atlas_media_twitter_allowance_at(date '2026-08-29','ransomed','twitter-start-1',null,timestamptz '2026-08-30 01:31:00+00')$$,'Twitter start replay is idempotent');
select is((select count(*) from public.atlas_media_daily_allowances where allowance_date='2026-08-29'),1::bigint,'one daily allowance exists');
select is((select extract(epoch from (twitter_expires_at-twitter_started_at))::integer from public.atlas_media_daily_allowances where allowance_date='2026-08-29'),900,'Twitter allowance lasts fifteen minutes');
select throws_ok($$select public.start_atlas_media_twitter_allowance_at(date '2026-08-29','ransomed','twitter-outside',null,timestamptz '2026-08-30 03:30:00+00')$$,'22023','ATLAS_MEDIA_TWITTER_WINDOW_CLOSED','Twitter cannot start outside 6-8 PM Pacific');
select throws_ok($$select public.start_atlas_media_twitter_allowance_at(date '2026-08-30','codex','twitter-machine',null,timestamptz '2026-08-31 01:30:00+00')$$,'42501','ATLAS_MEDIA_TWITTER_OWNER_REQUIRED','machine principal cannot start Twitter');

select lives_ok($$select public.record_atlas_media_sync_manifest(
  date '2026-08-31','youtube','personal','00 — This Week','sync-fingerprint-1',
  '{"additions":[{"media_item_id":"00000000-0000-0000-0000-000000000001","video_id":"video-1"}],"removals":[{"media_item_id":"00000000-0000-0000-0000-000000000002","video_id":"video-old","playlist_item_id":"playlist-old"}],"kept":[],"manual_preserved":[{"video_id":"manual","playlist_item_id":"playlist-manual"}]}'::jsonb,
  'codex','sync-manifest-1')$$,'dry-run sync manifest is recorded');
select lives_ok($$select public.record_atlas_media_sync_manifest(date '2026-08-31','youtube','personal','00 — This Week','sync-fingerprint-1','{}'::jsonb,'codex','sync-manifest-1')$$,'sync manifest replay is idempotent');
select is((select count(*) from public.atlas_media_external_sync_runs where idempotency_key='sync-manifest-1'),1::bigint,'one sync run is stored');
select is((select count(*) from public.atlas_media_external_sync_items),2::bigint,'add and remove operations are stored');
select throws_ok($$update public.atlas_media_external_sync_runs set status='failed' where idempotency_key='sync-manifest-1'$$,'55000','ATLAS_MEDIA_SYNC_IMMUTABLE','sync runs cannot be updated');
select throws_ok($$delete from public.atlas_media_external_sync_items$$,'55000','ATLAS_MEDIA_SYNC_IMMUTABLE','sync items cannot be deleted');

select * from finish();
rollback;
