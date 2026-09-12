begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(43);

select has_table('public','atlas_media_plans','media plans table exists');
select has_table('public','atlas_media_plan_items','media plan items table exists');
select has_table('public','atlas_media_plan_activity','media plan activity exists');
select has_function('public','upsert_atlas_media_plan',array['date','uuid','text','text','text','jsonb','text','text'],'guarded media-plan upsert exists');
select has_function('public','transition_atlas_media_item_status',array['uuid','bigint','text','text','text'],'guarded media status transition exists');
select has_trigger('public','atlas_media_plans','atlas_media_plans_reject_delete','media plans cannot be deleted');
select has_trigger('public','atlas_media_plan_items','atlas_media_plan_items_reject_delete','media items cannot be deleted');
select has_trigger('public','atlas_media_plan_activity','atlas_media_plan_activity_reject_mutation','media activity is immutable');
select has_trigger('public','atlas_media_plan_items','atlas_media_plan_items_audit_row','media item changes are audited');
select ok(not has_function_privilege('anon','public.upsert_atlas_media_plan(date,uuid,text,text,text,jsonb,text,text)','execute') and not has_function_privilege('authenticated','public.transition_atlas_media_item_status(uuid,bigint,text,text,text)','execute'),'public roles cannot execute media mutation RPCs');
select ok(has_function_privilege('service_role','public.upsert_atlas_media_plan(date,uuid,text,text,text,jsonb,text,text)','execute') and has_function_privilege('service_role','public.transition_atlas_media_item_status(uuid,bigint,text,text,text)','execute'),'service role can execute media RPCs');
select ok((select bool_and(relrowsecurity) from pg_class where oid in('public.atlas_media_plans'::regclass,'public.atlas_media_plan_items'::regclass,'public.atlas_media_plan_activity'::regclass)),'media tables enforce RLS');

select lives_ok($$select public.upsert_atlas_media_plan(
  date '2026-08-24',null,'standard','complete','fingerprint-1',
  '[
    {"source_key":"news-1","platform":"apple_podcasts","category":"brief_news","item_type":"consumable","title":"Morning brief","creator":"Morning Brew Daily","source_url":"https://podcasts.apple.com/us/podcast/example/id1","duration_minutes":20,"planned_date":"2026-08-24","trigger_kind":"weekday_morning","purpose":"Know the day without opening a feed","rank":0},
    {"source_key":"growth-1","platform":"youtube","category":"growth","item_type":"consumable","title":"Build a useful system","creator":"Creator","source_url":"https://www.youtube.com/watch?v=one","duration_minutes":24,"planned_date":"2026-08-25","trigger_kind":"daytime_transition_1","purpose":"Choose one system to try","rank":1},
    {"source_key":"growth-2","platform":"youtube","category":"growth","item_type":"consumable","title":"Make a product decision","creator":"Creator","source_url":"https://www.youtube.com/watch?v=two","duration_minutes":27,"planned_date":"2026-08-27","trigger_kind":"daytime_transition_2","purpose":"Support a current product decision","rank":2},
    {"source_key":"relationship-1","platform":"apple_podcasts","category":"faith_family_health","item_type":"consumable","title":"Be a better partner","creator":"Hidden Brain","source_url":"https://podcasts.apple.com/us/podcast/example/id2","duration_minutes":41,"planned_date":"2026-08-29","trigger_kind":"saturday_walk","purpose":"Carry one reflection into family time","rank":3},
    {"source_key":"faith-1","platform":"apple_podcasts","category":"faith_family_health","item_type":"consumable","title":"Faith episode","creator":"Ask Pastor John","source_url":"https://podcasts.apple.com/us/podcast/example/id3","duration_minutes":12,"planned_date":"2026-08-30","trigger_kind":"sunday_faith","purpose":"Use the Sunday quiet window","rank":4},
    {"source_key":"music-1","platform":"youtube","category":"music","item_type":"consumable","title":"Sunday worship","creator":"Change Worship","source_url":"https://www.youtube.com/watch?v=three","duration_minutes":30,"planned_date":"2026-08-30","trigger_kind":"sunday_restoration","purpose":"Restore without browsing","rank":5},
    {"source_key":"reset-1","platform":"apple_music","category":"reset","item_type":"reset","title":"Reset audio","creator":"Apple Music","source_url":"https://music.apple.com/us/playlist/example/pl.u-test","duration_minutes":30,"planned_date":null,"trigger_kind":"after_work_reset","purpose":"Use screen-off after work","rank":6}
  ]'::jsonb,'codex','media-upsert-1')$$,'first media plan upsert succeeds');
select is((select count(*) from public.atlas_media_plans where week_start='2026-08-24'),1::bigint,'one plan exists for the week');
select is((select count(*) from public.atlas_media_plan_items item join public.atlas_media_plans plan on plan.id=item.media_plan_id where plan.week_start='2026-08-24' and item.status<>'removed'),7::bigint,'plan has seven active items');
select is((select count(*) from public.atlas_media_plan_items item join public.atlas_media_plans plan on plan.id=item.media_plan_id where plan.week_start='2026-08-24' and item.item_type='reset' and item.status<>'removed'),1::bigint,'plan has one active reset item');

select lives_ok($$select public.upsert_atlas_media_plan(date '2026-08-24',null,'standard','complete','fingerprint-1','[]'::jsonb,'codex','media-upsert-1')$$,'upsert replay succeeds before payload validation');
select is((select count(*) from public.atlas_media_plan_items where status<>'removed'),7::bigint,'upsert replay does not duplicate active items');
select is((select count(*) from public.atlas_media_plan_activity where idempotency_key='media-upsert-1'),1::bigint,'upsert replay keeps one activity receipt');

select lives_ok($$select public.transition_atlas_media_item_status((select id from public.atlas_media_plan_items where source_key='news-1'),1,'done','ransomed','media-status-1')$$,'owner can mark item done');
select is((select status from public.atlas_media_plan_items where source_key='news-1'),'done','done status persists');
select is((select revision from public.atlas_media_plan_items where source_key='news-1'),2::bigint,'status transition advances item revision');
select lives_ok($$select public.transition_atlas_media_item_status((select id from public.atlas_media_plan_items where source_key='news-1'),1,'skipped','ransomed','media-status-1')$$,'status replay is idempotent');
select is((select count(*) from public.atlas_media_plan_activity where idempotency_key='media-status-1'),1::bigint,'status replay keeps one activity receipt');
select throws_ok($$select public.transition_atlas_media_item_status((select id from public.atlas_media_plan_items where source_key='growth-1'),99,'done','ransomed','media-status-stale')$$,'40001','ATLAS_MEDIA_ITEM_REVISION_CONFLICT','stale status revision is rejected');
select throws_ok($$select public.transition_atlas_media_item_status((select id from public.atlas_media_plan_items where source_key='growth-1'),1,'done','codex','media-status-machine')$$,'42501','ATLAS_MEDIA_ITEM_OWNER_REQUIRED','machine principal cannot claim consumption');
select throws_ok($$select public.transition_atlas_media_item_status((select id from public.atlas_media_plan_items where source_key='growth-1'),1,'removed','ransomed','media-status-invalid')$$,'22023','ATLAS_MEDIA_ITEM_STATUS_INVALID','owner cannot select internal removed status');

select lives_ok($$select public.upsert_atlas_media_plan(
  date '2026-08-24',null,'standard','partial','fingerprint-2',
  '[
    {"source_key":"news-1","platform":"apple_podcasts","category":"brief_news","item_type":"consumable","title":"Updated morning brief","creator":"Morning Brew Daily","source_url":"https://podcasts.apple.com/us/podcast/example/id1","duration_minutes":20,"planned_date":"2026-08-24","trigger_kind":"weekday_morning","purpose":"Know the day without opening a feed","rank":0},
    {"source_key":"growth-1","platform":"youtube","category":"growth","item_type":"consumable","title":"Updated useful system","creator":"Creator","source_url":"https://www.youtube.com/watch?v=one","duration_minutes":24,"planned_date":"2026-08-25","trigger_kind":"daytime_transition_1","purpose":"Choose one system to try","rank":1},
    {"source_key":"growth-2","platform":"youtube","category":"growth","item_type":"consumable","title":"Make a product decision","creator":"Creator","source_url":"https://www.youtube.com/watch?v=two","duration_minutes":27,"planned_date":"2026-08-27","trigger_kind":"daytime_transition_2","purpose":"Support a current product decision","rank":2},
    {"source_key":"relationship-1","platform":"apple_podcasts","category":"faith_family_health","item_type":"consumable","title":"Be a better partner","creator":"Hidden Brain","source_url":"https://podcasts.apple.com/us/podcast/example/id2","duration_minutes":41,"planned_date":"2026-08-29","trigger_kind":"saturday_walk","purpose":"Carry one reflection into family time","rank":3},
    {"source_key":"faith-1","platform":"apple_podcasts","category":"faith_family_health","item_type":"consumable","title":"Faith episode","creator":"Ask Pastor John","source_url":"https://podcasts.apple.com/us/podcast/example/id3","duration_minutes":12,"planned_date":"2026-08-30","trigger_kind":"sunday_faith","purpose":"Use the Sunday quiet window","rank":4},
    {"source_key":"music-1","platform":"youtube","category":"music","item_type":"consumable","title":"Sunday worship","creator":"Change Worship","source_url":"https://www.youtube.com/watch?v=three","duration_minutes":30,"planned_date":"2026-08-30","trigger_kind":"sunday_restoration","purpose":"Restore without browsing","rank":5},
    {"source_key":"reset-1","platform":"apple_music","category":"reset","item_type":"reset","title":"Reset audio","creator":"Apple Music","source_url":"https://music.apple.com/us/playlist/example/pl.u-test","duration_minutes":30,"planned_date":null,"trigger_kind":"after_work_reset","purpose":"Use screen-off after work","rank":6}
  ]'::jsonb,'codex','media-upsert-2')$$,'refresh succeeds');
select is((select status from public.atlas_media_plan_items where source_key='news-1'),'done','refresh preserves done status');
select is((select status from public.atlas_media_plan_items where source_key='growth-1'),'queued','refresh keeps queued item active');
select is((select title from public.atlas_media_plan_items where source_key='growth-1'),'Updated useful system','refresh updates queued item metadata');
select is((select count(*) from public.atlas_media_plan_items where status<>'removed'),7::bigint,'refresh retains seven active items');
select is((select source_status from public.atlas_media_plans where week_start='2026-08-24'),'partial','refresh records partial source status');

select throws_ok($$select public.upsert_atlas_media_plan(date '2026-08-24',null,'recovery','complete','too-many',jsonb_build_array(
  '{"source_key":"1","platform":"other","category":"leisure","item_type":"consumable","title":"1","trigger_kind":"flex","purpose":"p","rank":0}'::jsonb,
  '{"source_key":"2","platform":"other","category":"leisure","item_type":"consumable","title":"2","trigger_kind":"flex","purpose":"p","rank":1}'::jsonb,
  '{"source_key":"3","platform":"other","category":"leisure","item_type":"consumable","title":"3","trigger_kind":"flex","purpose":"p","rank":2}'::jsonb,
  '{"source_key":"4","platform":"other","category":"leisure","item_type":"consumable","title":"4","trigger_kind":"flex","purpose":"p","rank":3}'::jsonb,
  '{"source_key":"5","platform":"other","category":"leisure","item_type":"consumable","title":"5","trigger_kind":"flex","purpose":"p","rank":4}'::jsonb,
  '{"source_key":"6","platform":"other","category":"leisure","item_type":"consumable","title":"6","trigger_kind":"flex","purpose":"p","rank":5}'::jsonb,
  '{"source_key":"7","platform":"other","category":"leisure","item_type":"consumable","title":"7","trigger_kind":"flex","purpose":"p","rank":6}'::jsonb,
  '{"source_key":"8","platform":"other","category":"leisure","item_type":"consumable","title":"8","trigger_kind":"flex","purpose":"p","rank":7}'::jsonb
),'codex','media-too-many')$$,'22023','ATLAS_MEDIA_PLAN_ITEM_LIMIT','more than seven items is rejected');
select throws_ok($$select public.upsert_atlas_media_plan(date '2026-08-24',null,'recovery','complete','two-reset','[{"source_key":"r1","platform":"other","category":"reset","item_type":"reset","title":"r1","trigger_kind":"after_work_reset","purpose":"p","rank":0},{"source_key":"r2","platform":"other","category":"reset","item_type":"reset","title":"r2","trigger_kind":"after_work_reset","purpose":"p","rank":1}]'::jsonb,'codex','media-two-reset')$$,'22023','ATLAS_MEDIA_PLAN_RESET_LIMIT','more than one reset is rejected');
select throws_ok($$select public.upsert_atlas_media_plan(date '2026-08-25',null,'recovery','complete','bad-week','[]'::jsonb,'codex','media-bad-week')$$,'22023','ATLAS_MEDIA_PLAN_MONDAY_REQUIRED','non-Monday week is rejected');
select throws_ok($$select public.upsert_atlas_media_plan(date '2026-08-24',null,'recovery','complete','bad-url','[{"source_key":"bad","platform":"youtube","category":"growth","item_type":"consumable","title":"bad","source_url":"javascript:alert(1)","trigger_kind":"flex","purpose":"p","rank":0}]'::jsonb,'codex','media-bad-url')$$,'22023','ATLAS_MEDIA_SOURCE_URL_INVALID','non-HTTPS URL is rejected');

select lives_ok($$select public.upsert_atlas_media_plan(date '2026-08-31',null,'standard','complete','next-week','[{"source_key":"new-week","platform":"other","category":"brief_news","item_type":"consumable","title":"New week","planned_date":"2026-08-31","trigger_kind":"weekday_morning","purpose":"p","rank":0}]'::jsonb,'codex','media-next-week')$$,'new week plan succeeds');
select is((select count(*) from public.atlas_media_plan_items item join public.atlas_media_plans plan on plan.id=item.media_plan_id where plan.week_start='2026-08-31'),1::bigint,'new week does not carry prior items');

select throws_ok($$update public.atlas_media_plan_activity set actor='ransomed' where idempotency_key='media-upsert-1'$$,'55000','ATLAS_MEDIA_ACTIVITY_IMMUTABLE','media activity cannot be updated');
select throws_ok($$delete from public.atlas_media_plan_activity where idempotency_key='media-upsert-1'$$,'55000','ATLAS_MEDIA_ACTIVITY_IMMUTABLE','media activity cannot be deleted');
select throws_ok($$delete from public.atlas_media_plans where week_start='2026-08-24'$$,'55000','ATLAS_IMMUTABLE_HISTORY','media plans cannot be deleted');
select throws_ok($$delete from public.atlas_media_plan_items where source_key='growth-1'$$,'55000','ATLAS_IMMUTABLE_HISTORY','media items cannot be deleted');

select * from finish();
rollback;
