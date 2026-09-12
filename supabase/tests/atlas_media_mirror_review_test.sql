begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(18);

select has_table('public','atlas_media_sync_protocols','sync protocols exist');
select has_table('public','atlas_media_input_reviews','weekly input reviews exist');
select has_function('public','activate_atlas_media_sync_protocol',array['text','text','text','text','text','jsonb','text','text'],'owner activation RPC exists');
select has_function('public','record_atlas_media_sync_apply',array['date','uuid','text','text','jsonb','text','text'],'apply evidence RPC exists');
select has_function('public','record_atlas_media_input_review',array['date','text','jsonb','text','jsonb','jsonb','jsonb','jsonb','text','text'],'input review RPC exists');
select has_trigger('public','atlas_media_sync_protocols','atlas_media_sync_protocols_reject_delete','protocols cannot be deleted');
select has_trigger('public','atlas_media_input_reviews','atlas_media_input_reviews_reject_mutation','reviews are immutable');

select throws_ok($$select public.activate_atlas_media_sync_protocol('youtube','personal','PL-test','00 — This Week','hash','{}'::jsonb,'codex','protocol-machine')$$,'42501','ATLAS_MEDIA_SYNC_PROTOCOL_OWNER_REQUIRED','machine cannot activate protocol');
select lives_ok($$select public.activate_atlas_media_sync_protocol('youtube','personal','PL-test','00 — This Week','protocol-hash','{"preserve_manual_entries":true}'::jsonb,'ransomed','protocol-owner')$$,'owner activates protocol');
select lives_ok($$select public.activate_atlas_media_sync_protocol('youtube','personal','PL-test','00 — This Week','protocol-hash','{}'::jsonb,'ransomed','protocol-owner')$$,'activation replay is idempotent');
select is((select status from public.atlas_media_sync_protocols where protocol_hash='protocol-hash'),'active','protocol is active');

select lives_ok($$select public.record_atlas_media_input_review(date '2026-08-24','partial','{"youtube_history":"available","screen_time":"unavailable"}'::jsonb,'Planned inputs were bounded; source coverage was partial.','{"planned":6,"done":2}'::jsonb,'["product systems"]'::jsonb,'["late feed drift"]'::jsonb,'["keep one daily choice"]'::jsonb,'codex','review-1')$$,'weekly input review records');
select lives_ok($$select public.record_atlas_media_input_review(date '2026-08-24','partial','{}'::jsonb,'ignored','{}'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'codex','review-1')$$,'review replay is idempotent');
select is((select count(*) from public.atlas_media_input_reviews where week_start='2026-08-24'),1::bigint,'one review is stored');
select is((select summary from public.atlas_media_input_reviews where week_start='2026-08-24'),'Planned inputs were bounded; source coverage was partial.','review summary persists');
select throws_ok($$update public.atlas_media_input_reviews set summary='changed'$$,'55000','ATLAS_MEDIA_INPUT_REVIEW_IMMUTABLE','review cannot be updated');
select throws_ok($$delete from public.atlas_media_input_reviews$$,'55000','ATLAS_MEDIA_INPUT_REVIEW_IMMUTABLE','review cannot be deleted');
select throws_ok($$delete from public.atlas_media_sync_protocols$$,'55000','ATLAS_IMMUTABLE_HISTORY','protocol cannot be deleted');

select * from finish();
rollback;
