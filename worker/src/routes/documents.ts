import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import { Env, getDb } from '../db';
import { getActor } from '../utils/actors';
import { apiError } from '../utils/http';
import { sanitizeBody, validateStringLengths, parsePagination } from '../middleware/validate';
import { hasRequestScope } from '../middleware/authorize';
import { changeSummary, singleTextChange } from '../utils/documentCollaboration';
import { sha256Hex } from '../utils/integrations';

const router = new Hono<{ Bindings: Env }>();
type Row = Record<string, any>;
const CONTEXTS = new Set(['workspace', 'project', 'initiative', 'action', 'cycle']);

export function validateDocumentBody(body: Row, partial = false): string[] {
  const errors: string[] = [];
  if (!partial && (typeof body.title !== 'string' || !body.title.trim())) errors.push('title is required');
  if (body.title !== undefined && (typeof body.title !== 'string' || !body.title.trim() || body.title.length > 500)) errors.push('title must be 1-500 characters');
  if (body.content !== undefined && (typeof body.content !== 'string' || new TextEncoder().encode(body.content).byteLength > 204800)) errors.push('content must be Markdown text up to 200 KiB');
  const context = String(body.context_type || 'workspace');
  if (body.context_type !== undefined && !CONTEXTS.has(context)) errors.push('context_type is invalid');
  if (context === 'workspace' && body.context_id) errors.push('workspace documents cannot set context_id');
  if (!partial && context !== 'workspace' && !body.context_id) errors.push(`${context} documents require context_id`);
  return errors;
}

function documentError(c: any, error: { code?: string; message?: string }, fallback = 'Unable to change the document.') {
  const message = error.message || '';
  if (error.code === '40001' || message.includes('REVISION_CONFLICT')) return apiError(c, 409, 'REVISION_CONFLICT', 'The document changed. Refresh and retry.');
  if (error.code === 'P0002' || message.includes('NOT_FOUND')) return apiError(c, 404, 'DOCUMENT_NOT_FOUND', 'Document or version not found.');
  if (error.code === '42501' || message.includes('OWNER_REQUIRED')) return apiError(c, 403, 'OWNER_REQUIRED', 'Only the ATLAS owner can perform this document operation.');
  if (error.code === '55000' || message.includes('ARCHIVED')) return apiError(c, 409, 'DOCUMENT_ARCHIVED', 'Restore the document before editing it.');
  if (['22023','23514'].includes(String(error.code))) return apiError(c, 400, 'DOCUMENT_EDIT_INVALID', message || fallback);
  console.error(`[documents] RPC error: ${message || error.code || 'unknown'}`);
  return apiError(c, 500, 'DOCUMENT_OPERATION_FAILED', fallback);
}

async function broadcastDocument(env: Env, documentId: string, document: Row, actor: string) {
  if (!env.DOCUMENT_ROOM) return;
  const stub = env.DOCUMENT_ROOM.get(env.DOCUMENT_ROOM.idFromName(`document:${documentId}`));
  const headers = new Headers({ 'content-type':'application/json','x-atlas-document-id':documentId,'x-atlas-internal-action':'broadcast' });
  await stub.fetch(new Request('https://document-room.internal/broadcast',{method:'POST',headers,body:JSON.stringify({document,actor})}));
}

router.get('/', async c => {
  try {
    const { context_type, context_id, status, template_id, search } = c.req.query();
    let query = getDb(c.env).from('atlas_documents').select('*');
    if (context_type) query = query.eq('context_type', context_type);
    if (context_id) query = query.eq('context_id', context_id);
    if (template_id) query = query.eq('template_id', template_id);
    if (status) query = query.eq('status', status); else query = query.eq('status', 'active');
    if (search) { const term=String(search).replace(/[%_,()]/g,' ').slice(0,100); query=query.or(`title.ilike.%${term}%,content.ilike.%${term}%`); }
    const { limit, offset } = parsePagination(c.req.query() as Row);
    const { data, error, count } = await query.order('updated_at',{ascending:false}).range(offset,offset+limit-1);
    if (error) throw error;
    return c.json({items:data||[],total:count??(data||[]).length,page_size:limit,has_more:(data||[]).length===limit});
  } catch (error) { console.error(`[documents] list error: ${(error as Error).message}`); return apiError(c,500,'DOCUMENT_LIST_FAILED','Unable to load documents.'); }
});

router.post('/', async c => {
  try {
    const raw=await c.req.json<Row>().catch(()=>({} as Row));const body=sanitizeBody(raw,['title','icon','color']);const errors=[...validateDocumentBody(body),...validateStringLengths(body)];if(errors.length)return apiError(c,400,'INVALID_DOCUMENT',errors.join('; '));const actor=getActor(c);
    const{data,error}=await getDb(c.env).from('atlas_documents').insert({id:uuidv4(),title:String(body.title).trim(),content:body.content||'',context_type:body.context_type||'workspace',context_id:body.context_type&&body.context_type!=='workspace'?body.context_id:null,icon:body.icon||null,color:body.color||null,status:'active',revision:0,created_by:actor,updated_by:actor}).select().single();if(error)throw error;return c.json(data,201);
  } catch(error){console.error(`[documents] create error: ${(error as Error).message}`);return apiError(c,500,'DOCUMENT_CREATE_FAILED','Unable to create the document.');}
});

router.get('/:id/realtime', async c => {
  if (c.req.header('upgrade')?.toLowerCase()!=='websocket') return apiError(c,426,'WEBSOCKET_UPGRADE_REQUIRED','Use a WebSocket upgrade for realtime document collaboration.');
  if (!c.env.DOCUMENT_ROOM) return apiError(c,503,'DOCUMENT_REALTIME_UNAVAILABLE','Realtime document rooms are not configured.');
  const clientId=c.req.query('client_id')||'';if(!/^[A-Za-z0-9_.:-]{8,128}$/.test(clientId))return apiError(c,400,'DOCUMENT_CLIENT_ID_INVALID','client_id must be 8-128 safe characters.');
  const documentId=c.req.param('id');const actor=getActor(c);const headers=new Headers();headers.set('Upgrade','websocket');headers.set('x-atlas-document-id',documentId);headers.set('x-atlas-actor',actor);headers.set('x-atlas-client-id',clientId);headers.set('x-atlas-can-edit',String(hasRequestScope(c,'documents:write')));
  const stub=c.env.DOCUMENT_ROOM.get(c.env.DOCUMENT_ROOM.idFromName(`document:${documentId}`));
  return stub.fetch(new Request('https://document-room.internal/connect',{headers}));
});

router.post('/:id/revert', async c => {
  try {
    const body=await c.req.json<Row>().catch(()=>({} as Row));if(!Number.isSafeInteger(body.target_revision)||body.target_revision<0||!Number.isSafeInteger(body.expected_revision)||body.expected_revision<0)return apiError(c,400,'DOCUMENT_REVERT_INVALID','target_revision and expected_revision are required.');const actor=getActor(c);
    const{data,error}=await getDb(c.env).rpc('revert_atlas_document_version',{p_document_id:c.req.param('id'),p_target_revision:body.target_revision,p_operation_id:body.operation_id||uuidv4(),p_actor:actor,p_expected_revision:body.expected_revision});if(error)return documentError(c,error,'Unable to revert the document.');const document=data?.document||data;await broadcastDocument(c.env,c.req.param('id'),document,actor);return c.json(data);
  }catch(error){console.error(`[documents] revert error: ${(error as Error).message}`);return apiError(c,500,'DOCUMENT_REVERT_FAILED','Unable to revert the document.');}
});

router.get('/:id', async c => {
  try {
    const supabase=getDb(c.env);const id=c.req.param('id');const[document,versions,activity,operations,conflicts]=await Promise.all([
      supabase.from('atlas_documents').select('*').eq('id',id).maybeSingle(),
      supabase.from('atlas_document_versions').select('*').eq('document_id',id).order('revision',{ascending:false}).limit(100),
      supabase.from('atlas_document_activity_log').select('*').eq('document_id',id).order('created_at',{ascending:false}).limit(100),
      supabase.from('atlas_document_operations').select('*').eq('document_id',id).order('applied_revision',{ascending:false}).limit(100),
      supabase.from('atlas_document_conflicts').select('*').eq('document_id',id).order('created_at',{ascending:false}).limit(50),
    ]);for(const result of[document,versions,activity,operations,conflicts])if(result.error)throw result.error;if(!document.data)return apiError(c,404,'DOCUMENT_NOT_FOUND','Document not found.');return c.json({...document.data,versions:versions.data||[],activity:activity.data||[],operations:operations.data||[],conflicts:conflicts.data||[]});
  }catch(error){console.error(`[documents] detail error: ${(error as Error).message}`);return apiError(c,500,'DOCUMENT_LOAD_FAILED','Unable to load the document.');}
});

router.put('/:id', async c => {
  try {
    const raw=await c.req.json<Row>().catch(()=>({} as Row));if(!Number.isSafeInteger(raw.expected_revision)||raw.expected_revision<0)return apiError(c,400,'INVALID_REVISION','expected_revision must be a non-negative integer.');const errors=validateDocumentBody(raw,true);if(errors.length)return apiError(c,400,'INVALID_DOCUMENT',errors.join('; '));const supabase=getDb(c.env);const{data:existing,error:fetchError}=await supabase.from('atlas_documents').select('*').eq('id',c.req.param('id')).maybeSingle();if(fetchError)throw fetchError;if(!existing)return apiError(c,404,'DOCUMENT_NOT_FOUND','Document not found.');if(existing.status==='archived')return apiError(c,409,'DOCUMENT_ARCHIVED','Restore the document before editing it.');const actor=getActor(c);let document=existing;
    if(raw.title!==undefined||raw.content!==undefined){const title=raw.title??existing.title;const content=raw.content??existing.content;const baseHash=await sha256Hex(existing.content);const resultHash=await sha256Hex(content);const change=singleTextChange(existing.content,content);const rpc=await supabase.rpc('apply_atlas_document_realtime_edit',{p_document_id:existing.id,p_client_id:raw.client_id||'legacy-rest',p_operation_id:raw.operation_id||uuidv4(),p_base_revision:existing.revision,p_expected_revision:raw.expected_revision,p_title:title,p_content:content,p_base_content_sha256:baseHash,p_result_content_sha256:resultHash,p_merge_strategy:'legacy_rest',p_change_summary:changeSummary(change),p_selection:null,p_actor:actor});if(rpc.error)return documentError(c,rpc.error);document=rpc.data?.document||rpc.data;}
    const metadata:Row={};for(const field of['context_type','context_id','icon','color'])if(raw[field]!==undefined)metadata[field]=raw[field]===''?null:raw[field];if(Object.keys(metadata).length){metadata.revision=document.revision+1;metadata.updated_by=actor;metadata.updated_at=new Date().toISOString();const updated=await supabase.from('atlas_documents').update(metadata).eq('id',existing.id).eq('revision',document.revision).select().maybeSingle();if(updated.error)throw updated.error;if(!updated.data)return apiError(c,409,'REVISION_CONFLICT','The document changed. Refresh and retry.');document=updated.data;}
    if(document===existing)return apiError(c,400,'DOCUMENT_UPDATE_EMPTY','No document fields were provided.');await broadcastDocument(c.env,existing.id,document,actor);return c.json(document);
  }catch(error){console.error(`[documents] update error: ${(error as Error).message}`);return apiError(c,500,'DOCUMENT_UPDATE_FAILED','Unable to update the document.');}
});

async function transition(c:any,restore:boolean){const body=await c.req.json().catch(()=>({})) as Row;const actor=getActor(c);const{data,error}=await getDb(c.env).rpc('transition_atlas_document',{p_document_id:c.req.param('id'),p_restore:restore,p_actor:actor,p_expected_revision:body.expected_revision});if(error)return documentError(c,error);await broadcastDocument(c.env,c.req.param('id'),data,actor);return c.json(data);}
router.post('/:id/archive',c=>transition(c,false));router.post('/:id/restore',c=>transition(c,true));

export default router;
