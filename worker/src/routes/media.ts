import { Hono } from 'hono';
import type { Env } from '../db';
import { getDb } from '../db';
import { getActor } from '../utils/actors';
import { apiError } from '../utils/http';

const router=new Hono<{Bindings:Env}>();
const DATE_PATTERN=/^\d{4}-\d{2}-\d{2}$/;
const PLATFORMS=new Set(['youtube','spotify','apple_podcasts','apple_music','other']);
const CATEGORIES=new Set(['brief_news','faith_family_health','growth','music','leisure','reset']);
const ITEM_TYPES=new Set(['consumable','reset']);
const TRIGGERS=new Set(['weekday_morning','daytime_transition_1','daytime_transition_2','saturday_walk','sunday_faith','sunday_restoration','after_work_reset','flex']);
const CAPACITY_CLASSES=new Set(['recovery','standard','expansion','unknown']);
const SOURCE_STATUSES=new Set(['complete','partial','unavailable']);
const OWNER_STATUSES=new Set(['queued','done','later','skipped']);
const INPUT_JOBS=new Set(['orient','advance','restore']);
const FEEDBACK_OUTCOMES=new Set(['helpful','neutral','not_for_me','led_to_drift']);
type Row=Record<string,any>;

function isMonday(value:string):boolean{
  if(!DATE_PATTERN.test(value))return false;
  const date=new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.valueOf())&&date.getUTCDay()===1&&date.toISOString().slice(0,10)===value;
}

function pacificParts(now=new Date()):Record<string,string>{
  return Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(part=>[part.type,part.value]));
}

export function getPacificDate(now=new Date()):string{
  const parts=pacificParts(now);return`${parts.year}-${parts.month}-${parts.day}`;
}

export function getPacificWeekStart(now=new Date()):string{
  const localDate=getPacificDate(now);const date=new Date(`${localDate}T12:00:00Z`);const daysSinceMonday=(date.getUTCDay()+6)%7;date.setUTCDate(date.getUTCDate()-daysSinceMonday);return date.toISOString().slice(0,10);
}

function validDate(value:unknown):boolean{
  if(typeof value!=='string'||!DATE_PATTERN.test(value))return false;const date=new Date(`${value}T12:00:00Z`);return!Number.isNaN(date.valueOf())&&date.toISOString().slice(0,10)===value;
}

function windowGroup(trigger:string):'morning'|'later'|'reset'{
  if(trigger==='after_work_reset')return'reset';return trigger==='weekday_morning'||trigger==='sunday_faith'?'morning':'later';
}

function hasSpecificSource(item:Row):boolean{
  if(typeof item.source_url!=='string'||!item.source_url.startsWith('https://'))return false;
  try{
    const url=new URL(item.source_url);
    if(url.hostname==='youtu.be')return url.pathname.split('/').filter(Boolean).length===1;
    if(url.hostname.endsWith('youtube.com'))return url.pathname==='/watch'&&Boolean(url.searchParams.get('v'));
    return url.pathname.split('/').filter(Boolean).length>0;
  }catch{return false}
}

export function validateMediaUpsertBody(body:Row):string[]{
  const errors:string[]=[];
  if(typeof body.week_start!=='string'||!isMonday(body.week_start))errors.push('week_start must be a valid Pacific Monday');
  if(!CAPACITY_CLASSES.has(String(body.capacity_class||'')))errors.push('capacity_class is invalid');
  if(!SOURCE_STATUSES.has(String(body.source_status||'')))errors.push('source_status is invalid');
  if(typeof body.source_fingerprint!=='string'||!body.source_fingerprint.trim())errors.push('source_fingerprint is required');
  if(typeof body.intent_summary!=='string'||!body.intent_summary.trim()||body.intent_summary.length>1000)errors.push('intent_summary is required');
  if(!Array.isArray(body.input_jobs)||body.input_jobs.length>3||body.input_jobs.some((job:unknown)=>!INPUT_JOBS.has(String(job)))||new Set(body.input_jobs).size!==body.input_jobs.length)errors.push('input_jobs must contain up to three unique jobs');
  if(!Number.isSafeInteger(body.weekly_budget)||body.weekly_budget<1||body.weekly_budget>6)errors.push('weekly_budget must be between one and six');
  if(!Array.isArray(body.items)||body.items.length<1||body.items.length>7){errors.push('items must contain between 1 and 7 entries');return errors;}
  const sourceKeys=new Set<string>();const ranks=new Set<number>();const days=new Map<string,string[]>();let resets=0;let consumables=0;
  body.items.forEach((raw:unknown,index:number)=>{
    if(!raw||typeof raw!=='object'||Array.isArray(raw)){errors.push(`items[${index}] must be an object`);return;}
    const item=raw as Row;
    if(typeof item.source_key!=='string'||!item.source_key.trim())errors.push(`items[${index}].source_key is required`);else if(sourceKeys.has(item.source_key))errors.push(`items[${index}].source_key is duplicated`);else sourceKeys.add(item.source_key);
    if(!PLATFORMS.has(String(item.platform)))errors.push(`items[${index}].platform is invalid`);
    if(!CATEGORIES.has(String(item.category)))errors.push(`items[${index}].category is invalid`);
    if(!ITEM_TYPES.has(String(item.item_type)))errors.push(`items[${index}].item_type is invalid`);
    if(item.item_type==='reset')resets+=1;else consumables+=1;
    if(typeof item.title!=='string'||!item.title.trim())errors.push(`items[${index}].title is required`);
    if(typeof item.purpose!=='string'||!item.purpose.trim())errors.push(`items[${index}].purpose is required`);
    if(typeof item.selection_reason!=='string'||!item.selection_reason.trim())errors.push(`items[${index}].selection_reason is required`);
    if(typeof item.stop_rule!=='string'||!item.stop_rule.trim())errors.push(`items[${index}].stop_rule is required`);
    if(!TRIGGERS.has(String(item.trigger_kind)))errors.push(`items[${index}].trigger_kind is invalid`);
    if(!Number.isSafeInteger(item.rank)||item.rank<0||item.rank>6)errors.push(`items[${index}].rank is invalid`);else if(ranks.has(item.rank))errors.push(`items[${index}].rank is duplicated`);else ranks.add(item.rank);
    if(item.item_type==='consumable'){
      if(!INPUT_JOBS.has(String(item.input_job)))errors.push(`items[${index}].input_job is invalid`);
      else if(!body.input_jobs.includes(item.input_job))errors.push(`items[${index}].input_job is not planned this week`);
      if(typeof item.creator!=='string'||!item.creator.trim())errors.push(`items[${index}].creator is required`);
      if(!validDate(item.planned_date))errors.push(`items[${index}].planned_date is required`);
      else days.set(item.planned_date,[...(days.get(item.planned_date)||[]),windowGroup(String(item.trigger_kind))]);
      if(item.platform!=='other'&&!hasSpecificSource(item))errors.push(`items[${index}].source_url must link directly to a specific item`);
      if(item.platform==='other'&&item.source_url&& !hasSpecificSource(item))errors.push(`items[${index}].source_url must link directly to a specific item`);
    }else{
      if(item.input_job!=='reset')errors.push(`items[${index}].input_job must be reset`);
      if(item.planned_date!==undefined&&item.planned_date!==null&&item.planned_date!==''&&!validDate(item.planned_date))errors.push(`items[${index}].planned_date is invalid`);
    }
    if(item.source_url!==undefined&&item.source_url!==null&&item.source_url!==''&&(typeof item.source_url!=='string'||!item.source_url.startsWith('https://')))errors.push(`items[${index}].source_url must use HTTPS`);
  });
  if(resets!==1)errors.push('items must contain one Reset item');
  if(Number.isSafeInteger(body.weekly_budget)&&consumables>body.weekly_budget)errors.push('consumables exceed weekly_budget');
  for(const groups of days.values())if(groups.length>1)errors.push('plans may schedule only one consumable per day');
  return Array.from(new Set(errors));
}

function normalizeItem(raw:Row,index:number):Row{return{source_key:String(raw.source_key).trim().slice(0,500),platform:String(raw.platform),category:String(raw.category),item_type:String(raw.item_type),title:String(raw.title).trim().slice(0,500),creator:typeof raw.creator==='string'?raw.creator.slice(0,500):'',source_url:typeof raw.source_url==='string'&&raw.source_url?raw.source_url:null,duration_minutes:Number.isSafeInteger(raw.duration_minutes)?raw.duration_minutes:null,planned_date:typeof raw.planned_date==='string'&&raw.planned_date?raw.planned_date:null,trigger_kind:String(raw.trigger_kind),purpose:typeof raw.purpose==='string'?raw.purpose.slice(0,1000):'',input_job:String(raw.input_job),selection_reason:typeof raw.selection_reason==='string'?raw.selection_reason.slice(0,1000):'',stop_rule:typeof raw.stop_rule==='string'?raw.stop_rule.slice(0,500):'',rank:Number.isSafeInteger(raw.rank)?raw.rank:index};}

export function buildTwitterAllowance(row:Row|null,now=new Date()):Row{
  const parts=pacificParts(now);const minuteOfDay=Number(parts.hour)*60+Number(parts.minute);const inside=minuteOfDay>=18*60&&minuteOfDay<20*60;
  if(row?.twitter_started_at&&row?.twitter_expires_at){const expiresAt=new Date(row.twitter_expires_at);return{...row,state:now<expiresAt?'active':'used',available:false,duration_minutes:15};}
  return{state:inside?'available':'closed',available:inside,duration_minutes:15,window_start_local:'18:00',window_end_local:'20:00'};
}

export function mediaWindowOpen(now=new Date()):boolean{
  const parts=pacificParts(now);const minuteOfDay=Number(parts.hour)*60+Number(parts.minute);return minuteOfDay>=5*60+30&&minuteOfDay<22*60+30;
}

function derivedStatus(item:Row,today:string,nowMs:number):string{
  if(item.status!=='queued')return item.status;if(item.item_type==='reset')return'queued';if(String(item.planned_date)<today)return'missed';if(String(item.planned_date)>today)return'upcoming';if(item.eligible_until&&new Date(item.eligible_until).valueOf()<=nowMs)return'missed';if(item.eligible_from&&new Date(item.eligible_from).valueOf()>nowMs)return'upcoming';return'queued';
}

function addDate(date:string,days:number):string{const value=new Date(`${date}T12:00:00Z`);value.setUTCDate(value.getUTCDate()+days);return value.toISOString().slice(0,10)}

export function buildDailyMap(weekStart:string,items:Row[],today:string):Row[]{
  const consumables=items.filter(item=>item.item_type==='consumable'&&item.status!=='removed');
  return Array.from({length:7},(_,offset)=>{
    const date=addDate(weekStart,offset);const scheduled=consumables.find(item=>item.planned_date===date)||null;
    if(scheduled?.status==='done')return{date,day_index:offset,is_today:date===today,kind:'complete',title:scheduled.title,reason:'Completed.',item:scheduled};
    if(scheduled&& !['later','skipped'].includes(String(scheduled.status)))return{date,day_index:offset,is_today:date===today,kind:'item',title:scheduled.title,reason:scheduled.purpose,item:scheduled};
    const moved=scheduled?.status==='later';const skipped=scheduled?.status==='skipped';
    return{date,day_index:offset,is_today:date===today,kind:'open',title:date<today?'No media was planned':date===today?'No planned media today':'Open day',reason:moved?'Moved to Later. No replacement is scheduled.':skipped?'Skipped. No replacement is scheduled.':'Use the time for projects, family, or rest.',item:null};
  });
}

export function buildMediaPayload(plan:Row|null,rawItems:Row[],today=getPacificDate(),nowIso=new Date().toISOString(),_todayPlan:Row|null=null,allowanceRow:Row|null=null,inputReview:Row|null=null):Row{
  const now=new Date(nowIso);const nowMs=now.valueOf();
  const items:Row[]=[...rawItems].filter(item=>item.status!=='removed').sort((a,b)=>String(a.planned_date||'9999-12-31').localeCompare(String(b.planned_date||'9999-12-31'))||String(a.eligible_from||'').localeCompare(String(b.eligible_from||''))||Number(a.rank||0)-Number(b.rank||0)).map(item=>({...item,display_status:derivedStatus(item,today,nowMs)} as Row));
  const resetItem=items.find(item=>item.item_type==='reset'&&['queued','later'].includes(String(item.status)))||null;
  const todayConsumables=items.filter(item=>item.item_type==='consumable'&&item.planned_date===today);
  const dailyLimit=1;
  const windowsUsed=todayConsumables.filter(item=>['done','later','skipped'].includes(String(item.status))).length;
  const todayItem=todayConsumables.find(item=>item.status==='queued')||null;
  const nextWindow=todayConsumables.filter(item=>item.status==='queued'&&item.eligible_from&&new Date(item.eligible_from).valueOf()>nowMs).sort((a,b)=>String(a.eligible_from).localeCompare(String(b.eligible_from)))[0]||null;
  const future=items.find(item=>item.item_type==='consumable'&&item.status==='queued'&&String(item.planned_date)>today)||null;
  const weekStart=String(plan?.week_start||getPacificWeekStart(new Date(`${today}T12:00:00Z`)));const dailyMap=buildDailyMap(weekStart,items,today);const todayGuidance=dailyMap.find(day=>day.date===today)||null;const nextGuidance=dailyMap.find(day=>day.date>today&&day.kind==='item')||null;
  const primaryRecommendation=todayItem?{kind:'media',reason:'Today’s planned choice. Use it at the suggested time or when it fits.',item:todayItem}:{kind:'open',heading:'No planned media today',reason:'Use the saved time for projects, family, or rest. Reset is available if you need it.',item:null};
  const sourceStatus=String(plan?.source_status||'unavailable');
  const sourceWarning=sourceStatus==='complete'?null:sourceStatus==='partial'?'Some personal sources were unavailable; the seven-day map still shows the verified choices.':'Personal-source enrichment is unavailable; use only the verified links shown.';
  return{week_start:weekStart,today,plan,items,daily_map:dailyMap,today_guidance:todayGuidance,next_guidance:nextGuidance,today_item:todayItem,reset_item:resetItem,primary_recommendation:primaryRecommendation,today_action:null,daily_limit:dailyLimit,windows_used:windowsUsed,windows_remaining:Math.max(0,dailyLimit-windowsUsed),current_window:todayItem,next_window:nextWindow,next_change_at:nextWindow?.eligible_from||future?.eligible_from||null,twitter_allowance:buildTwitterAllowance(allowanceRow,now),input_review:inputReview,completed_count:items.filter(item=>item.status==='done').length,skipped_count:items.filter(item=>item.status==='skipped').length,later_count:items.filter(item=>item.status==='later').length,next_planned_trigger:(nextWindow||future)?.trigger_kind||null,source_warning:sourceWarning};
}

async function loadMediaPayload(env:Env,weekStart:string,now=new Date()):Promise<Row>{
  const supabase=getDb(env);const today=getPacificDate(now);const currentWeek=getPacificWeekStart(now);
  const [planResult,allowanceResult,reviewResult]=await Promise.all([
    supabase.from('atlas_media_plans').select('*').eq('week_start',weekStart).eq('status','active').maybeSingle(),
    weekStart===currentWeek?supabase.from('atlas_media_daily_allowances').select('*').eq('allowance_date',today).maybeSingle():Promise.resolve({data:null,error:null}),
    supabase.from('atlas_media_input_reviews').select('*').eq('week_start',weekStart).order('created_at',{ascending:false}).limit(1).maybeSingle(),
  ]);
  if(planResult.error)throw planResult.error;if((allowanceResult as any).error)throw(allowanceResult as any).error;if(reviewResult.error)throw reviewResult.error;
  const plan=planResult.data;if(!plan)return buildMediaPayload(null,[],today,now.toISOString(),null,(allowanceResult as any).data||null,reviewResult.data||null);
  const itemResult=await supabase.from('atlas_media_plan_items').select('*').eq('media_plan_id',plan.id).neq('status','removed').order('rank',{ascending:true});if(itemResult.error)throw itemResult.error;
  const rawItems=(itemResult.data||[]) as Row[];const itemIds=rawItems.map(item=>item.id);
  const feedbackResult=itemIds.length?await supabase.from('atlas_media_item_feedback').select('*').in('item_id',itemIds).order('created_at',{ascending:false}):{data:[],error:null};
  if(feedbackResult.error)throw feedbackResult.error;
  const feedbackByItem=new Map<string,Row>();for(const feedback of (feedbackResult.data||[]) as Row[])if(!feedbackByItem.has(feedback.item_id))feedbackByItem.set(feedback.item_id,feedback);
  return buildMediaPayload(plan,rawItems.map(item=>({...item,feedback:feedbackByItem.get(item.id)||null})),today,now.toISOString(),null,(allowanceResult as any).data||null,reviewResult.data||null);
}

function rpcError(c:any,error:{code?:string;message?:string},operation:string){const message=error.message||'';if(error.code==='40001'||message.includes('REVISION_CONFLICT'))return apiError(c,409,'REVISION_CONFLICT','The media state changed. Refresh and retry.');if(error.code==='P0002'||message.includes('NOT_FOUND'))return apiError(c,404,'MEDIA_NOT_FOUND','The media plan or item was not found.');if(error.code==='42501'||message.includes('OWNER_REQUIRED'))return apiError(c,403,'OWNER_REQUIRED','Only the ATLAS owner can record this state.');if(['22023','23503','23505','23514','55000'].includes(String(error.code)))return apiError(c,400,'INVALID_MEDIA_PLAN',message||`Unable to ${operation}.`);console.error(`[media] ${operation} error: ${message||error.code||'unknown error'}`);return apiError(c,500,'MEDIA_PLAN_FAILED',`Unable to ${operation}.`);}

router.get('/current',async c=>{try{return c.json(await loadMediaPayload(c.env,getPacificWeekStart()));}catch(error){return rpcError(c,error as any,'load the current media plan')}});
router.get('/:weekStart',async c=>{const weekStart=c.req.param('weekStart');if(!isMonday(weekStart))return apiError(c,400,'INVALID_WEEK_START','week_start must be a valid Pacific Monday.');try{return c.json(await loadMediaPayload(c.env,weekStart));}catch(error){return rpcError(c,error as any,'load the media plan')}});

router.post('/plans/upsert',async c=>{try{const body=await c.req.json().catch(()=>({})) as Row;const errors=validateMediaUpsertBody(body);if(errors.length)return apiError(c,400,'INVALID_MEDIA_PLAN',errors.join('; '));const{data,error}=await getDb(c.env).rpc('upsert_atlas_media_plan_v2',{p_week_start:body.week_start,p_weekly_revision_id:body.weekly_revision_id||null,p_capacity_class:body.capacity_class,p_source_status:body.source_status,p_source_fingerprint:body.source_fingerprint,p_intent_summary:body.intent_summary.trim(),p_input_jobs:body.input_jobs,p_weekly_budget:body.weekly_budget,p_items:body.items.map(normalizeItem),p_actor:getActor(c),p_idempotency_key:typeof body.idempotency_key==='string'&&body.idempotency_key?body.idempotency_key:crypto.randomUUID()});if(error)return rpcError(c,error,'upsert the media plan');return c.json(data,201)}catch(error){return apiError(c,400,'INVALID_MEDIA_PLAN',(error as Error).message)}});

router.post('/items/:id/status',async c=>{try{const body=await c.req.json().catch(()=>({})) as Row;if(!Number.isSafeInteger(body.expected_revision)||body.expected_revision<1)return apiError(c,400,'INVALID_MEDIA_STATUS','expected_revision must be a positive integer.');if(!OWNER_STATUSES.has(String(body.status)))return apiError(c,400,'INVALID_MEDIA_STATUS','status must be queued, done, later, or skipped.');if(typeof body.idempotency_key!=='string'||!body.idempotency_key.trim())return apiError(c,400,'INVALID_MEDIA_STATUS','idempotency_key is required.');const{data,error}=await getDb(c.env).rpc('transition_atlas_media_item_status',{p_item_id:c.req.param('id'),p_expected_revision:body.expected_revision,p_status:body.status,p_actor:getActor(c),p_idempotency_key:body.idempotency_key});if(error)return rpcError(c,error,'update the media item');return c.json(data)}catch(error){return apiError(c,400,'INVALID_MEDIA_STATUS',(error as Error).message)}});

router.post('/items/:id/feedback',async c=>{try{const body=await c.req.json().catch(()=>({})) as Row;if(!FEEDBACK_OUTCOMES.has(String(body.outcome)))return apiError(c,400,'INVALID_MEDIA_FEEDBACK','outcome must be helpful, neutral, not_for_me, or led_to_drift.');if(typeof body.idempotency_key!=='string'||!body.idempotency_key.trim())return apiError(c,400,'INVALID_MEDIA_FEEDBACK','idempotency_key is required.');const{data,error}=await getDb(c.env).rpc('record_atlas_media_item_feedback',{p_item_id:c.req.param('id'),p_outcome:body.outcome,p_note:typeof body.note==='string'?body.note.slice(0,1000):'',p_actor:getActor(c),p_idempotency_key:body.idempotency_key});if(error)return rpcError(c,error,'record media feedback');return c.json(data,201)}catch(error){return apiError(c,400,'INVALID_MEDIA_FEEDBACK',(error as Error).message)}});

router.post('/daily/:date/twitter/start',async c=>{const date=c.req.param('date');if(!validDate(date))return apiError(c,400,'INVALID_MEDIA_DATE','date must be YYYY-MM-DD.');try{const body=await c.req.json().catch(()=>({})) as Row;if(typeof body.idempotency_key!=='string'||!body.idempotency_key.trim())return apiError(c,400,'INVALID_MEDIA_ALLOWANCE','idempotency_key is required.');const{data,error}=await getDb(c.env).rpc('start_atlas_media_twitter_allowance',{p_date:date,p_actor:getActor(c),p_idempotency_key:body.idempotency_key,p_expected_revision:Number.isSafeInteger(body.expected_revision)?body.expected_revision:null});if(error)return rpcError(c,error,'start the Twitter allowance');return c.json(data)}catch(error){return apiError(c,400,'INVALID_MEDIA_ALLOWANCE',(error as Error).message)}});

router.post('/sync-manifests',async c=>{try{const body=await c.req.json().catch(()=>({})) as Row;if(!isMonday(String(body.week_start||''))||body.provider!=='youtube'||body.account_key!=='personal'||body.playlist_title!=='00 — This Week'||typeof body.source_fingerprint!=='string'||!body.manifest||typeof body.manifest!=='object')return apiError(c,400,'INVALID_MEDIA_SYNC','A valid weekly YouTube dry-run manifest is required.');const{data,error}=await getDb(c.env).rpc('record_atlas_media_sync_manifest',{p_week_start:body.week_start,p_provider:body.provider,p_account_key:body.account_key,p_playlist_title:body.playlist_title,p_source_fingerprint:body.source_fingerprint,p_manifest:body.manifest,p_actor:getActor(c),p_idempotency_key:body.idempotency_key||crypto.randomUUID()});if(error)return rpcError(c,error,'record the YouTube sync manifest');return c.json(data,201)}catch(error){return apiError(c,400,'INVALID_MEDIA_SYNC',(error as Error).message)}});

router.post('/sync-protocols/activate',async c=>{try{const body=await c.req.json().catch(()=>({})) as Row;const{data,error}=await getDb(c.env).rpc('activate_atlas_media_sync_protocol',{p_provider:'youtube',p_account_key:'personal',p_playlist_id:body.playlist_id,p_playlist_title:'00 — This Week',p_protocol_hash:body.protocol_hash,p_constraints:body.constraints||{},p_actor:getActor(c),p_idempotency_key:body.idempotency_key||crypto.randomUUID()});if(error)return rpcError(c,error,'activate the YouTube mirror');return c.json(data,201)}catch(error){return apiError(c,400,'INVALID_MEDIA_SYNC',(error as Error).message)}});
router.post('/sync-applies',async c=>{try{const body=await c.req.json().catch(()=>({})) as Row;if(!isMonday(String(body.week_start||''))||!body.dry_run_id||!body.manifest_hash||!body.protocol_hash||!body.result)return apiError(c,400,'INVALID_MEDIA_SYNC','Dry-run, protocol, and apply result are required.');const{data,error}=await getDb(c.env).rpc('record_atlas_media_sync_apply',{p_week_start:body.week_start,p_dry_run_id:body.dry_run_id,p_manifest_hash:body.manifest_hash,p_protocol_hash:body.protocol_hash,p_result:body.result,p_actor:getActor(c),p_idempotency_key:body.idempotency_key||crypto.randomUUID()});if(error)return rpcError(c,error,'record the YouTube mirror apply');return c.json(data,201)}catch(error){return apiError(c,400,'INVALID_MEDIA_SYNC',(error as Error).message)}});
router.post('/input-reviews',async c=>{try{const body=await c.req.json().catch(()=>({})) as Row;if(!isMonday(String(body.week_start||''))||!SOURCE_STATUSES.has(String(body.source_status))||typeof body.summary!=='string'||!body.summary.trim())return apiError(c,400,'INVALID_MEDIA_REVIEW','A valid weekly input review is required.');const{data,error}=await getDb(c.env).rpc('record_atlas_media_input_review',{p_week_start:body.week_start,p_source_status:body.source_status,p_coverage:body.coverage||{},p_summary:body.summary,p_metrics:body.metrics||{},p_themes:Array.isArray(body.themes)?body.themes:[],p_drift:Array.isArray(body.drift)?body.drift:[],p_recommendations:Array.isArray(body.recommendations)?body.recommendations:[],p_actor:getActor(c),p_idempotency_key:body.idempotency_key||crypto.randomUUID()});if(error)return rpcError(c,error,'record the weekly input review');return c.json(data,201)}catch(error){return apiError(c,400,'INVALID_MEDIA_REVIEW',(error as Error).message)}});

export default router;
