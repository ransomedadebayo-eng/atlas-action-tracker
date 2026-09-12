import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import { Env, getDb } from '../db';
import { getActor } from '../utils/actors';
import { apiError } from '../utils/http';
import { validateKnownBusinessId } from '../utils/referenceData';
import { serializeJsonArray, serializeJsonObject } from '../utils/json';
import { sanitizeBody, validateStringLengths } from '../middleware/validate';

const router = new Hono<{ Bindings: Env }>();
type Row = Record<string, any>;
const TYPES = new Set(['action', 'project', 'document']);
const MODES = new Set(['standard', 'form']);
const SCOPES = new Set(['workspace', 'business']);
const AUDIENCES = new Set(['owner', 'intake', 'all']);
const FIELD_TYPES = new Set(['text', 'long_text', 'dropdown', 'checkboxes', 'date', 'instructions', 'title', 'priority', 'due_date', 'labels']);

export function validateTemplateNodes(nodes: unknown): string[] {
  if (nodes === undefined) return [];
  if (!Array.isArray(nodes)) return ['template nodes must be an array'];
  const errors: string[] = [];
  const keys = new Set<string>();
  for (const node of nodes) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) { errors.push('every template node must be an object'); continue; }
    const row = node as Row;
    if (typeof row.key !== 'string' || !row.key.trim() || keys.has(row.key)) errors.push('template node keys must be unique non-empty strings');
    else keys.add(row.key);
    if (typeof row.title !== 'string' || !row.title.trim()) errors.push('every template node requires a title');
  }
  for (const node of nodes as Row[]) if (node.parent_key && !keys.has(String(node.parent_key))) errors.push(`template node parent ${node.parent_key} does not exist`);
  const byKey = new Map((nodes as Row[]).map(node => [String(node.key), node]));
  for (const node of nodes as Row[]) {
    const seen = new Set<string>(); let current: Row | undefined = node; let depth = 0;
    while (current) { const key = String(current.key); if (seen.has(key)) { errors.push('template node graph must be acyclic'); break; } seen.add(key); depth += 1; if (depth > 5) { errors.push('template node graph cannot exceed five levels'); break; } current = current.parent_key ? byKey.get(String(current.parent_key)) : undefined; }
  }
  return Array.from(new Set(errors));
}

export function validateFormSchema(schema: unknown): string[] {
  if (!Array.isArray(schema)) return ['form_schema must be an array'];
  const errors: string[] = [];
  const keys = new Set<string>();
  for (const field of schema) {
    if (!field || typeof field !== 'object' || Array.isArray(field)) { errors.push('every form field must be an object'); continue; }
    const row = field as Row;
    if (typeof row.key !== 'string' || !row.key.trim() || keys.has(row.key)) errors.push('form field keys must be unique non-empty strings'); else keys.add(row.key);
    if (!FIELD_TYPES.has(String(row.type))) errors.push('form field type is invalid');
    if (['dropdown', 'checkboxes'].includes(String(row.type)) && (!Array.isArray(row.options) || row.options.length === 0 || !row.options.every((item: unknown) => typeof item === 'string'))) errors.push('dropdown and checkbox fields require string options');
  }
  return Array.from(new Set(errors));
}

export function validateTemplateBody(body: Row, partial = false): string[] {
  const errors: string[] = [];
  if (!partial && (typeof body.name !== 'string' || !body.name.trim())) errors.push('name is required');
  if (body.name !== undefined && (typeof body.name !== 'string' || !body.name.trim())) errors.push('name must be a non-empty string');
  const type = String(body.template_type || 'action'); const mode = String(body.mode || 'standard'); const scope = String(body.scope || 'workspace');
  if (body.template_type !== undefined && !TYPES.has(type)) errors.push('template_type is invalid');
  if (body.mode !== undefined && !MODES.has(mode)) errors.push('mode is invalid');
  if (mode === 'form' && type !== 'action') errors.push('form mode is available only for action templates');
  if (body.scope !== undefined && !SCOPES.has(scope)) errors.push('scope is invalid');
  if (scope === 'business' && !body.business) errors.push('business scope requires a business');
  if (scope === 'workspace' && body.business) errors.push('workspace templates cannot set a business');
  if (body.default_audience !== undefined && !AUDIENCES.has(String(body.default_audience))) errors.push('default_audience is invalid');
  const blueprint = body.blueprint;
  if (blueprint !== undefined && (!blueprint || typeof blueprint !== 'object' || Array.isArray(blueprint))) errors.push('blueprint must be an object');
  const config = blueprint && typeof blueprint === 'object' && !Array.isArray(blueprint) ? blueprint as Row : {};
  if (type === 'action') { if (mode === 'standard' && !String(config.title || '').trim()) errors.push('standard action templates require a title'); errors.push(...validateTemplateNodes(config.sub_actions)); }
  if (type === 'project') { if (!String(config.name || '').trim()) errors.push('project templates require a project name'); errors.push(...validateTemplateNodes(config.actions)); const milestoneKeys = new Set((Array.isArray(config.milestones) ? config.milestones : []).map((item: Row) => item.key)); for (const node of Array.isArray(config.actions) ? config.actions : []) if (node.milestone_key && !milestoneKeys.has(node.milestone_key)) errors.push(`milestone ${node.milestone_key} does not exist`); }
  if (type === 'document' && !String(config.title || '').trim()) errors.push('document templates require a title');
  if (body.form_schema !== undefined) errors.push(...validateFormSchema(body.form_schema));
  if (mode === 'form' && (!Array.isArray(body.form_schema) || body.form_schema.length === 0)) errors.push('form templates require at least one field');
  return Array.from(new Set(errors));
}

export function chooseDefaultTemplate(templates: Row[], type: string, business?: string | null, audience = 'owner') {
  const eligible = templates.filter(item => item.template_type === type && item.status === 'active' && item.is_default && [audience, 'all'].includes(item.default_audience));
  return eligible.find(item => business && item.scope === 'business' && item.business === business)
    || eligible.find(item => item.scope === 'workspace') || null;
}

function rpcError(c: any, error: { code?: string; message?: string; details?: string }, fallback: string) {
  const message = error.message || '';
  if (error.code === '40001' || message.includes('REVISION_CONFLICT')) return apiError(c, 409, 'REVISION_CONFLICT', 'The template or document changed. Refresh and retry.');
  if (error.code === 'P0002' || message.includes('NOT_FOUND')) return apiError(c, 404, 'TEMPLATE_REFERENCE_NOT_FOUND', 'The template or referenced work item was not found.');
  if (error.code === '55000' || message.includes('ARCHIVED')) return apiError(c, 409, 'TEMPLATE_ARCHIVED', 'Restore the template before using it.');
  if (['22023', '23503', '23505', '23514'].includes(String(error.code))) return apiError(c, 400, 'INVALID_TEMPLATE_OPERATION', error.details ? `${message}: ${error.details}` : message || fallback);
  console.error(`[templates] RPC error: ${message || error.code || 'unknown error'}`);
  return apiError(c, 500, 'TEMPLATE_OPERATION_FAILED', fallback);
}

router.get('/', async c => {
  try {
    const { template_type, status, business, mode, search } = c.req.query();
    let query = getDb(c.env).from('atlas_templates').select('*');
    if (template_type) query = query.eq('template_type', template_type);
    if (status) query = query.eq('status', status); else query = query.eq('status', 'active');
    if (mode) query = query.eq('mode', mode);
    if (search) query = query.ilike('name', `%${String(search).replace(/[%_,()]/g, ' ').slice(0, 100)}%`);
    const { data, error } = await query.order('template_type').order('name');
    if (error) throw error;
    const rows = business ? (data || []).filter(item => item.scope === 'workspace' || (item.scope === 'business' && item.business === business)) : (data || []);
    return c.json(rows);
  } catch (error) { console.error(`[templates] list error: ${(error as Error).message}`); return apiError(c, 500, 'TEMPLATE_LIST_FAILED', 'Unable to load templates.'); }
});

router.get('/default', async c => {
  try {
    const type = c.req.query('template_type') || 'action'; const business = c.req.query('business'); const audience = c.req.query('audience') || 'owner';
    const { data, error } = await getDb(c.env).from('atlas_templates').select('*').eq('status', 'active').eq('is_default', true).eq('template_type', type);
    if (error) throw error;
    return c.json(chooseDefaultTemplate((data || []) as Row[], type, business, audience));
  } catch (error) { console.error(`[templates] default error: ${(error as Error).message}`); return apiError(c, 500, 'TEMPLATE_DEFAULT_FAILED', 'Unable to load the default template.'); }
});

router.post('/', async c => {
  try {
    const raw = await c.req.json<Row>().catch(() => ({} as Row)); const body = sanitizeBody(raw, ['name', 'description', 'business']);
    const businessError = await validateKnownBusinessId(getDb(c.env), body.business); const errors = [...validateTemplateBody(body), ...validateStringLengths(body), ...(businessError ? [businessError] : [])];
    if (errors.length) return apiError(c, 400, 'INVALID_TEMPLATE', errors.join('; '));
    const actor = getActor(c); const { data, error } = await getDb(c.env).from('atlas_templates').insert({
      id: uuidv4(), name: String(body.name).trim(), description: body.description || '', template_type: body.template_type || 'action', mode: body.mode || 'standard', scope: body.scope || 'workspace', business: body.scope === 'business' ? body.business : null,
      default_audience: body.default_audience || 'owner', is_default: body.is_default === true, blueprint: serializeJsonObject(body.blueprint || {}), form_schema: serializeJsonArray(body.form_schema || []), created_by: actor, updated_by: actor,
    }).select().single();
    if (error?.code === '23505') return apiError(c, 409, 'TEMPLATE_DEFAULT_CONFLICT', 'Only one active default template is allowed for this type, business, and audience.');
    if (error) throw error; return c.json(data, 201);
  } catch (error) { console.error(`[templates] create error: ${(error as Error).message}`); return apiError(c, 500, 'TEMPLATE_CREATE_FAILED', 'Unable to create the template.'); }
});

router.get('/:id', async c => {
  try {
    const supabase = getDb(c.env); const [template, instances, activity] = await Promise.all([
      supabase.from('atlas_templates').select('*').eq('id', c.req.param('id')).maybeSingle(),
      supabase.from('atlas_template_instances').select('*').eq('template_id', c.req.param('id')).order('created_at', { ascending: false }).limit(100),
      supabase.from('atlas_template_activity_log').select('*').eq('template_id', c.req.param('id')).order('created_at', { ascending: false }).limit(100),
    ]); for (const result of [template, instances, activity]) if (result.error) throw result.error;
    if (!template.data) return apiError(c, 404, 'TEMPLATE_NOT_FOUND', 'Template not found.');
    return c.json({ ...template.data, instances: instances.data || [], activity: activity.data || [] });
  } catch (error) { console.error(`[templates] detail error: ${(error as Error).message}`); return apiError(c, 500, 'TEMPLATE_LOAD_FAILED', 'Unable to load the template.'); }
});

router.put('/:id', async c => {
  try {
    const raw = await c.req.json<Row>().catch(() => ({} as Row)); if (!Number.isSafeInteger(raw.expected_revision) || raw.expected_revision < 0) return apiError(c, 400, 'INVALID_REVISION', 'expected_revision must be a non-negative integer.');
    const supabase = getDb(c.env); const { data: existing, error: fetchError } = await supabase.from('atlas_templates').select('*').eq('id', c.req.param('id')).maybeSingle(); if (fetchError) throw fetchError; if (!existing) return apiError(c, 404, 'TEMPLATE_NOT_FOUND', 'Template not found.'); if (existing.status === 'archived') return apiError(c, 409, 'TEMPLATE_ARCHIVED', 'Restore the template before editing it.');
    const candidate = { ...existing, ...raw }; const errors = validateTemplateBody(candidate, true); if (errors.length) return apiError(c, 400, 'INVALID_TEMPLATE', errors.join('; '));
    const updates: Row = {}; for (const field of ['name', 'description', 'template_type', 'mode', 'scope', 'business', 'default_audience', 'is_default']) if (raw[field] !== undefined) updates[field] = raw[field] === '' ? null : raw[field];
    if (raw.blueprint !== undefined) updates.blueprint = serializeJsonObject(raw.blueprint); if (raw.form_schema !== undefined) updates.form_schema = serializeJsonArray(raw.form_schema); updates.revision = existing.revision + 1; updates.updated_by = getActor(c); updates.updated_at = new Date().toISOString();
    const { data, error } = await supabase.from('atlas_templates').update(updates).eq('id', existing.id).eq('revision', raw.expected_revision).select().maybeSingle(); if (error?.code === '23505') return apiError(c, 409, 'TEMPLATE_DEFAULT_CONFLICT', 'Only one active default template is allowed for this type, business, and audience.'); if (error) throw error; if (!data) return apiError(c, 409, 'REVISION_CONFLICT', 'The template changed. Refresh and retry.'); return c.json(data);
  } catch (error) { console.error(`[templates] update error: ${(error as Error).message}`); return apiError(c, 500, 'TEMPLATE_UPDATE_FAILED', 'Unable to update the template.'); }
});

async function callRpc(c: any, name: string, args: Row, fallback: string) { try { const { data, error } = await getDb(c.env).rpc(name, args); if (error) return rpcError(c, error, fallback); return c.json(data); } catch (error) { console.error(`[templates] ${name} error: ${(error as Error).message}`); return apiError(c, 500, 'TEMPLATE_OPERATION_FAILED', fallback); } }

router.post('/:id/instantiate', async c => { const body = await c.req.json<Row>().catch(() => ({} as Row)); return callRpc(c, 'instantiate_atlas_template', { p_template_id: c.req.param('id'), p_title_override: body.title_override || null, p_business: body.business || null, p_context_type: body.context_type || null, p_context_id: body.context_id || null, p_form_values: serializeJsonObject(body.form_values || {}), p_overrides: serializeJsonObject(body.overrides || {}), p_actor: getActor(c) }, 'Unable to instantiate the template.'); });
router.post('/:id/archive', async c => { const body = await c.req.json<Row>().catch(() => ({} as Row)); return callRpc(c, 'transition_atlas_template', { p_template_id: c.req.param('id'), p_restore: false, p_actor: getActor(c), p_expected_revision: body.expected_revision }, 'Unable to archive the template.'); });
router.post('/:id/restore', async c => { const body = await c.req.json<Row>().catch(() => ({} as Row)); return callRpc(c, 'transition_atlas_template', { p_template_id: c.req.param('id'), p_restore: true, p_actor: getActor(c), p_expected_revision: body.expected_revision }, 'Unable to restore the template.'); });
router.post('/:id/duplicate', async c => { const body = await c.req.json<Row>().catch(() => ({} as Row)); return callRpc(c, 'duplicate_atlas_template', { p_template_id: c.req.param('id'), p_new_template_id: uuidv4(), p_name: body.name || null, p_actor: getActor(c) }, 'Unable to duplicate the template.'); });

export default router;
