-- Linear parity slice 10: canonical Inbox notifications, preferences,
-- verified integration connections, signed webhook outbox, immutable delivery
-- attempts, and staged inbound receipts.
-- Forward-only. No historical activity is replayed and no destination is seeded.

create table if not exists public.atlas_notification_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  source_table text not null,
  source_event_id text not null,
  category text not null check (category in (
    'assignments','mentions','status_changes','comments','project_updates',
    'initiative_updates','cycles','documents','releases','analytics','workflows','system'
  )),
  resource_type text not null check (resource_type in (
    'action','project','initiative','cycle','document','template','comment',
    'reaction','release','insight','workflow','saved_view','system'
  )),
  resource_id text not null,
  event_action text not null check (event_action ~ '^[a-z][a-z0-9_]{0,63}$'),
  actor text not null,
  summary text not null,
  urgency text not null default 'normal' check (urgency in ('low','normal','high','urgent')),
  target_url text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  check (length(event_key) between 1 and 300),
  check (length(source_table) between 1 and 100),
  check (length(source_event_id) between 1 and 200),
  check (length(resource_id) between 1 and 200),
  check (length(actor) between 1 and 100),
  check (length(summary) between 1 and 1000),
  check (target_url ~ '^/[A-Za-z0-9_?&=/%.-]*$'),
  check (jsonb_typeof(payload) = 'object'),
  check (octet_length(payload::text) <= 32768)
);

create index if not exists atlas_notification_events_resource_idx
  on public.atlas_notification_events (resource_type, resource_id, created_at desc);
create index if not exists atlas_notification_events_category_idx
  on public.atlas_notification_events (category, created_at desc);

create table if not exists public.atlas_notification_preferences (
  id uuid primary key default gen_random_uuid(),
  principal_id text not null references public.atlas_members(id) on delete restrict,
  channel text not null check (channel in ('inbox','browser','email','slack','webhook')),
  category text not null check (category in (
    'all','assignments','mentions','status_changes','comments','project_updates',
    'initiative_updates','cycles','documents','releases','analytics','workflows','system'
  )),
  delivery_mode text not null default 'disabled' check (delivery_mode in ('immediate','digest','disabled')),
  digest_window_minutes integer check (digest_window_minutes is null or digest_window_minutes between 5 and 10080),
  revision bigint not null default 0 check (revision >= 0),
  updated_by text not null,
  updated_at timestamptz not null default timezone('utc', now()),
  unique (principal_id, channel, category),
  check (
    (delivery_mode = 'digest' and digest_window_minutes is not null)
    or (delivery_mode <> 'digest' and digest_window_minutes is null)
  )
);

create index if not exists atlas_notification_preferences_principal_idx
  on public.atlas_notification_preferences (principal_id, channel, category);

create table if not exists public.atlas_notification_subscriptions (
  id uuid primary key default gen_random_uuid(),
  principal_id text not null references public.atlas_members(id) on delete restrict,
  target_type text not null check (target_type in (
    'action','project','initiative','cycle','document','saved_view','workflow','workspace'
  )),
  target_id text not null,
  categories jsonb not null default '["all"]'::jsonb,
  channels jsonb not null default '["inbox"]'::jsonb,
  source text not null default 'manual' check (source in (
    'manual','creator','assignment','mention','comment','system'
  )),
  status text not null default 'active' check (status in ('active','muted','archived')),
  revision bigint not null default 0 check (revision >= 0),
  created_by text not null,
  updated_by text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (length(target_id) between 1 and 200),
  check (jsonb_typeof(categories) = 'array'),
  check (jsonb_typeof(channels) = 'array')
);

create unique index if not exists atlas_notification_subscriptions_active_idx
  on public.atlas_notification_subscriptions (principal_id, target_type, target_id)
  where status <> 'archived';
create index if not exists atlas_notification_subscriptions_target_idx
  on public.atlas_notification_subscriptions (target_type, target_id, status);

create table if not exists public.atlas_notifications (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.atlas_notification_events(id) on delete restrict,
  principal_id text not null references public.atlas_members(id) on delete restrict,
  delivery_reason text not null default 'preference' check (delivery_reason in (
    'preference','subscription','assignment','mention','creator','comment'
  )),
  status text not null default 'unread' check (status in ('unread','read','archived')),
  read_at timestamptz,
  archived_at timestamptz,
  revision bigint not null default 0 check (revision >= 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (event_id, principal_id),
  check ((status = 'read') = (read_at is not null) or status = 'archived'),
  check ((status = 'archived') = (archived_at is not null))
);

create index if not exists atlas_notifications_inbox_idx
  on public.atlas_notifications (principal_id, status, created_at desc);

create table if not exists public.atlas_integration_connections (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  provider text not null check (provider in ('webhook','slack','email','calendar','github','generic')),
  direction text not null default 'outbound' check (direction in ('inbound','outbound','bidirectional')),
  business text,
  endpoint_url text not null,
  endpoint_host text not null,
  endpoint_sha256 text not null check (endpoint_sha256 ~ '^[0-9a-f]{64}$'),
  secret_ref text,
  secret_fingerprint text,
  config jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft','pending_verification','active','paused','archived')),
  verified_at timestamptz,
  verification_expires_at timestamptz,
  verified_endpoint_sha256 text,
  verification_challenge_sha256 text,
  last_success_at timestamptz,
  consecutive_failures integer not null default 0 check (consecutive_failures between 0 and 1000000),
  paused_reason text not null default '',
  revision bigint not null default 0 check (revision >= 0),
  created_by text not null,
  updated_by text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  archived_at timestamptz,
  check (length(btrim(name)) between 1 and 120),
  check (endpoint_url ~ '^https://'),
  check (length(endpoint_url) <= 2048),
  check (length(endpoint_host) between 1 and 253),
  check (secret_ref is null or secret_ref ~ '^ATLAS_INTEGRATION_SECRET_[A-Z0-9_]{1,100}$'),
  check (secret_fingerprint is null or secret_fingerprint ~ '^[0-9a-f]{12}$'),
  check (jsonb_typeof(config) = 'object'),
  check (octet_length(config::text) <= 16384),
  check (status <> 'active' or (
    verified_at is not null and verification_expires_at is not null
    and verified_endpoint_sha256 = endpoint_sha256 and secret_fingerprint is not null
  ))
);

create unique index if not exists atlas_integration_connections_active_name_idx
  on public.atlas_integration_connections (lower(name))
  where archived_at is null;
create index if not exists atlas_integration_connections_status_idx
  on public.atlas_integration_connections (status, provider, business);

create table if not exists public.atlas_integration_subscriptions (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.atlas_integration_connections(id) on delete restrict,
  name text not null,
  categories jsonb not null default '["all"]'::jsonb,
  resource_types jsonb not null default '["all"]'::jsonb,
  event_actions jsonb not null default '["all"]'::jsonb,
  business text,
  project_id text references public.atlas_projects(id) on delete restrict,
  initiative_id text references public.atlas_initiatives(id) on delete restrict,
  saved_view_id text references public.atlas_saved_views(id) on delete restrict,
  delivery_mode text not null default 'immediate' check (delivery_mode in ('immediate','digest')),
  status text not null default 'paused' check (status in ('active','paused','archived')),
  revision bigint not null default 0 check (revision >= 0),
  created_by text not null,
  updated_by text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (length(btrim(name)) between 1 and 120),
  check (jsonb_typeof(categories) = 'array'),
  check (jsonb_typeof(resource_types) = 'array'),
  check (jsonb_typeof(event_actions) = 'array')
);

create unique index if not exists atlas_integration_subscriptions_active_name_idx
  on public.atlas_integration_subscriptions (connection_id, lower(name))
  where status <> 'archived';
create index if not exists atlas_integration_subscriptions_match_idx
  on public.atlas_integration_subscriptions (connection_id, status, business);
create index if not exists atlas_integration_subscriptions_project_idx
  on public.atlas_integration_subscriptions (project_id) where project_id is not null;
create index if not exists atlas_integration_subscriptions_initiative_idx
  on public.atlas_integration_subscriptions (initiative_id) where initiative_id is not null;
create index if not exists atlas_integration_subscriptions_view_idx
  on public.atlas_integration_subscriptions (saved_view_id) where saved_view_id is not null;

create table if not exists public.atlas_external_references (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.atlas_integration_connections(id) on delete restrict,
  provider_ref text not null,
  resource_type text not null check (resource_type in ('action','project','initiative','document','comment','release')),
  resource_id text not null,
  sync_mode text not null default 'link' check (sync_mode in ('link','thread','mirror')),
  external_url text,
  metadata jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active','archived')),
  revision bigint not null default 0 check (revision >= 0),
  created_by text not null,
  updated_by text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (length(provider_ref) between 1 and 500),
  check (length(resource_id) between 1 and 200),
  check (external_url is null or external_url ~ '^https://'),
  check (jsonb_typeof(metadata) = 'object'),
  check (octet_length(metadata::text) <= 16384)
);

create unique index if not exists atlas_external_references_provider_idx
  on public.atlas_external_references (connection_id, provider_ref)
  where status = 'active';
create index if not exists atlas_external_references_resource_idx
  on public.atlas_external_references (resource_type, resource_id, status);

create table if not exists public.atlas_outbox_deliveries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.atlas_notification_events(id) on delete restrict,
  subscription_id uuid not null references public.atlas_integration_subscriptions(id) on delete restrict,
  connection_id uuid not null references public.atlas_integration_connections(id) on delete restrict,
  delivery_key text not null unique,
  status text not null default 'pending' check (status in (
    'pending','delivering','retry_wait','delivered','dead_letter','skipped'
  )),
  attempt_count integer not null default 0 check (attempt_count between 0 and 4),
  next_attempt_at timestamptz not null default timezone('utc', now()),
  claimed_at timestamptz,
  claim_token text,
  delivered_at timestamptz,
  request_sha256 text,
  response_status integer,
  last_error text not null default '',
  revision bigint not null default 0 check (revision >= 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (event_id, subscription_id),
  check (length(delivery_key) between 1 and 300),
  check (claim_token is null or length(claim_token) between 16 and 200),
  check (request_sha256 is null or request_sha256 ~ '^[0-9a-f]{64}$'),
  check (response_status is null or response_status between 100 and 599),
  check (length(last_error) <= 1000)
);

create index if not exists atlas_outbox_deliveries_ready_idx
  on public.atlas_outbox_deliveries (status, next_attempt_at, created_at)
  where status in ('pending','retry_wait');
create index if not exists atlas_outbox_deliveries_connection_idx
  on public.atlas_outbox_deliveries (connection_id, status, created_at desc);

create table if not exists public.atlas_delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.atlas_outbox_deliveries(id) on delete restrict,
  attempt_number integer not null check (attempt_number between 1 and 4),
  request_sha256 text not null check (request_sha256 ~ '^[0-9a-f]{64}$'),
  endpoint_sha256 text not null check (endpoint_sha256 ~ '^[0-9a-f]{64}$'),
  signed_at timestamptz not null,
  duration_ms integer not null check (duration_ms between 0 and 300000),
  outcome text not null check (outcome in ('delivered','retry_wait','dead_letter','transport_error')),
  response_status integer,
  error_code text not null default '',
  next_attempt_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  unique (delivery_id, attempt_number),
  check (response_status is null or response_status between 100 and 599),
  check (length(error_code) <= 200)
);

create index if not exists atlas_delivery_attempts_delivery_idx
  on public.atlas_delivery_attempts (delivery_id, attempt_number);

create table if not exists public.atlas_inbound_events (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.atlas_integration_connections(id) on delete restrict,
  delivery_id text not null,
  event_type text not null,
  provider_timestamp timestamptz not null,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  payload jsonb not null,
  signature_verified boolean not null default true,
  status text not null default 'staged' check (status in ('staged','reviewed','ignored','rejected')),
  reviewed_by text,
  reviewed_at timestamptz,
  revision bigint not null default 0 check (revision >= 0),
  created_at timestamptz not null default timezone('utc', now()),
  unique (connection_id, delivery_id),
  check (length(delivery_id) between 1 and 300),
  check (length(event_type) between 1 and 100),
  check (jsonb_typeof(payload) = 'object'),
  check (octet_length(payload::text) <= 65536)
);

create index if not exists atlas_inbound_events_review_idx
  on public.atlas_inbound_events (connection_id, status, created_at desc);

create table if not exists public.atlas_integration_activity_log (
  id bigint generated by default as identity primary key,
  connection_id uuid references public.atlas_integration_connections(id) on delete restrict,
  entity_type text not null check (entity_type in (
    'connection','subscription','external_reference','delivery','attempt','inbound'
  )),
  entity_id text not null,
  event text not null,
  old_value jsonb,
  new_value jsonb,
  actor text not null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists atlas_integration_activity_connection_idx
  on public.atlas_integration_activity_log (connection_id, created_at desc);

insert into public.atlas_notification_preferences (
  principal_id, channel, category, delivery_mode, digest_window_minutes, updated_by
)
values
  ('ransomed','inbox','all','immediate',null,'codex'),
  ('ransomed','browser','all','disabled',null,'codex'),
  ('ransomed','email','all','disabled',null,'codex'),
  ('ransomed','slack','all','disabled',null,'codex'),
  ('ransomed','webhook','all','disabled',null,'codex')
on conflict (principal_id,channel,category) do nothing;

create or replace function public.emit_atlas_notification_event(
  p_event_key text,
  p_source_table text,
  p_source_event_id text,
  p_category text,
  p_resource_type text,
  p_resource_id text,
  p_event_action text,
  p_actor text,
  p_summary text,
  p_urgency text,
  p_target_url text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  event_row public.atlas_notification_events%rowtype;
  inserted boolean := false;
  server_timestamp timestamptz := timezone('utc', now());
begin
  insert into public.atlas_notification_events (
    event_key,source_table,source_event_id,category,resource_type,resource_id,
    event_action,actor,summary,urgency,target_url,payload,created_at
  ) values (
    p_event_key,p_source_table,p_source_event_id,p_category,p_resource_type,p_resource_id,
    p_event_action,p_actor,left(p_summary,1000),p_urgency,p_target_url,
    coalesce(p_payload,'{}'::jsonb),server_timestamp
  )
  on conflict (event_key) do nothing
  returning * into event_row;

  if found then
    inserted := true;
  else
    select * into event_row from public.atlas_notification_events where event_key=p_event_key;
  end if;
  if not inserted then return jsonb_build_object('event',to_jsonb(event_row),'replay',true); end if;

  insert into public.atlas_notifications (event_id,principal_id,delivery_reason,status,created_at,updated_at)
  select event_row.id,preference.principal_id,'preference','unread',server_timestamp,server_timestamp
    from public.atlas_notification_preferences preference
    join public.atlas_members member on member.id=preference.principal_id and member.is_active
   where preference.channel='inbox'
     and preference.delivery_mode<>'disabled'
     and preference.category in ('all',event_row.category)
     and not exists (
       select 1 from public.atlas_notification_subscriptions subscription
        where subscription.principal_id=preference.principal_id
          and subscription.target_type=event_row.resource_type
          and subscription.target_id=event_row.resource_id
          and subscription.status='muted'
     )
  on conflict (event_id,principal_id) do nothing;

  insert into public.atlas_notifications (event_id,principal_id,delivery_reason,status,created_at,updated_at)
  select event_row.id,subscription.principal_id,'subscription','unread',server_timestamp,server_timestamp
    from public.atlas_notification_subscriptions subscription
    join public.atlas_members member on member.id=subscription.principal_id and member.is_active
   where subscription.target_type=event_row.resource_type
     and subscription.target_id=event_row.resource_id
     and subscription.status='active'
     and (subscription.categories ? 'all' or subscription.categories ? event_row.category)
     and subscription.channels ? 'inbox'
  on conflict (event_id,principal_id) do nothing;

  insert into public.atlas_outbox_deliveries (
    event_id,subscription_id,connection_id,delivery_key,status,next_attempt_at,created_at,updated_at
  )
  select event_row.id,subscription.id,subscription.connection_id,
         event_row.event_key || ':' || subscription.id::text,
         'pending',server_timestamp,server_timestamp,server_timestamp
    from public.atlas_integration_subscriptions subscription
    join public.atlas_integration_connections connection on connection.id=subscription.connection_id
   where connection.status='active'
     and connection.direction in ('outbound','bidirectional')
     and subscription.status='active'
     and subscription.delivery_mode='immediate'
     and (subscription.categories ? 'all' or subscription.categories ? event_row.category)
     and (subscription.resource_types ? 'all' or subscription.resource_types ? event_row.resource_type)
     and (subscription.event_actions ? 'all' or subscription.event_actions ? event_row.event_action)
     and (subscription.business is null or subscription.business=event_row.payload->>'business')
     and (subscription.project_id is null or subscription.project_id=event_row.payload->>'project_id')
     and (subscription.initiative_id is null or subscription.initiative_id=event_row.payload->>'initiative_id')
     and (subscription.saved_view_id is null or subscription.saved_view_id=event_row.payload->>'saved_view_id')
  on conflict (event_id,subscription_id) do nothing;

  with ranked as (
    select notification.id,
           row_number() over(partition by notification.principal_id order by notification.created_at desc,notification.id desc) rank
      from public.atlas_notifications notification
     where notification.status in ('unread','read')
  )
  update public.atlas_notifications notification
     set status='archived',archived_at=server_timestamp,revision=revision+1,updated_at=server_timestamp
    from ranked
   where notification.id=ranked.id and ranked.rank>2000;

  return jsonb_build_object('event',to_jsonb(event_row),'replay',false);
end
$function$;

create or replace function public.atlas_activity_notification_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  row_json jsonb := to_jsonb(new);
  resource_type text;
  resource_id text;
  category text;
  action_name text;
  target_url text;
  urgency text := 'normal';
  payload jsonb;
begin
  if tg_table_name='atlas_activity_log' then
    resource_type:='action'; resource_id:=row_json->>'action_id';
    category:=case when new.event like '%assign%' then 'assignments' else 'status_changes' end;
  elsif tg_table_name='atlas_project_activity_log' then
    resource_type:='project'; resource_id:=row_json->>'project_id'; category:='project_updates';
  elsif tg_table_name='atlas_initiative_activity_log' then
    resource_type:='initiative'; resource_id:=row_json->>'initiative_id'; category:='initiative_updates';
  elsif tg_table_name='atlas_cycle_activity_log' then
    resource_type:='cycle'; resource_id:=coalesce(row_json->>'cycle_id',row_json->>'schedule_id'); category:='cycles';
  elsif tg_table_name='atlas_template_activity_log' then
    resource_type:='template'; resource_id:=row_json->>'template_id'; category:='documents';
  elsif tg_table_name='atlas_document_activity_log' then
    resource_type:='document'; resource_id:=row_json->>'document_id'; category:='documents';
  elsif tg_table_name='atlas_collaboration_activity_log' then
    resource_type:=case when row_json->>'entity_type'='comment' then 'comment' else coalesce(row_json->>'entity_type','comment') end;
    if resource_type not in ('action','project','initiative','document','comment','reaction') then resource_type:='comment'; end if;
    resource_id:=row_json->>'entity_id'; category:='comments';
  elsif tg_table_name='atlas_release_activity_log' then
    resource_type:='release'; resource_id:=row_json->>'entity_id'; category:='releases';
  elsif tg_table_name='atlas_analytics_activity_log' then
    resource_type:='insight'; resource_id:=row_json->>'entity_id'; category:='analytics';
  elsif tg_table_name='atlas_workflow_activity_log' then
    resource_type:='workflow'; resource_id:=row_json->>'workflow_id'; category:='workflows';
  else
    return new;
  end if;
  if resource_id is null or resource_id='' then return new; end if;

  action_name:=lower(regexp_replace(coalesce(row_json->>'event','updated'),'[^a-zA-Z0-9_]+','_','g'));
  if action_name like '%complet%' then action_name:='completed';
  elsif action_name like '%cancel%' or action_name like '%declin%' then action_name:='canceled';
  elsif action_name like '%archiv%' then action_name:='archived';
  elsif action_name like '%restor%' then action_name:='restored';
  elsif action_name like '%creat%' or action_name like '%post%' then action_name:='created';
  elsif action_name like '%assign%' then action_name:='assigned';
  elsif action_name like '%comment%' or category='comments' then action_name:='commented';
  else action_name:='updated'; end if;
  if action_name in ('completed','canceled','assigned') then urgency:='high'; end if;
  target_url:=case resource_type
    when 'action' then '/actions/'||resource_id
    when 'project' then '/projects/'||resource_id
    when 'initiative' then '/initiatives/'||resource_id
    when 'cycle' then '/cycles/'||resource_id
    when 'document' then '/documents/'||resource_id
    when 'template' then '/templates'
    when 'release' then '/releases'
    when 'insight' then '/insights/'||resource_id
    when 'workflow' then '/workflows'
    else '/notifications'
  end;
  if target_url !~ '^/[A-Za-z0-9_?&=/%.-]*$' then target_url:='/notifications'; end if;
  payload:=jsonb_strip_nulls(jsonb_build_object(
    'event',row_json->>'event',
    'old_excerpt',left(coalesce(row_json->>'old_value',''),8000),
    'new_excerpt',left(coalesce(row_json->>'new_value',''),12000),
    'business',coalesce(row_json->'new_value'->>'business',row_json->'old_value'->>'business'),
    'project_id',coalesce(row_json->'new_value'->>'project_id',case when resource_type='project' then resource_id end),
    'initiative_id',case when resource_type='initiative' then resource_id end
  ));
  perform public.emit_atlas_notification_event(
    tg_table_name||':'||(row_json->>'id'),tg_table_name,row_json->>'id',category,
    resource_type,resource_id,action_name,coalesce(row_json->>'actor','system'),
    initcap(replace(resource_type,'_',' '))||' '||replace(coalesce(row_json->>'event','updated'),'_',' '),
    urgency,target_url,payload
  );
  return new;
end
$function$;

do $migration$
declare table_name text;
begin
  foreach table_name in array array[
    'atlas_activity_log','atlas_project_activity_log','atlas_initiative_activity_log',
    'atlas_cycle_activity_log','atlas_template_activity_log','atlas_document_activity_log',
    'atlas_collaboration_activity_log','atlas_release_activity_log',
    'atlas_analytics_activity_log','atlas_workflow_activity_log'
  ] loop
    if to_regclass('public.'||table_name) is not null then
      execute format('drop trigger if exists %I on public.%I',table_name||'_notify',table_name);
      execute format('create trigger %I after insert on public.%I for each row execute function public.atlas_activity_notification_trigger()',table_name||'_notify',table_name);
    end if;
  end loop;
end
$migration$;

create or replace function public.atlas_sync_action_notification_subscriptions()
returns trigger language plpgsql security definer set search_path='' as $function$
declare principal text;
begin
  for principal in select value from jsonb_array_elements_text(coalesce(new.owners,'[]'::jsonb)) owner(value) loop
    if exists(select 1 from public.atlas_members member where member.id=principal and member.is_active) then
      insert into public.atlas_notification_subscriptions(
        principal_id,target_type,target_id,categories,channels,source,status,created_by,updated_by
      ) values(principal,'action',new.id,'["all"]'::jsonb,'["inbox"]'::jsonb,'assignment','active','system','system')
      on conflict(principal_id,target_type,target_id) where status<>'archived' do update
      set source=case when public.atlas_notification_subscriptions.source='manual' then 'manual' else 'assignment' end,
          updated_by='system',updated_at=timezone('utc',now());
    end if;
  end loop;
  return new;
end $function$;

create or replace function public.atlas_sync_discussion_notification_subscription()
returns trigger language plpgsql security definer set search_path='' as $function$
declare mapped_type text; mapped_id text;
begin
  mapped_type:=case when new.target_type in ('action','project','initiative','document') then new.target_type else 'workspace' end;
  mapped_id:=case when mapped_type='workspace' then new.target_type||':'||new.target_id else new.target_id end;
  insert into public.atlas_notification_subscriptions(
    principal_id,target_type,target_id,categories,channels,source,status,created_by,updated_by
  ) values(new.principal_id,mapped_type,mapped_id,'["comments"]'::jsonb,'["inbox"]'::jsonb,'comment',
    case when new.status='active' then 'active' else 'muted' end,'system','system')
  on conflict(principal_id,target_type,target_id) where status<>'archived' do update
  set status=case when public.atlas_notification_subscriptions.source='manual' and public.atlas_notification_subscriptions.status='muted' then 'muted' when new.status='active' then 'active' else 'muted' end,
      source=case when public.atlas_notification_subscriptions.source='manual' then 'manual' else 'comment' end,
      updated_by='system',updated_at=timezone('utc',now());
  return new;
end $function$;

drop trigger if exists atlas_actions_sync_notification_subscriptions on public.atlas_actions;
create trigger atlas_actions_sync_notification_subscriptions
after insert or update of owners on public.atlas_actions
for each row execute function public.atlas_sync_action_notification_subscriptions();

drop trigger if exists atlas_discussion_sync_notification_subscription on public.atlas_discussion_subscriptions;
create trigger atlas_discussion_sync_notification_subscription
after insert or update of status on public.atlas_discussion_subscriptions
for each row execute function public.atlas_sync_discussion_notification_subscription();

create or replace function public.transition_atlas_notification(
  p_notification_id uuid,
  p_status text,
  p_actor text,
  p_expected_revision bigint default null
)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare row_value public.atlas_notifications%rowtype; server_timestamp timestamptz:=timezone('utc',now());
begin
  if p_actor<>'ransomed' then raise exception using errcode='42501',message='ATLAS_NOTIFICATION_OWNER_REQUIRED'; end if;
  if p_status not in ('unread','read','archived') then raise exception using errcode='22023',message='ATLAS_NOTIFICATION_STATUS_INVALID'; end if;
  select * into row_value from public.atlas_notifications where id=p_notification_id and principal_id=p_actor for update;
  if not found then raise exception using errcode='P0002',message='ATLAS_NOTIFICATION_NOT_FOUND'; end if;
  if p_expected_revision is not null and row_value.revision<>p_expected_revision then raise exception using errcode='40001',message='ATLAS_REVISION_CONFLICT'; end if;
  update public.atlas_notifications set status=p_status,
    read_at=case when p_status='read' then server_timestamp when p_status='unread' then null else read_at end,
    archived_at=case when p_status='archived' then server_timestamp else null end,
    revision=revision+1,updated_at=server_timestamp where id=p_notification_id returning * into row_value;
  return to_jsonb(row_value);
end $function$;

create or replace function public.transition_all_atlas_notifications(
  p_status text,p_actor text
)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare changed integer; server_timestamp timestamptz:=timezone('utc',now());
begin
  if p_actor<>'ransomed' then raise exception using errcode='42501',message='ATLAS_NOTIFICATION_OWNER_REQUIRED'; end if;
  if p_status not in ('read','archived') then raise exception using errcode='22023',message='ATLAS_NOTIFICATION_STATUS_INVALID'; end if;
  update public.atlas_notifications set status=p_status,
    read_at=case when p_status='read' then server_timestamp else read_at end,
    archived_at=case when p_status='archived' then server_timestamp else null end,
    revision=revision+1,updated_at=server_timestamp
  where principal_id=p_actor and status<>p_status and status<>'archived';
  get diagnostics changed=row_count;
  return jsonb_build_object('updated',changed,'status',p_status);
end $function$;

create or replace function public.upsert_atlas_notification_preference(
  p_principal_id text,p_channel text,p_category text,p_delivery_mode text,
  p_digest_window_minutes integer,p_actor text,p_expected_revision bigint default null
)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare row_value public.atlas_notification_preferences%rowtype; server_timestamp timestamptz:=timezone('utc',now());
begin
  if p_actor<>'ransomed' or p_principal_id<>p_actor then raise exception using errcode='42501',message='ATLAS_NOTIFICATION_OWNER_REQUIRED'; end if;
  select * into row_value from public.atlas_notification_preferences where principal_id=p_principal_id and channel=p_channel and category=p_category for update;
  if found and p_expected_revision is not null and row_value.revision<>p_expected_revision then raise exception using errcode='40001',message='ATLAS_REVISION_CONFLICT'; end if;
  insert into public.atlas_notification_preferences(principal_id,channel,category,delivery_mode,digest_window_minutes,revision,updated_by,updated_at)
  values(p_principal_id,p_channel,p_category,p_delivery_mode,p_digest_window_minutes,0,p_actor,server_timestamp)
  on conflict(principal_id,channel,category) do update set delivery_mode=excluded.delivery_mode,digest_window_minutes=excluded.digest_window_minutes,
    revision=public.atlas_notification_preferences.revision+1,updated_by=p_actor,updated_at=server_timestamp
  returning * into row_value;
  return to_jsonb(row_value);
end $function$;

create or replace function public.record_atlas_connection_verification(
  p_connection_id uuid,p_endpoint_sha256 text,p_challenge_sha256 text,
  p_secret_fingerprint text,p_actor text,p_expected_revision bigint default null
)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare row_value public.atlas_integration_connections%rowtype; old_value jsonb; server_timestamp timestamptz:=timezone('utc',now());
begin
  if p_actor<>'ransomed' then raise exception using errcode='42501',message='ATLAS_INTEGRATION_OWNER_REQUIRED'; end if;
  select * into row_value from public.atlas_integration_connections where id=p_connection_id and archived_at is null for update;
  if not found then raise exception using errcode='P0002',message='ATLAS_CONNECTION_NOT_FOUND'; end if;
  if p_expected_revision is not null and row_value.revision<>p_expected_revision then raise exception using errcode='40001',message='ATLAS_REVISION_CONFLICT'; end if;
  if row_value.endpoint_sha256<>p_endpoint_sha256 then raise exception using errcode='23514',message='ATLAS_CONNECTION_ENDPOINT_CHANGED'; end if;
  old_value:=to_jsonb(row_value);
  update public.atlas_integration_connections set status='pending_verification',verified_at=server_timestamp,
    verification_expires_at=server_timestamp+interval '24 hours',verified_endpoint_sha256=p_endpoint_sha256,
    verification_challenge_sha256=p_challenge_sha256,secret_fingerprint=p_secret_fingerprint,
    paused_reason='',revision=revision+1,updated_by=p_actor,updated_at=server_timestamp
  where id=p_connection_id returning * into row_value;
  insert into public.atlas_integration_activity_log(connection_id,entity_type,entity_id,event,old_value,new_value,actor)
  values(row_value.id,'connection',row_value.id::text,'verified',old_value,to_jsonb(row_value),p_actor);
  return to_jsonb(row_value);
end $function$;

create or replace function public.transition_atlas_integration_connection(
  p_connection_id uuid,p_action text,p_actor text,p_expected_revision bigint default null
)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare row_value public.atlas_integration_connections%rowtype; old_value jsonb; server_timestamp timestamptz:=timezone('utc',now());
begin
  if p_actor<>'ransomed' then raise exception using errcode='42501',message='ATLAS_INTEGRATION_OWNER_REQUIRED'; end if;
  if p_action not in ('activate','pause','resume','archive') then raise exception using errcode='22023',message='ATLAS_CONNECTION_ACTION_INVALID'; end if;
  select * into row_value from public.atlas_integration_connections where id=p_connection_id for update;
  if not found then raise exception using errcode='P0002',message='ATLAS_CONNECTION_NOT_FOUND'; end if;
  if p_expected_revision is not null and row_value.revision<>p_expected_revision then raise exception using errcode='40001',message='ATLAS_REVISION_CONFLICT'; end if;
  old_value:=to_jsonb(row_value);
  if p_action in ('activate','resume') then
    if row_value.verified_at is null or row_value.verification_expires_at<=server_timestamp
       or row_value.verified_endpoint_sha256<>row_value.endpoint_sha256 or row_value.secret_fingerprint is null then
      raise exception using errcode='55000',message='ATLAS_CONNECTION_VERIFICATION_REQUIRED';
    end if;
    update public.atlas_integration_connections set status='active',paused_reason='',archived_at=null,
      revision=revision+1,updated_by=p_actor,updated_at=server_timestamp where id=p_connection_id returning * into row_value;
  elsif p_action='pause' then
    update public.atlas_integration_connections set status='paused',paused_reason='owner_paused',
      revision=revision+1,updated_by=p_actor,updated_at=server_timestamp where id=p_connection_id returning * into row_value;
  else
    update public.atlas_integration_connections set status='archived',archived_at=server_timestamp,paused_reason='archived',
      revision=revision+1,updated_by=p_actor,updated_at=server_timestamp where id=p_connection_id returning * into row_value;
    update public.atlas_integration_subscriptions set status='archived',revision=revision+1,updated_by=p_actor,updated_at=server_timestamp
      where connection_id=p_connection_id and status<>'archived';
  end if;
  insert into public.atlas_integration_activity_log(connection_id,entity_type,entity_id,event,old_value,new_value,actor)
  values(row_value.id,'connection',row_value.id::text,p_action,old_value,to_jsonb(row_value),p_actor);
  return to_jsonb(row_value);
end $function$;

create or replace function public.claim_atlas_delivery(
  p_delivery_id uuid,p_claim_token text,p_actor text
)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare row_value public.atlas_outbox_deliveries%rowtype; connection_status text; server_timestamp timestamptz:=timezone('utc',now());
begin
  if p_actor not in ('ransomed','codex','claude','delivery_worker') then raise exception using errcode='22023',message='ATLAS_ACTOR_NOT_ALLOWED'; end if;
  if length(p_claim_token)<16 then raise exception using errcode='22023',message='ATLAS_DELIVERY_CLAIM_INVALID'; end if;
  select * into row_value from public.atlas_outbox_deliveries where id=p_delivery_id for update skip locked;
  if not found then raise exception using errcode='P0002',message='ATLAS_DELIVERY_NOT_FOUND'; end if;
  select status into connection_status from public.atlas_integration_connections where id=row_value.connection_id;
  if connection_status<>'active' then raise exception using errcode='55000',message='ATLAS_CONNECTION_NOT_ACTIVE'; end if;
  if row_value.status not in ('pending','retry_wait') or row_value.next_attempt_at>server_timestamp then
    raise exception using errcode='55000',message='ATLAS_DELIVERY_NOT_READY';
  end if;
  update public.atlas_outbox_deliveries set status='delivering',attempt_count=attempt_count+1,
    claimed_at=server_timestamp,claim_token=p_claim_token,revision=revision+1,updated_at=server_timestamp
    where id=p_delivery_id returning * into row_value;
  return to_jsonb(row_value);
end $function$;

create or replace function public.complete_atlas_delivery_attempt(
  p_delivery_id uuid,p_claim_token text,p_success boolean,p_response_status integer,
  p_request_sha256 text,p_endpoint_sha256 text,p_duration_ms integer,p_error_code text,p_actor text
)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare row_value public.atlas_outbox_deliveries%rowtype; connection_row public.atlas_integration_connections%rowtype;
  next_time timestamptz; next_status text; outcome_value text; server_timestamp timestamptz:=timezone('utc',now());
begin
  if p_actor not in ('ransomed','codex','claude','delivery_worker') then raise exception using errcode='22023',message='ATLAS_ACTOR_NOT_ALLOWED'; end if;
  select * into row_value from public.atlas_outbox_deliveries where id=p_delivery_id for update;
  if not found then raise exception using errcode='P0002',message='ATLAS_DELIVERY_NOT_FOUND'; end if;
  if row_value.status<>'delivering' or row_value.claim_token<>p_claim_token then raise exception using errcode='55000',message='ATLAS_DELIVERY_CLAIM_MISMATCH'; end if;
  select * into connection_row from public.atlas_integration_connections where id=row_value.connection_id for update;
  if p_success and p_response_status=200 then
    next_status:='delivered'; outcome_value:='delivered'; next_time:=null;
    update public.atlas_integration_connections set last_success_at=server_timestamp,consecutive_failures=0,
      revision=revision+1,updated_at=server_timestamp where id=connection_row.id;
  elsif row_value.attempt_count<4 then
    next_status:='retry_wait'; outcome_value:=case when p_response_status is null then 'transport_error' else 'retry_wait' end;
    next_time:=server_timestamp+case row_value.attempt_count when 1 then interval '1 minute' when 2 then interval '1 hour' else interval '6 hours' end;
    update public.atlas_integration_connections set consecutive_failures=consecutive_failures+1,
      revision=revision+1,updated_at=server_timestamp where id=connection_row.id;
  else
    next_status:='dead_letter'; outcome_value:='dead_letter'; next_time:=null;
    update public.atlas_integration_connections set status='paused',paused_reason='delivery_dead_letter',
      consecutive_failures=consecutive_failures+1,revision=revision+1,updated_at=server_timestamp where id=connection_row.id;
  end if;
  update public.atlas_outbox_deliveries set status=next_status,next_attempt_at=coalesce(next_time,next_attempt_at),
    claim_token=null,claimed_at=null,delivered_at=case when next_status='delivered' then server_timestamp else null end,
    request_sha256=p_request_sha256,response_status=p_response_status,last_error=left(coalesce(p_error_code,''),1000),
    revision=revision+1,updated_at=server_timestamp where id=p_delivery_id returning * into row_value;
  insert into public.atlas_delivery_attempts(delivery_id,attempt_number,request_sha256,endpoint_sha256,signed_at,duration_ms,outcome,response_status,error_code,next_attempt_at,created_at)
  values(p_delivery_id,row_value.attempt_count,p_request_sha256,p_endpoint_sha256,server_timestamp,p_duration_ms,outcome_value,p_response_status,left(coalesce(p_error_code,''),200),next_time,server_timestamp);
  insert into public.atlas_integration_activity_log(connection_id,entity_type,entity_id,event,new_value,actor)
  values(row_value.connection_id,'attempt',p_delivery_id::text,outcome_value,to_jsonb(row_value),p_actor);
  return to_jsonb(row_value);
end $function$;

create or replace function public.record_atlas_inbound_event(
  p_connection_id uuid,p_delivery_id text,p_event_type text,p_provider_timestamp timestamptz,
  p_content_sha256 text,p_payload jsonb,p_actor text
)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare row_value public.atlas_inbound_events%rowtype; replay boolean:=false;
begin
  if p_actor<>'integration_hook' then raise exception using errcode='42501',message='ATLAS_INBOUND_HOOK_REQUIRED'; end if;
  if not exists(select 1 from public.atlas_integration_connections where id=p_connection_id and status='active' and direction in ('inbound','bidirectional')) then
    raise exception using errcode='55000',message='ATLAS_INBOUND_CONNECTION_NOT_ACTIVE';
  end if;
  insert into public.atlas_inbound_events(connection_id,delivery_id,event_type,provider_timestamp,content_sha256,payload,signature_verified,status)
  values(p_connection_id,p_delivery_id,p_event_type,p_provider_timestamp,p_content_sha256,p_payload,true,'staged')
  on conflict(connection_id,delivery_id) do nothing returning * into row_value;
  if not found then select * into row_value from public.atlas_inbound_events where connection_id=p_connection_id and delivery_id=p_delivery_id; replay:=true; end if;
  if not replay then insert into public.atlas_integration_activity_log(connection_id,entity_type,entity_id,event,new_value,actor)
    values(p_connection_id,'inbound',row_value.id::text,'staged',jsonb_build_object('delivery_id',p_delivery_id,'content_sha256',p_content_sha256),p_actor); end if;
  return jsonb_build_object('inbound',to_jsonb(row_value),'replay',replay);
end $function$;

create or replace function public.transition_atlas_inbound_event(
  p_event_id uuid,p_status text,p_actor text,p_expected_revision bigint default null
)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare row_value public.atlas_inbound_events%rowtype; server_timestamp timestamptz:=timezone('utc',now());
begin
  if p_actor<>'ransomed' then raise exception using errcode='42501',message='ATLAS_INTEGRATION_OWNER_REQUIRED'; end if;
  if p_status not in ('reviewed','ignored','rejected') then raise exception using errcode='22023',message='ATLAS_INBOUND_STATUS_INVALID'; end if;
  select * into row_value from public.atlas_inbound_events where id=p_event_id for update;
  if not found then raise exception using errcode='P0002',message='ATLAS_INBOUND_EVENT_NOT_FOUND'; end if;
  if p_expected_revision is not null and row_value.revision<>p_expected_revision then raise exception using errcode='40001',message='ATLAS_REVISION_CONFLICT'; end if;
  update public.atlas_inbound_events set status=p_status,reviewed_by=p_actor,reviewed_at=server_timestamp,
    revision=revision+1 where id=p_event_id returning * into row_value;
  insert into public.atlas_integration_activity_log(connection_id,entity_type,entity_id,event,new_value,actor)
  values(row_value.connection_id,'inbound',row_value.id::text,p_status,to_jsonb(row_value),p_actor);
  return to_jsonb(row_value);
end $function$;

create or replace function public.atlas_reject_integration_history_mutation()
returns trigger language plpgsql set search_path='' as $function$
begin raise exception using errcode='55000',message='ATLAS_INTEGRATION_HISTORY_IMMUTABLE'; end $function$;

create or replace function public.atlas_reject_integration_delete()
returns trigger language plpgsql set search_path='' as $function$
begin raise exception using errcode='55000',message='ATLAS_INTEGRATION_DELETE_FORBIDDEN'; end $function$;

do $migration$
declare table_name text;
begin
  foreach table_name in array array['atlas_notification_events','atlas_delivery_attempts','atlas_integration_activity_log'] loop
    execute format('drop trigger if exists %I on public.%I',table_name||'_immutable',table_name);
    execute format('create trigger %I before update or delete on public.%I for each row execute function public.atlas_reject_integration_history_mutation()',table_name||'_immutable',table_name);
  end loop;
  foreach table_name in array array[
    'atlas_notification_preferences','atlas_notification_subscriptions','atlas_notifications',
    'atlas_integration_connections','atlas_integration_subscriptions','atlas_external_references',
    'atlas_outbox_deliveries','atlas_inbound_events'
  ] loop
    execute format('drop trigger if exists %I on public.%I',table_name||'_no_delete',table_name);
    execute format('create trigger %I before delete on public.%I for each row execute function public.atlas_reject_integration_delete()',table_name||'_no_delete',table_name);
  end loop;
end
$migration$;

do $migration$
declare table_name text; role_name text;
begin
  foreach table_name in array array[
    'atlas_notification_events','atlas_notification_preferences','atlas_notification_subscriptions',
    'atlas_notifications','atlas_integration_connections','atlas_integration_subscriptions',
    'atlas_external_references','atlas_outbox_deliveries','atlas_delivery_attempts',
    'atlas_inbound_events','atlas_integration_activity_log'
  ] loop
    execute format('alter table public.%I enable row level security',table_name);
    execute format('revoke all on table public.%I from public',table_name);
    foreach role_name in array array['anon','authenticated'] loop
      if exists(select 1 from pg_roles where rolname=role_name) then execute format('revoke all on table public.%I from %I',table_name,role_name); end if;
    end loop;
    if exists(select 1 from pg_roles where rolname='service_role') then
      execute format('revoke all on table public.%I from service_role',table_name);
      if table_name in ('atlas_notification_events','atlas_delivery_attempts','atlas_integration_activity_log') then
        execute format('grant select,insert on table public.%I to service_role',table_name);
      else
        execute format('grant select,insert,update on table public.%I to service_role',table_name);
      end if;
    end if;
  end loop;
  if exists(select 1 from pg_roles where rolname='service_role') then
    grant usage,select on sequence public.atlas_integration_activity_log_id_seq to service_role;
  end if;
end
$migration$;

revoke all on function public.emit_atlas_notification_event(text,text,text,text,text,text,text,text,text,text,text,jsonb) from public;
revoke all on function public.atlas_activity_notification_trigger() from public;
revoke all on function public.atlas_sync_action_notification_subscriptions() from public;
revoke all on function public.atlas_sync_discussion_notification_subscription() from public;
revoke all on function public.transition_atlas_notification(uuid,text,text,bigint) from public;
revoke all on function public.transition_all_atlas_notifications(text,text) from public;
revoke all on function public.upsert_atlas_notification_preference(text,text,text,text,integer,text,bigint) from public;
revoke all on function public.record_atlas_connection_verification(uuid,text,text,text,text,bigint) from public;
revoke all on function public.transition_atlas_integration_connection(uuid,text,text,bigint) from public;
revoke all on function public.claim_atlas_delivery(uuid,text,text) from public;
revoke all on function public.complete_atlas_delivery_attempt(uuid,text,boolean,integer,text,text,integer,text,text) from public;
revoke all on function public.record_atlas_inbound_event(uuid,text,text,timestamptz,text,jsonb,text) from public;
revoke all on function public.transition_atlas_inbound_event(uuid,text,text,bigint) from public;
revoke all on function public.atlas_reject_integration_history_mutation() from public;
revoke all on function public.atlas_reject_integration_delete() from public;

do $migration$
declare function_signature text; role_name text;
begin
  foreach function_signature in array array[
    'public.emit_atlas_notification_event(text,text,text,text,text,text,text,text,text,text,text,jsonb)',
    'public.transition_atlas_notification(uuid,text,text,bigint)',
    'public.transition_all_atlas_notifications(text,text)',
    'public.upsert_atlas_notification_preference(text,text,text,text,integer,text,bigint)',
    'public.record_atlas_connection_verification(uuid,text,text,text,text,bigint)',
    'public.transition_atlas_integration_connection(uuid,text,text,bigint)',
    'public.claim_atlas_delivery(uuid,text,text)',
    'public.complete_atlas_delivery_attempt(uuid,text,boolean,integer,text,text,integer,text,text)',
    'public.record_atlas_inbound_event(uuid,text,text,timestamptz,text,jsonb,text)',
    'public.transition_atlas_inbound_event(uuid,text,text,bigint)'
  ] loop
    foreach role_name in array array['anon','authenticated'] loop
      if exists(select 1 from pg_roles where rolname=role_name) then execute format('revoke execute on function %s from %I',function_signature,role_name); end if;
    end loop;
    if exists(select 1 from pg_roles where rolname='service_role') then execute format('grant execute on function %s to service_role',function_signature); end if;
  end loop;
end
$migration$;

comment on table public.atlas_notification_events is 'Canonical future-only Atlas activity events for Inbox and integration fan-out.';
comment on table public.atlas_integration_connections is 'Owner-verified integration destinations containing no raw provider credential.';
comment on table public.atlas_outbox_deliveries is 'Idempotent signed webhook delivery queue with bounded retry state.';
comment on table public.atlas_inbound_events is 'HMAC-verified idempotent inbound payloads staged without automatic Atlas mutation.';
