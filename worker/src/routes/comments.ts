import { Hono } from 'hono';
import { Env, getDb } from '../db';
import { getActor } from '../utils/actors';
import { apiError } from '../utils/http';
import { serializeJsonArray, serializeJsonObject } from '../utils/json';

const router = new Hono<{ Bindings: Env }>();
type Row = Record<string, any>;
const TARGETS = new Set(['action','project','initiative','document','project_update','initiative_update']);
const REACTION_TARGETS = new Set([...TARGETS, 'comment']);
const PRINCIPALS = new Set(['ransomed','codex','claude']);

export function validateAttachment(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Row;
  if (typeof row.title !== 'string' || !row.title.trim() || typeof row.url !== 'string') return false;
  try { const url = new URL(row.url); if (url.protocol !== 'https:') return false; } catch { return false; }
  return row.size_bytes === undefined || (Number.isSafeInteger(row.size_bytes) && row.size_bytes >= 0);
}

export function validateAnchor(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Row;
  if (typeof row.field !== 'string' || !row.field.trim() || typeof row.quote !== 'string' || !row.quote) return false;
  if (row.start !== undefined && (!Number.isSafeInteger(row.start) || row.start < 0)) return false;
  if (row.end !== undefined && (!Number.isSafeInteger(row.end) || row.end < (row.start || 0))) return false;
  if (row.source_revision !== undefined && (!Number.isSafeInteger(row.source_revision) || row.source_revision < 0)) return false;
  return true;
}

export function validateCommentBody(body: Row): string[] {
  const errors: string[] = [];
  if (typeof body.body !== 'string' || !body.body.trim() || body.body.length > 20000) errors.push('body must be 1-20000 characters');
  if (body.mentions !== undefined && (!Array.isArray(body.mentions) || new Set(body.mentions).size !== body.mentions.length || !body.mentions.every((item: unknown) => typeof item === 'string' && PRINCIPALS.has(item)))) errors.push('mentions must contain unique canonical principals');
  if (body.attachments !== undefined && (!Array.isArray(body.attachments) || body.attachments.length > 20 || !body.attachments.every(validateAttachment))) errors.push('attachments must be up to 20 titled HTTPS resources with valid size metadata');
  if (!validateAnchor(body.anchor)) errors.push('anchor must contain field, quote, valid offsets, and optional source revision');
  return errors;
}

function reactionGroups(reactions: Row[], targetType: string, targetId: string) {
  const groups = new Map<string, string[]>();
  for (const reaction of reactions.filter(item => item.status === 'active' && item.target_type === targetType && item.target_id === targetId)) {
    if (!groups.has(reaction.emoji)) groups.set(reaction.emoji, []);
    groups.get(reaction.emoji)?.push(reaction.actor);
  }
  return Array.from(groups.entries()).map(([emoji, actors]) => ({ emoji, count: actors.length, actors: actors.sort() })).sort((a, b) => a.emoji.localeCompare(b.emoji));
}

export function buildDiscussion(comments: Row[], reactions: Row[], actor: string) {
  const activeAndArchived = [...comments].sort((a,b) => String(a.created_at).localeCompare(String(b.created_at)));
  const roots = activeAndArchived.filter(item => !item.thread_root_id);
  return {
    threads: roots.map(root => ({
      ...root,
      reactions: reactionGroups(reactions, 'comment', root.id),
      replies: activeAndArchived.filter(item => item.thread_root_id === root.id).map(reply => ({ ...reply, reactions: reactionGroups(reactions, 'comment', reply.id), reacted_by_actor: reactions.filter(item => item.status === 'active' && item.target_type === 'comment' && item.target_id === reply.id && item.actor === actor).map(item => item.emoji) })),
      reacted_by_actor: reactions.filter(item => item.status === 'active' && item.target_type === 'comment' && item.target_id === root.id && item.actor === actor).map(item => item.emoji),
    })),
  };
}

function rpcError(c: any, error: { code?: string; message?: string; details?: string }, fallback: string) {
  const message = error.message || '';
  if (error.code === '40001' || message.includes('REVISION_CONFLICT')) return apiError(c,409,'REVISION_CONFLICT','The comment changed. Refresh and retry.');
  if (error.code === '42501' || message.includes('AUTHOR_REQUIRED')) return apiError(c,403,'COMMENT_AUTHOR_REQUIRED','Only the comment author or owner can change it.');
  if (error.code === 'P0002' || message.includes('NOT_FOUND')) return apiError(c,404,'COMMENT_REFERENCE_NOT_FOUND','The comment or target was not found.');
  if (error.code === '55000' || message.includes('ARCHIVED')) return apiError(c,409,'COMMENT_ARCHIVED','Restore the comment before changing it.');
  if (['22023','23503','23514'].includes(String(error.code))) return apiError(c,400,'INVALID_COMMENT_OPERATION',error.details ? `${message}: ${error.details}` : message || fallback);
  console.error(`[comments] RPC error: ${message || error.code || 'unknown error'}`);
  return apiError(c,500,'COMMENT_OPERATION_FAILED',fallback);
}

async function callRpc(c: any, name: string, args: Row, fallback: string) {
  try { const { data,error } = await getDb(c.env).rpc(name,args); if (error) return rpcError(c,error,fallback); return c.json(data); }
  catch (error) { console.error(`[comments] ${name} error: ${(error as Error).message}`); return apiError(c,500,'COMMENT_OPERATION_FAILED',fallback); }
}

router.get('/', async c => {
  try {
    const targetType = c.req.query('target_type') || ''; const targetId = c.req.query('target_id') || '';
    if (!TARGETS.has(targetType) || !targetId) return apiError(c,400,'INVALID_COMMENT_TARGET','target_type and target_id are required.');
    const supabase = getDb(c.env); const { data: comments,error } = await supabase.from('atlas_comments').select('*').eq('target_type',targetType).eq('target_id',targetId).order('created_at'); if (error) throw error;
    const commentIds = (comments || []).map(item => item.id); let reactions: Row[] = [];
    const targetReactions = await supabase.from('atlas_reactions').select('*').eq('target_type',targetType).eq('target_id',targetId); if (targetReactions.error) throw targetReactions.error; reactions.push(...(targetReactions.data || []));
    if (commentIds.length) { const commentReactions = await supabase.from('atlas_reactions').select('*').eq('target_type','comment').in('target_id',commentIds); if (commentReactions.error) throw commentReactions.error; reactions.push(...(commentReactions.data || [])); }
    const actor = getActor(c); const subscription = await supabase.from('atlas_discussion_subscriptions').select('*').eq('target_type',targetType).eq('target_id',targetId).eq('principal_id',actor).maybeSingle(); if (subscription.error) throw subscription.error;
    return c.json({ target_type: targetType,target_id: targetId,current_actor:actor,target_reactions: reactionGroups(reactions,targetType,targetId),target_reacted_by_actor: reactions.filter(item => item.status==='active' && item.target_type===targetType && item.target_id===targetId && item.actor===actor).map(item => item.emoji),subscription: subscription.data || null,...buildDiscussion((comments || []) as Row[],reactions,actor) });
  } catch (error) { console.error(`[comments] load error: ${(error as Error).message}`); return apiError(c,500,'COMMENT_LOAD_FAILED','Unable to load the discussion.'); }
});

router.post('/', async c => {
  const body = await c.req.json<Row>().catch(() => ({} as Row)); if (!TARGETS.has(String(body.target_type)) || typeof body.target_id !== 'string' || !body.target_id) return apiError(c,400,'INVALID_COMMENT_TARGET','A supported target_type and target_id are required.'); const errors = validateCommentBody(body); if (errors.length) return apiError(c,400,'INVALID_COMMENT',errors.join('; '));
  return callRpc(c,'create_atlas_comment',{ p_target_type:body.target_type,p_target_id:body.target_id,p_parent_comment_id:body.parent_comment_id||null,p_body:body.body,p_mentions:serializeJsonArray(body.mentions||[]),p_attachments:serializeJsonArray(body.attachments||[]),p_anchor:body.anchor?serializeJsonObject(body.anchor):null,p_actor:getActor(c) },'Unable to post the comment.');
});

router.post('/reactions/toggle', async c => { const body=await c.req.json<Row>().catch(() => ({} as Row)); if (!REACTION_TARGETS.has(String(body.target_type)) || typeof body.target_id!=='string' || typeof body.emoji!=='string' || !body.emoji || body.emoji.length>32 || /\s/.test(body.emoji)) return apiError(c,400,'INVALID_REACTION','A supported target and compact Unicode emoji are required.'); return callRpc(c,'toggle_atlas_reaction',{p_target_type:body.target_type,p_target_id:body.target_id,p_emoji:body.emoji,p_actor:getActor(c)},'Unable to toggle the reaction.'); });
router.post('/subscription', async c => { const body=await c.req.json<Row>().catch(() => ({} as Row)); if (!TARGETS.has(String(body.target_type)) || typeof body.target_id!=='string' || !['active','muted'].includes(body.status)) return apiError(c,400,'INVALID_SUBSCRIPTION','A supported target and active or muted status are required.'); return callRpc(c,'set_atlas_discussion_subscription',{p_target_type:body.target_type,p_target_id:body.target_id,p_status:body.status,p_actor:getActor(c)},'Unable to update the subscription.'); });

router.put('/:id', async c => { const body=await c.req.json<Row>().catch(() => ({} as Row)); const errors=validateCommentBody(body); if (errors.length) return apiError(c,400,'INVALID_COMMENT',errors.join('; ')); if (!Number.isSafeInteger(body.expected_revision)) return apiError(c,400,'INVALID_REVISION','expected_revision is required.'); return callRpc(c,'update_atlas_comment',{p_comment_id:c.req.param('id'),p_body:body.body,p_mentions:serializeJsonArray(body.mentions||[]),p_attachments:serializeJsonArray(body.attachments||[]),p_actor:getActor(c),p_expected_revision:body.expected_revision},'Unable to update the comment.'); });
router.post('/:id/archive', async c => { const body=await c.req.json<Row>().catch(() => ({} as Row)); return callRpc(c,'transition_atlas_comment',{p_comment_id:c.req.param('id'),p_restore:false,p_actor:getActor(c),p_expected_revision:body.expected_revision},'Unable to archive the comment.'); });
router.post('/:id/restore', async c => { const body=await c.req.json<Row>().catch(() => ({} as Row)); return callRpc(c,'transition_atlas_comment',{p_comment_id:c.req.param('id'),p_restore:true,p_actor:getActor(c),p_expected_revision:body.expected_revision},'Unable to restore the comment.'); });
router.post('/:id/resolve', async c => { const body=await c.req.json<Row>().catch(() => ({} as Row)); return callRpc(c,'resolve_atlas_comment_thread',{p_root_comment_id:c.req.param('id'),p_resolution_comment_id:body.resolution_comment_id||null,p_resolved:true,p_actor:getActor(c),p_expected_revision:body.expected_revision},'Unable to resolve the thread.'); });
router.post('/:id/reopen', async c => { const body=await c.req.json<Row>().catch(() => ({} as Row)); return callRpc(c,'resolve_atlas_comment_thread',{p_root_comment_id:c.req.param('id'),p_resolution_comment_id:null,p_resolved:false,p_actor:getActor(c),p_expected_revision:body.expected_revision},'Unable to reopen the thread.'); });

export default router;
