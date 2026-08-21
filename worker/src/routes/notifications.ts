import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import { Env, getDb } from '../db';
import { getActor } from '../utils/actors';
import { apiError } from '../utils/http';

type Row = Record<string, any>;
const router = new Hono<{ Bindings: Env }>();
const CATEGORIES = new Set(['all','assignments','mentions','status_changes','comments','project_updates','initiative_updates','cycles','documents','releases','analytics','workflows','system']);
const CHANNELS = new Set(['inbox','browser','email','slack','webhook']);
const TARGETS = new Set(['action','project','initiative','cycle','document','saved_view','workflow','workspace']);

function errorResponse(c: any, error: any, fallback: string) {
  const message = String(error?.message || '');
  if (error?.code === '40001' || message.includes('REVISION_CONFLICT')) return apiError(c,409,'REVISION_CONFLICT','The notification changed. Refresh and retry.');
  if (error?.code === '42501' || message.includes('OWNER_REQUIRED')) return apiError(c,403,'OWNER_REQUIRED','Only the ATLAS owner can change notification state.');
  if (error?.code === 'P0002' || message.includes('NOT_FOUND')) return apiError(c,404,'NOTIFICATION_NOT_FOUND','Notification not found.');
  if (['22023','23503','23505','23514'].includes(String(error?.code))) return apiError(c,400,'NOTIFICATION_INVALID',message || fallback);
  console.error(`[notifications] ${fallback}: ${message || error}`);
  return apiError(c,500,'NOTIFICATION_OPERATION_FAILED',fallback);
}

router.get('/', async c => {
  try {
    const supabase=getDb(c.env); const actor=getActor(c); const status=c.req.query('status') || 'open'; const category=c.req.query('category');
    const limit=Math.min(Math.max(Number(c.req.query('limit') || 100),1),500);
    let query=supabase.from('atlas_notifications').select('*,event:atlas_notification_events!event_id(*)').eq('principal_id',actor).order('created_at',{ascending:false}).limit(limit);
    if(status==='open') query=query.in('status',['unread','read']); else if(['unread','read','archived'].includes(status)) query=query.eq('status',status);
    const {data,error}=await query; if(error) throw error;
    const items=(data || []).filter(item=>!category || item.event?.category===category);
    return c.json({items,unread:items.filter(item=>item.status==='unread').length,as_of:new Date().toISOString()});
  } catch(error){return errorResponse(c,error,'Unable to load notifications.');}
});

router.get('/summary', async c => {
  try {
    const supabase=getDb(c.env); const actor=getActor(c);
    const [unread,preferences,subscriptions]=await Promise.all([
      supabase.from('atlas_notifications').select('id',{count:'exact',head:true}).eq('principal_id',actor).eq('status','unread'),
      supabase.from('atlas_notification_preferences').select('*').eq('principal_id',actor).order('channel').order('category'),
      supabase.from('atlas_notification_subscriptions').select('*').eq('principal_id',actor).neq('status','archived').order('updated_at',{ascending:false}),
    ]);
    for(const result of[unread,preferences,subscriptions]) if(result.error) throw result.error;
    return c.json({unread_count:unread.count||0,preferences:preferences.data||[],subscriptions:subscriptions.data||[]});
  }catch(error){return errorResponse(c,error,'Unable to load notification settings.');}
});

for(const status of['read','unread','archived']) router.post(`/:id/${status}`,async c=>{
  try{const body=await c.req.json<Row>().catch(()=>({} as Row));const{data,error}=await getDb(c.env).rpc('transition_atlas_notification',{p_notification_id:c.req.param('id'),p_status:status,p_actor:getActor(c),p_expected_revision:Number.isSafeInteger(body.expected_revision)?body.expected_revision:null});if(error)throw error;return c.json(data);}catch(error){return errorResponse(c,error,`Unable to mark notification ${status}.`);}
});

router.post('/read-all',async c=>{
  try{const{data,error}=await getDb(c.env).rpc('transition_all_atlas_notifications',{p_status:'read',p_actor:getActor(c)});if(error)throw error;return c.json(data);}catch(error){return errorResponse(c,error,'Unable to mark all notifications read.');}
});

router.put('/preferences',async c=>{
  try{
    const body=await c.req.json<Row>(); const actor=getActor(c);
    if(!CHANNELS.has(String(body.channel))||!CATEGORIES.has(String(body.category))||!['immediate','digest','disabled'].includes(body.delivery_mode)) return apiError(c,400,'NOTIFICATION_PREFERENCE_INVALID','A supported channel, category, and delivery mode are required.');
    const windowValue=body.delivery_mode==='digest'?Number(body.digest_window_minutes||60):null;
    const{data,error}=await getDb(c.env).rpc('upsert_atlas_notification_preference',{p_principal_id:actor,p_channel:body.channel,p_category:body.category,p_delivery_mode:body.delivery_mode,p_digest_window_minutes:windowValue,p_actor:actor,p_expected_revision:Number.isSafeInteger(body.expected_revision)?body.expected_revision:null});if(error)throw error;return c.json(data);
  }catch(error){return errorResponse(c,error,'Unable to update notification preference.');}
});

router.post('/subscriptions',async c=>{
  try{
    const body=await c.req.json<Row>();const actor=getActor(c);if(!TARGETS.has(String(body.target_type))||typeof body.target_id!=='string'||!body.target_id) return apiError(c,400,'NOTIFICATION_SUBSCRIPTION_INVALID','A supported target is required.');
    const categories=Array.isArray(body.categories)?body.categories:['all'];const channels=Array.isArray(body.channels)?body.channels:['inbox'];
    if(categories.some((item:unknown)=>typeof item!=='string'||!CATEGORIES.has(item))||channels.some((item:unknown)=>typeof item!=='string'||!CHANNELS.has(item))) return apiError(c,400,'NOTIFICATION_SUBSCRIPTION_INVALID','Subscription categories or channels are invalid.');
    const supabase=getDb(c.env);const existing=await supabase.from('atlas_notification_subscriptions').select('*').eq('principal_id',actor).eq('target_type',body.target_type).eq('target_id',body.target_id).neq('status','archived').maybeSingle();if(existing.error)throw existing.error;
    const row={principal_id:actor,target_type:body.target_type,target_id:body.target_id,categories,channels,source:'manual',status:'active',created_by:actor,updated_by:actor,updated_at:new Date().toISOString()};
    const mutation=existing.data?supabase.from('atlas_notification_subscriptions').update({...row,revision:existing.data.revision+1}).eq('id',existing.data.id):supabase.from('atlas_notification_subscriptions').insert({id:uuidv4(),...row});
    const{data,error}=await mutation.select().single();if(error)throw error;return c.json(data,existing.data?200:201);
  }catch(error){return errorResponse(c,error,'Unable to create notification subscription.');}
});

router.post('/subscriptions/:id/:transition',async c=>{
  try{
    const transition=c.req.param('transition');if(!['follow','mute','archive'].includes(transition)) return apiError(c,400,'NOTIFICATION_SUBSCRIPTION_INVALID','Transition must be follow, mute, or archive.');
    const body=await c.req.json<Row>().catch(()=>({} as Row));const supabase=getDb(c.env);const actor=getActor(c);const{data:existing,error:loadError}=await supabase.from('atlas_notification_subscriptions').select('*').eq('id',c.req.param('id')).eq('principal_id',actor).single();if(loadError)throw loadError;if(Number.isSafeInteger(body.expected_revision)&&existing.revision!==body.expected_revision)return apiError(c,409,'REVISION_CONFLICT','The subscription changed.');
    const status=transition==='follow'?'active':transition==='mute'?'muted':'archived';const{data,error}=await supabase.from('atlas_notification_subscriptions').update({status,revision:existing.revision+1,updated_by:actor,updated_at:new Date().toISOString()}).eq('id',existing.id).select().single();if(error)throw error;return c.json(data);
  }catch(error){return errorResponse(c,error,'Unable to update notification subscription.');}
});

export default router;
