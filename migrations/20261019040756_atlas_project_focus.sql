-- PROPOSAL ONLY: pending owner approval of this exact reviewed SQL.
-- Do not apply to production as part of code implementation/deployment.
-- Additive objects only. No existing Atlas rows, privileges, policies or credentials change.
-- Prerequisites: public.atlas_projects(id text PK, name text, business text, status text);
-- existing role service_role with its existing BYPASSRLS attribute (as in Supabase).
-- The snapshot SELECT ... FOR SHARE also requires existing SELECT + UPDATE on atlas_projects.
-- The hosted Worker role already has those privileges; do NOT add/expand project grants here.
-- Local tests may provide that minimal projects table and role. This proposal never creates roles.
-- All functions are SECURITY INVOKER. RLS has no browser policies. Grants below affect NEW objects only.
BEGIN;

CREATE FUNCTION public.atlas_focus_valid_settings(p_settings jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE k text; n numeric;
BEGIN
  IF p_settings IS NULL OR jsonb_typeof(p_settings) <> 'object'
     OR NOT p_settings ?& ARRAY['focus_minutes','short_break_minutes','long_break_minutes','chime_enabled']
     OR p_settings - ARRAY['focus_minutes','short_break_minutes','long_break_minutes','chime_enabled'] <> '{}'::jsonb
     OR jsonb_typeof(p_settings->'chime_enabled') <> 'boolean' THEN RETURN false; END IF;
  FOREACH k IN ARRAY ARRAY['focus_minutes','short_break_minutes','long_break_minutes'] LOOP
    IF jsonb_typeof(p_settings->k) <> 'number' THEN RETURN false; END IF;
    n := (p_settings->>k)::numeric;
    IF n <> trunc(n) OR n < 1 OR n > (CASE k WHEN 'focus_minutes' THEN 180 WHEN 'short_break_minutes' THEN 60 ELSE 120 END) THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END $$;

CREATE TABLE public.atlas_focus_state (
  owner_id text PRIMARY KEY CHECK (owner_id = 'ransomed'),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision BETWEEN 0 AND 9007199254740991),
  settings jsonb NOT NULL DEFAULT '{"focus_minutes":25,"short_break_minutes":5,"long_break_minutes":15,"chime_enabled":false}'::jsonb
    CHECK (public.atlas_focus_valid_settings(settings)),
  phase text NOT NULL DEFAULT 'focus' CHECK (phase IN ('focus','short_break','long_break')),
  status text NOT NULL DEFAULT 'ready' CHECK (status IN ('ready','running','paused')),
  session_id uuid,
  project_id text REFERENCES public.atlas_projects(id) ON DELETE RESTRICT,
  project_name text,
  business text,
  started_at timestamptz,
  duration_ms bigint CHECK (duration_ms BETWEEN 60000 AND 10800000),
  elapsed_ms bigint NOT NULL DEFAULT 0 CHECK (elapsed_ms >= 0),
  remaining_ms bigint,
  running_since timestamptz,
  deadline_at timestamptz,
  completed_focus_count bigint NOT NULL DEFAULT 0 CHECK (completed_focus_count BETWEEN 0 AND 9007199254740991),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (project_id IS NULL OR project_name IS NOT NULL),
  CHECK (status = 'ready' OR phase <> 'focus' OR project_id IS NOT NULL),
  CHECK (
    (status = 'ready' AND session_id IS NULL AND started_at IS NULL AND duration_ms IS NULL
      AND elapsed_ms = 0 AND remaining_ms IS NULL AND running_since IS NULL AND deadline_at IS NULL)
    OR
    (status IN ('running','paused') AND session_id IS NOT NULL AND started_at IS NOT NULL
      AND duration_ms IS NOT NULL AND elapsed_ms < duration_ms
      AND remaining_ms = duration_ms - elapsed_ms AND remaining_ms > 0
      AND ((status = 'running' AND running_since IS NOT NULL AND deadline_at IS NOT NULL AND deadline_at >= running_since)
        OR (status = 'paused' AND running_since IS NULL AND deadline_at IS NULL)))
  )
);

CREATE TABLE public.atlas_focus_sessions (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL REFERENCES public.atlas_focus_state(owner_id) ON DELETE RESTRICT CHECK (owner_id = 'ransomed'),
  project_id text REFERENCES public.atlas_projects(id) ON DELETE RESTRICT,
  project_name text,
  business text,
  phase text NOT NULL CHECK (phase IN ('focus','short_break','long_break')),
  outcome text NOT NULL CHECK (outcome IN ('completed','reset','skipped')),
  duration_ms bigint NOT NULL CHECK (duration_ms BETWEEN 60000 AND 10800000),
  focused_ms bigint NOT NULL CHECK (focused_ms >= 0 AND focused_ms <= duration_ms),
  started_at timestamptz NOT NULL,
  ended_at timestamptz NOT NULL CHECK (ended_at >= started_at),
  CHECK (phase <> 'focus' OR project_id IS NOT NULL),
  CHECK (project_id IS NULL OR project_name IS NOT NULL),
  CHECK (outcome <> 'completed' OR focused_ms = duration_ms)
);
CREATE INDEX atlas_focus_sessions_history ON public.atlas_focus_sessions(owner_id, ended_at DESC, id DESC);
CREATE INDEX atlas_focus_sessions_project_history ON public.atlas_focus_sessions(owner_id, project_id, ended_at DESC, id DESC);
CREATE INDEX atlas_focus_sessions_totals ON public.atlas_focus_sessions(owner_id, project_id)
  INCLUDE (focused_ms) WHERE phase = 'focus' AND outcome = 'completed';

CREATE TABLE public.atlas_focus_operations (
  owner_id text NOT NULL REFERENCES public.atlas_focus_state(owner_id) ON DELETE RESTRICT CHECK (owner_id = 'ransomed'),
  operation_id uuid NOT NULL,
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  request jsonb NOT NULL CHECK (jsonb_typeof(request) = 'object'),
  result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (owner_id, operation_id)
);

-- Ledger and receipts are append-only, including for the Worker service role.
CREATE FUNCTION public.atlas_focus_reject_history_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'FOCUS_HISTORY_IMMUTABLE'; END $$;
CREATE TRIGGER atlas_focus_sessions_immutable BEFORE UPDATE OR DELETE ON public.atlas_focus_sessions
  FOR EACH ROW EXECUTE FUNCTION public.atlas_focus_reject_history_mutation();
CREATE TRIGGER atlas_focus_sessions_no_truncate BEFORE TRUNCATE ON public.atlas_focus_sessions
  FOR EACH STATEMENT EXECUTE FUNCTION public.atlas_focus_reject_history_mutation();
CREATE TRIGGER atlas_focus_operations_immutable BEFORE UPDATE OR DELETE ON public.atlas_focus_operations
  FOR EACH ROW EXECUTE FUNCTION public.atlas_focus_reject_history_mutation();
CREATE TRIGGER atlas_focus_operations_no_truncate BEFORE TRUNCATE ON public.atlas_focus_operations
  FOR EACH STATEMENT EXECUTE FUNCTION public.atlas_focus_reject_history_mutation();

CREATE FUNCTION public.atlas_focus_duration_ms(p_settings jsonb, p_phase text)
RETURNS bigint LANGUAGE sql IMMUTABLE STRICT SECURITY INVOKER SET search_path = '' AS $$
  SELECT (p_settings->>CASE p_phase WHEN 'focus' THEN 'focus_minutes' WHEN 'short_break' THEN 'short_break_minutes' ELSE 'long_break_minutes' END)::bigint * 60000
$$;

CREATE FUNCTION public.atlas_focus_state_json(p_state public.atlas_focus_state, p_now timestamptz)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' SET timezone = 'UTC' AS $$
  SELECT jsonb_build_object(
    'server_now', p_now, 'revision', p_state.revision, 'settings', p_state.settings,
    'phase', p_state.phase, 'status', p_state.status,
    'session', CASE WHEN p_state.session_id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', p_state.session_id, 'project_id', p_state.project_id, 'project_name', p_state.project_name,
      'business', p_state.business, 'started_at', p_state.started_at, 'duration_ms', p_state.duration_ms) END,
    'deadline_at', p_state.deadline_at,
    'remaining_ms', CASE p_state.status WHEN 'ready' THEN public.atlas_focus_duration_ms(p_state.settings, p_state.phase)
      WHEN 'paused' THEN p_state.remaining_ms
      ELSE greatest(0, ceil(extract(epoch FROM (p_state.deadline_at - p_now)) * 1000)::bigint) END,
    'completed_focus_count', p_state.completed_focus_count)
$$;

-- Read-only: no bootstrapping row and no settlement on GET.
CREATE FUNCTION public.atlas_focus_get_state(p_owner text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' SET timezone = 'UTC' AS $$
DECLARE s public.atlas_focus_state; t timestamptz;
BEGIN
  IF p_owner IS DISTINCT FROM 'ransomed' THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='FOCUS_OWNER_REQUIRED'; END IF;
  SELECT * INTO s FROM public.atlas_focus_state WHERE owner_id=p_owner;
  t := clock_timestamp();
  IF NOT FOUND THEN
    RETURN jsonb_build_object('server_now',t,'revision',0,'settings',jsonb_build_object('focus_minutes',25,'short_break_minutes',5,'long_break_minutes',15,'chime_enabled',false),
      'phase','focus','status','ready','session',NULL,'deadline_at',NULL,'remaining_ms',1500000,'completed_focus_count',0);
  END IF;
  RETURN public.atlas_focus_state_json(s,t);
END $$;

-- Validate again at the DB boundary; normalize numeric/UUID representations before hashing.
CREATE FUNCTION public.atlas_focus_validate_command(p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE cmd text; allowed text[]; r jsonb; rev numeric; op uuid; cfg jsonb;
BEGIN
  IF p_request IS NULL OR jsonb_typeof(p_request) <> 'object' OR octet_length(p_request::text) > 8192 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='FOCUS_INVALID_COMMAND'; END IF;
  cmd := p_request->>'command';
  IF cmd IS NULL OR cmd NOT IN ('start','pause','resume','reset','skip','settings','select_phase','reconcile') THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='FOCUS_INVALID_COMMAND'; END IF;
  allowed := ARRAY['operation_id','expected_revision','command'] || CASE cmd WHEN 'start' THEN ARRAY['project_id'] WHEN 'settings' THEN ARRAY['settings'] WHEN 'select_phase' THEN ARRAY['phase'] ELSE ARRAY[]::text[] END;
  IF p_request - allowed <> '{}'::jsonb OR jsonb_typeof(p_request->'operation_id') IS DISTINCT FROM 'string'
    OR (p_request->>'operation_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    OR jsonb_typeof(p_request->'expected_revision') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='FOCUS_INVALID_COMMAND'; END IF;
  op := (p_request->>'operation_id')::uuid;
  rev := (p_request->>'expected_revision')::numeric;
  IF rev <> trunc(rev) OR rev < 0 OR rev > 9007199254740991 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='FOCUS_INVALID_REVISION'; END IF;
  r := jsonb_build_object('operation_id',op,'expected_revision',rev::bigint,'command',cmd);
  IF cmd='start' AND p_request ? 'project_id' THEN
    IF jsonb_typeof(p_request->'project_id') IS DISTINCT FROM 'string' OR length(p_request->>'project_id') NOT BETWEEN 1 AND 200
      OR btrim(p_request->>'project_id') <> p_request->>'project_id' THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='FOCUS_INVALID_PROJECT'; END IF;
    r := r || jsonb_build_object('project_id',p_request->>'project_id');
  ELSIF cmd='settings' THEN
    cfg := p_request->'settings';
    IF NOT public.atlas_focus_valid_settings(cfg) THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='FOCUS_INVALID_SETTINGS'; END IF;
    r := r || jsonb_build_object('settings',jsonb_build_object('focus_minutes',(cfg->>'focus_minutes')::bigint,
      'short_break_minutes',(cfg->>'short_break_minutes')::bigint,'long_break_minutes',(cfg->>'long_break_minutes')::bigint,'chime_enabled',(cfg->>'chime_enabled')::boolean));
  ELSIF cmd='select_phase' THEN
    IF jsonb_typeof(p_request->'phase') IS DISTINCT FROM 'string' OR p_request->>'phase' NOT IN ('focus','short_break','long_break') THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='FOCUS_INVALID_PHASE'; END IF;
    r := r || jsonb_build_object('phase',p_request->>'phase');
  END IF;
  RETURN r;
END $$;

-- One transaction and owner-row lock cover settlement, command, history and receipt.
-- No scheduler or client completion timestamp is trusted. Replays return the ORIGINAL result,
-- including original server_now; callers GET current state after acknowledging a command.
CREATE FUNCTION public.atlas_focus_command(p_owner text, p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' SET timezone = 'UTC' AS $$
DECLARE
  s public.atlas_focus_state; receipt public.atlas_focus_operations; req jsonb; fingerprint text;
  cmd text; t timestamptz; ended timestamptz; elapsed bigint; outcome text;
  expired boolean := false; changed boolean := false; result jsonb; project record;
BEGIN
  IF p_owner IS DISTINCT FROM 'ransomed' THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='FOCUS_OWNER_REQUIRED'; END IF;
  req := public.atlas_focus_validate_command(p_request);
  fingerprint := encode(sha256(convert_to(req::text,'UTF8')),'hex');
  cmd := req->>'command';
  INSERT INTO public.atlas_focus_state(owner_id) VALUES(p_owner) ON CONFLICT(owner_id) DO NOTHING;
  SELECT * INTO STRICT s FROM public.atlas_focus_state WHERE owner_id=p_owner FOR UPDATE;
  SELECT * INTO receipt FROM public.atlas_focus_operations WHERE owner_id=p_owner AND operation_id=(req->>'operation_id')::uuid;
  IF FOUND THEN
    IF receipt.fingerprint <> fingerprint OR receipt.request <> req THEN RAISE EXCEPTION USING ERRCODE='40001', MESSAGE='OPERATION_CONFLICT'; END IF;
    RETURN receipt.result;
  END IF;
  IF s.revision <> (req->>'expected_revision')::bigint THEN RAISE EXCEPTION USING ERRCODE='40001', MESSAGE='REVISION_CONFLICT'; END IF;
  -- Sample after lock/replay/revision checks, not transaction start (which may precede a lock wait).
  t := clock_timestamp();
  IF s.status='running' AND s.deadline_at <= t THEN
    outcome := 'completed'; ended := s.deadline_at; elapsed := s.duration_ms; expired := true;
  ELSIF cmd IN ('reset','skip') AND s.session_id IS NOT NULL THEN
    outcome := CASE cmd WHEN 'reset' THEN 'reset' ELSE 'skipped' END;
    ended := t;
    elapsed := least(s.duration_ms, s.elapsed_ms + CASE WHEN s.status='running' THEN greatest(0,floor(extract(epoch FROM(t-s.running_since))*1000)::bigint) ELSE 0 END);
  END IF;
  IF outcome IS NOT NULL THEN
    INSERT INTO public.atlas_focus_sessions(id,owner_id,project_id,project_name,business,phase,outcome,duration_ms,focused_ms,started_at,ended_at)
      VALUES(s.session_id,p_owner,s.project_id,s.project_name,s.business,s.phase,outcome,s.duration_ms,elapsed,s.started_at,ended);
    IF outcome='completed' AND s.phase='focus' THEN s.completed_focus_count := s.completed_focus_count+1; END IF;
    IF outcome='completed' OR cmd='skip' THEN
      s.phase := CASE WHEN s.phase<>'focus' THEN 'focus'
        WHEN outcome='completed' AND s.completed_focus_count % 4=0 THEN 'long_break' ELSE 'short_break' END;
    END IF;
    s.status := 'ready'; s.session_id := NULL; s.started_at := NULL; s.duration_ms := NULL;
    s.elapsed_ms := 0; s.remaining_ms := NULL; s.running_since := NULL; s.deadline_at := NULL;
    changed := true;
  END IF;
  -- An expired session consumes this click. Do not also start/reset/skip the next phase.
  IF NOT expired THEN
    CASE cmd
    WHEN 'start' THEN
      IF s.status<>'ready' THEN RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='FOCUS_INVALID_STATE'; END IF;
      IF s.phase='focus' AND NOT req ? 'project_id' THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='FOCUS_PROJECT_REQUIRED'; END IF;
      IF req ? 'project_id' THEN
        SELECT id,name,business,status INTO project FROM public.atlas_projects WHERE id=req->>'project_id' FOR SHARE;
        IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='FOCUS_PROJECT_NOT_FOUND'; END IF;
        IF project.status IN ('archived','completed','canceled') THEN RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='FOCUS_PROJECT_UNAVAILABLE'; END IF;
        s.project_id:=project.id; s.project_name:=project.name; s.business:=project.business;
      END IF;
      -- The project snapshot can wait behind an existing project update.
      -- Start the fresh timer after that lock too, so it gets its full duration.
      t := clock_timestamp();
      s.session_id := gen_random_uuid(); s.started_at := t;
      s.duration_ms := public.atlas_focus_duration_ms(s.settings,s.phase); s.elapsed_ms:=0;
      s.remaining_ms:=s.duration_ms; s.running_since:=t; s.deadline_at:=t+s.remaining_ms*interval '1 millisecond'; s.status:='running'; changed:=true;
    WHEN 'pause' THEN
      IF s.status<>'running' THEN RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='FOCUS_INVALID_STATE'; END IF;
      s.elapsed_ms:=least(s.duration_ms,s.elapsed_ms+greatest(0,floor(extract(epoch FROM(t-s.running_since))*1000)::bigint));
      s.remaining_ms:=s.duration_ms-s.elapsed_ms; s.running_since:=NULL; s.deadline_at:=NULL; s.status:='paused'; changed:=true;
    WHEN 'resume' THEN
      IF s.status<>'paused' THEN RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='FOCUS_INVALID_STATE'; END IF;
      s.running_since:=t; s.deadline_at:=t+s.remaining_ms*interval '1 millisecond'; s.status:='running'; changed:=true;
    WHEN 'reset' THEN NULL; -- Existing session was recorded above; ready reset has no history or revision change.
    WHEN 'skip' THEN
      IF outcome IS NULL THEN s.phase:=CASE WHEN s.phase='focus' THEN 'short_break' ELSE 'focus' END; changed:=true; END IF;
    WHEN 'settings' THEN
      IF s.settings IS DISTINCT FROM req->'settings' THEN s.settings:=req->'settings'; changed:=true; END IF;
    WHEN 'select_phase' THEN
      IF s.status<>'ready' THEN RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='FOCUS_INVALID_STATE'; END IF;
      IF s.phase IS DISTINCT FROM req->>'phase' THEN s.phase:=req->>'phase'; changed:=true; END IF;
    WHEN 'reconcile' THEN NULL;
    END CASE;
  END IF;
  IF changed THEN
    s.revision:=s.revision+1; s.updated_at:=t;
    UPDATE public.atlas_focus_state SET revision=s.revision,settings=s.settings,phase=s.phase,status=s.status,
      session_id=s.session_id,project_id=s.project_id,project_name=s.project_name,business=s.business,started_at=s.started_at,
      duration_ms=s.duration_ms,elapsed_ms=s.elapsed_ms,remaining_ms=s.remaining_ms,running_since=s.running_since,
      deadline_at=s.deadline_at,completed_focus_count=s.completed_focus_count,updated_at=s.updated_at WHERE owner_id=p_owner;
  END IF;
  result:=public.atlas_focus_state_json(s,t);
  INSERT INTO public.atlas_focus_operations(owner_id,operation_id,fingerprint,request,result,created_at)
    VALUES(p_owner,(req->>'operation_id')::uuid,fingerprint,req,result,t);
  RETURN result;
END $$;

-- Stable keyset pagination; all-history totals are intentionally outside the page/cursor predicate.
CREATE FUNCTION public.atlas_focus_history(p_owner text, p_limit integer DEFAULT 20,
  p_cursor_ended_at timestamptz DEFAULT NULL, p_cursor_id uuid DEFAULT NULL, p_project_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' SET timezone = 'UTC' AS $$
DECLARE result jsonb;
BEGIN
  IF p_owner IS DISTINCT FROM 'ransomed' THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='FOCUS_OWNER_REQUIRED'; END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR (p_cursor_ended_at IS NULL) <> (p_cursor_id IS NULL)
    OR (p_project_id IS NOT NULL AND (length(p_project_id) NOT BETWEEN 1 AND 200 OR btrim(p_project_id)<>p_project_id)) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='FOCUS_INVALID_HISTORY_QUERY'; END IF;
  WITH base AS MATERIALIZED (
    SELECT id,project_id,project_name,business,phase,outcome,duration_ms,focused_ms,started_at,ended_at
      FROM public.atlas_focus_sessions WHERE owner_id=p_owner AND (p_project_id IS NULL OR project_id=p_project_id)
  ), page AS MATERIALIZED (
    SELECT * FROM base WHERE p_cursor_ended_at IS NULL OR (ended_at,id)<(p_cursor_ended_at,p_cursor_id)
      ORDER BY ended_at DESC,id DESC LIMIT p_limit+1
  ), visible AS MATERIALIZED (SELECT * FROM page ORDER BY ended_at DESC,id DESC LIMIT p_limit),
  completed AS MATERIALIZED (SELECT * FROM base WHERE phase='focus' AND outcome='completed'),
  grouped AS (SELECT project_id,count(*) AS completed_sessions,sum(focused_ms) AS focus_ms FROM completed GROUP BY project_id),
  names AS (SELECT DISTINCT ON(project_id) project_id,project_name FROM completed ORDER BY project_id,ended_at DESC,id DESC)
  SELECT jsonb_build_object(
    'items',coalesce((SELECT jsonb_agg(to_jsonb(v) ORDER BY ended_at DESC,id DESC) FROM visible v),'[]'::jsonb),
    'next_cursor',CASE WHEN (SELECT count(*) FROM page)>p_limit THEN
      (SELECT jsonb_build_object('ended_at',ended_at,'id',id) FROM visible ORDER BY ended_at,id LIMIT 1) ELSE NULL END,
    'totals',(SELECT jsonb_build_object('completed_sessions',count(*),'focus_ms',coalesce(sum(focused_ms),0)) FROM completed),
    'projects',coalesce((SELECT jsonb_agg(jsonb_build_object('project_id',g.project_id,'project_name',n.project_name,
      'completed_sessions',g.completed_sessions,'focus_ms',g.focus_ms) ORDER BY g.focus_ms DESC,g.project_id)
      FROM grouped g JOIN names n USING(project_id)),'[]'::jsonb)) INTO result;
  RETURN result;
END $$;

ALTER TABLE public.atlas_focus_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.atlas_focus_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.atlas_focus_operations ENABLE ROW LEVEL SECURITY;
-- No policies: anon/authenticated receive no direct browser access.
REVOKE ALL ON TABLE public.atlas_focus_state,public.atlas_focus_sessions,public.atlas_focus_operations FROM PUBLIC;
REVOKE ALL ON FUNCTION public.atlas_focus_valid_settings(jsonb),public.atlas_focus_reject_history_mutation(),
  public.atlas_focus_duration_ms(jsonb,text),public.atlas_focus_state_json(public.atlas_focus_state,timestamptz),
  public.atlas_focus_get_state(text),public.atlas_focus_validate_command(jsonb),public.atlas_focus_command(text,jsonb),
  public.atlas_focus_history(text,integer,timestamptz,uuid,text) FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
  -- Supabase default privileges can grant new objects to browser roles; undo on THESE objects only.
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.atlas_focus_state, public.atlas_focus_sessions, public.atlas_focus_operations FROM %I',role_name);
      EXECUTE format('REVOKE ALL ON FUNCTION public.atlas_focus_valid_settings(jsonb), public.atlas_focus_reject_history_mutation(), public.atlas_focus_duration_ms(jsonb,text), public.atlas_focus_state_json(public.atlas_focus_state,timestamptz), public.atlas_focus_get_state(text), public.atlas_focus_validate_command(jsonb), public.atlas_focus_command(text,jsonb), public.atlas_focus_history(text,integer,timestamptz,uuid,text) FROM %I',role_name);
    END IF;
  END LOOP;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    RAISE EXCEPTION 'FOCUS_REQUIRES_EXISTING_SERVICE_ROLE'; END IF;
END $$;
-- NEW-OBJECT ACCESS ONLY; pending the same separate owner approval as the definitions above.
REVOKE ALL ON TABLE public.atlas_focus_state,public.atlas_focus_sessions,public.atlas_focus_operations FROM service_role;
GRANT SELECT,INSERT,UPDATE ON TABLE public.atlas_focus_state TO service_role;
GRANT SELECT,INSERT ON TABLE public.atlas_focus_sessions,public.atlas_focus_operations TO service_role;
GRANT EXECUTE ON FUNCTION public.atlas_focus_valid_settings(jsonb),public.atlas_focus_reject_history_mutation(),
  public.atlas_focus_duration_ms(jsonb,text),public.atlas_focus_state_json(public.atlas_focus_state,timestamptz),
  public.atlas_focus_get_state(text),public.atlas_focus_validate_command(jsonb),public.atlas_focus_command(text,jsonb),
  public.atlas_focus_history(text,integer,timestamptz,uuid,text) TO service_role;

-- Assertions are metadata-only. They never start a focus session or touch existing Atlas rows.
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname LIKE 'atlas_focus_%' AND p.prosecdef) THEN
    RAISE EXCEPTION 'FOCUS_FUNCTION_MUST_USE_INVOKER'; END IF;
  IF EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename IN ('atlas_focus_state','atlas_focus_sessions','atlas_focus_operations')) THEN
    RAISE EXCEPTION 'FOCUS_BROWSER_POLICIES_UNEXPECTED'; END IF;
END $$;
COMMIT;
