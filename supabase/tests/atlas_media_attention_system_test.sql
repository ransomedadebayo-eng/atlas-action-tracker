begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(36);

select has_column('public','atlas_media_plans','intent_summary','media plan has a weekly intent');
select has_column('public','atlas_media_plans','input_jobs','media plan has input jobs');
select has_column('public','atlas_media_plans','weekly_budget','media plan has a weekly budget');
select has_column('public','atlas_media_plan_items','input_job','media item names the job it serves');
select has_column('public','atlas_media_plan_items','selection_reason','media item explains why it was selected');
select has_column('public','atlas_media_plan_items','stop_rule','media item has an explicit stop rule');
select has_table('public','atlas_media_item_feedback','owner usefulness feedback is stored');
select has_function('public','upsert_atlas_media_plan_v2',array['date','uuid','text','text','text','text','text[]','integer','jsonb','text','text'],'attention-aware plan upsert exists');
select has_function('public','record_atlas_media_item_feedback',array['uuid','text','text','text','text'],'owner feedback RPC exists');
select has_trigger('public','atlas_media_item_feedback','atlas_media_feedback_reject_mutation','feedback history is immutable');
select ok((select relrowsecurity from pg_class where oid='public.atlas_media_item_feedback'::regclass),'feedback enforces RLS');
select ok(not has_function_privilege('authenticated','public.upsert_atlas_media_plan_v2(date,uuid,text,text,text,text,text[],integer,jsonb,text,text)','execute'),'public users cannot curate through the guarded RPC');
select ok(has_function_privilege('service_role','public.upsert_atlas_media_plan_v2(date,uuid,text,text,text,text,text[],integer,jsonb,text,text)','execute'),'service role can curate through the guarded RPC');

select lives_ok($$select public.upsert_atlas_media_plan_v2(
  date '2026-09-14',null,'recovery','complete','attention-1',
  'Stay oriented once and keep the rest of the week media-light.',array['orient']::text[],2,
  '[
    {"source_key":"orient-1","platform":"youtube","category":"brief_news","item_type":"consumable","title":"One useful briefing","creator":"Trusted source","source_url":"https://www.youtube.com/watch?v=brief","duration_minutes":18,"planned_date":"2026-09-15","trigger_kind":"weekday_morning","purpose":"Know what materially changed","input_job":"orient","selection_reason":"Matches this week input job and has not been watched","stop_rule":"Stop when the briefing ends","rank":0},
    {"source_key":"reset-1","platform":"apple_music","category":"reset","item_type":"reset","title":"Familiar screen-off audio","creator":"Your library","duration_minutes":15,"trigger_kind":"after_work_reset","purpose":"Lower stimulation without browsing","input_job":"reset","selection_reason":"A familiar fallback prevents feed switching","stop_rule":"Keep the screen off","rank":1}
  ]'::jsonb,'codex','attention-upsert-1')$$,'attention-aware plan succeeds');
select is((select intent_summary from public.atlas_media_plans where week_start='2026-09-14'),'Stay oriented once and keep the rest of the week media-light.','weekly intent persists');
select is((select input_jobs from public.atlas_media_plans where week_start='2026-09-14'),array['orient']::text[],'input jobs persist');
select is((select weekly_budget from public.atlas_media_plans where week_start='2026-09-14'),2,'weekly budget persists');
select is((select input_job from public.atlas_media_plan_items where source_key='orient-1'),'orient','item job persists');
select is((select selection_reason from public.atlas_media_plan_items where source_key='orient-1'),'Matches this week input job and has not been watched','selection reason persists');
select is((select stop_rule from public.atlas_media_plan_items where source_key='orient-1'),'Stop when the briefing ends','stop rule persists');
select is((select count(*) from public.atlas_media_plan_items i join public.atlas_media_plans p on p.id=i.media_plan_id where p.week_start='2026-09-14' and i.item_type='reset' and i.status<>'removed'),1::bigint,'one Reset persists');
select lives_ok($$select public.upsert_atlas_media_plan_v2(date '2026-09-14',null,'recovery','complete','ignored','ignored',array[]::text[],0,'[]'::jsonb,'codex','attention-upsert-1')$$,'plan replay is idempotent before validation');
select is((select count(*) from public.atlas_media_plan_activity where idempotency_key='attention-upsert-1'),1::bigint,'plan replay keeps one activity receipt');
select lives_ok($$select public.upsert_atlas_media_plan_v2(
  date '2026-09-21',null,'recovery','complete','whole-week',
  'A useful mix of news, growth, and restoration.',array['orient','advance','restore']::text[],4,
  '[
    {"source_key":"news","platform":"youtube","category":"brief_news","item_type":"consumable","title":"News","creator":"Source","source_url":"https://www.youtube.com/watch?v=news","planned_date":"2026-09-21","trigger_kind":"weekday_morning","purpose":"p","input_job":"orient","selection_reason":"r","stop_rule":"s","rank":0},
    {"source_key":"podcast","platform":"spotify","category":"growth","item_type":"consumable","title":"Podcast","creator":"Show","source_url":"https://open.spotify.com/episode/example","planned_date":"2026-09-22","trigger_kind":"daytime_transition_1","purpose":"p","input_job":"advance","selection_reason":"r","stop_rule":"s","rank":1},
    {"source_key":"topic","platform":"other","category":"growth","item_type":"consumable","title":"Project topic","creator":"Specific search","planned_date":"2026-09-23","trigger_kind":"daytime_transition_1","purpose":"p","input_job":"advance","selection_reason":"r","stop_rule":"s","rank":2},
    {"source_key":"music","platform":"spotify","category":"music","item_type":"consumable","title":"Music","creator":"Playlist","source_url":"https://open.spotify.com/playlist/example","planned_date":"2026-09-24","trigger_kind":"daytime_transition_2","purpose":"p","input_job":"restore","selection_reason":"r","stop_rule":"s","rank":3},
    {"source_key":"reset-2","platform":"apple_music","category":"reset","item_type":"reset","title":"Reset","trigger_kind":"after_work_reset","purpose":"p","input_job":"reset","selection_reason":"r","stop_rule":"s","rank":4}
  ]'::jsonb,'codex','whole-week-upsert')$$,'workload capacity does not reduce the media curation budget');
select is((select weekly_budget from public.atlas_media_plans where week_start='2026-09-21'),4,'capacity-independent weekly budget persists');
select is((select count(*) from public.atlas_media_plan_items i join public.atlas_media_plans p on p.id=i.media_plan_id where p.week_start='2026-09-21' and i.platform='spotify' and i.status<>'removed'),2::bigint,'Spotify is a first-class media platform');
select throws_ok($$select public.upsert_atlas_media_plan_v2(date '2026-09-28',null,'recovery','complete','duplicate-day','One choice per day',array['orient','restore']::text[],2,'[{"source_key":"one","platform":"youtube","category":"brief_news","item_type":"consumable","title":"One","creator":"Source","source_url":"https://www.youtube.com/watch?v=one","planned_date":"2026-09-28","trigger_kind":"weekday_morning","purpose":"p","input_job":"orient","selection_reason":"r","stop_rule":"s","rank":0},{"source_key":"two","platform":"spotify","category":"leisure","item_type":"consumable","title":"Two","creator":"Source","source_url":"https://open.spotify.com/episode/two","planned_date":"2026-09-28","trigger_kind":"daytime_transition_1","purpose":"p","input_job":"restore","selection_reason":"r","stop_rule":"s","rank":1},{"source_key":"reset-3","platform":"apple_music","category":"reset","item_type":"reset","title":"Reset","trigger_kind":"after_work_reset","purpose":"p","input_job":"reset","selection_reason":"r","stop_rule":"s","rank":2}]'::jsonb,'codex','duplicate-day')$$,'22023','ATLAS_MEDIA_DAILY_CAP','weekly map permits one consumable per day');
select throws_ok($$select public.upsert_atlas_media_plan_v2(date '2026-10-05',null,'expansion','complete','bad-budget','Too much',array['orient']::text[],7,'[{"source_key":"reset-4","platform":"apple_music","category":"reset","item_type":"reset","title":"Reset","trigger_kind":"after_work_reset","purpose":"p","input_job":"reset","selection_reason":"r","stop_rule":"s","rank":0}]'::jsonb,'codex','bad-budget')$$,'22023','ATLAS_MEDIA_WEEKLY_BUDGET_INVALID','weekly budget remains capped at six consumables');
select throws_ok($$update public.atlas_media_plans set weekly_budget=0 where week_start='2026-09-14'$$,'23514','new row for relation "atlas_media_plans" violates check constraint "atlas_media_plan_weekly_budget_check"','media plans reject a zero weekly budget');
select throws_ok($$select public.upsert_atlas_media_plan_v2(date '2026-09-21',null,'recovery','complete','missing-reset','Orient once',array['orient']::text[],1,'[{"source_key":"orient","platform":"youtube","category":"brief_news","item_type":"consumable","title":"Brief","creator":"Source","source_url":"https://www.youtube.com/watch?v=brief","planned_date":"2026-09-21","trigger_kind":"weekday_morning","purpose":"p","input_job":"orient","selection_reason":"r","stop_rule":"s","rank":0}]'::jsonb,'codex','missing-reset')$$,'22023','ATLAS_MEDIA_PLAN_RESET_REQUIRED','attention plan requires Reset');

select lives_ok($$select public.record_atlas_media_item_feedback((select id from public.atlas_media_plan_items where source_key='orient-1'),'helpful','','ransomed','feedback-1')$$,'owner records usefulness feedback');
select lives_ok($$select public.record_atlas_media_item_feedback((select id from public.atlas_media_plan_items where source_key='orient-1'),'led_to_drift','','ransomed','feedback-1')$$,'feedback replay is idempotent');
select is((select count(*) from public.atlas_media_item_feedback where idempotency_key='feedback-1'),1::bigint,'feedback replay keeps one immutable event');
select throws_ok($$select public.record_atlas_media_item_feedback((select id from public.atlas_media_plan_items where source_key='orient-1'),'helpful','','codex','feedback-machine')$$,'42501','ATLAS_MEDIA_FEEDBACK_OWNER_REQUIRED','machine principal cannot claim usefulness');
select throws_ok($$update public.atlas_media_item_feedback set outcome='neutral' where idempotency_key='feedback-1'$$,'55000','ATLAS_MEDIA_ACTIVITY_IMMUTABLE','feedback cannot be updated');
select throws_ok($$delete from public.atlas_media_item_feedback where idempotency_key='feedback-1'$$,'55000','ATLAS_MEDIA_ACTIVITY_IMMUTABLE','feedback cannot be deleted');

select * from finish();
rollback;
