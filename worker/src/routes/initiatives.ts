import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import { Env, getDb } from '../db';
import { sanitizeBody, validateStringLengths, parsePagination } from '../middleware/validate';
import { validateKnownBusinessId, validateKnownMemberIds } from '../utils/referenceData';
import { serializeJsonArray } from '../utils/json';
import { buildSafeIlikePattern } from '../utils/search';
import { getActor } from '../utils/actors';
import { apiError } from '../utils/http';
import { calculateProjectProgress } from './projects';

const router = new Hono<{ Bindings: Env }>();
type Row = Record<string, any>;

const STATUSES = new Set(['proposed', 'planned', 'active', 'completed', 'canceled', 'archived']);
const HEALTH = new Set(['on_track', 'at_risk', 'off_track', 'no_update']);
const PRIORITIES = new Set(['p0', 'p1', 'p2', 'p3']);
const FREQUENCIES = new Set(['daily', 'weekly', 'biweekly', 'monthly', 'never']);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TEXT_FIELDS = ['name', 'summary', 'description', 'business', 'status', 'health', 'priority', 'owner_id', 'color', 'icon', 'update_frequency'];
const MUTABLE_FIELDS = ['name', 'summary', 'description', 'business', 'status', 'priority', 'owner_id', 'labels', 'start_date', 'target_date', 'color', 'icon', 'update_frequency'];

export function validateInitiativeResourceBody(body: Row): string | null {
  const resourceType = body.resource_type || 'link';
  if (resourceType === 'link') {
    if (typeof body.url !== 'string' || !body.url.trim() || body.url.length > 2048 || body.document_ref) return 'A bounded HTTPS URL is required for link resources.';
    try {
      const url = new URL(body.url.trim());
      if (url.protocol !== 'https:' || url.username || url.password) return 'Link resources must use HTTPS without embedded credentials.';
    } catch {
      return 'Link resources must use a valid HTTPS URL.';
    }
    return null;
  }
  if (resourceType === 'document') {
    if (body.url || typeof body.document_ref !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(body.document_ref)) return 'Document resources require a safe internal document identifier.';
    return null;
  }
  return 'resource_type must be link or document.';
}

function validDate(value: unknown) {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function validateInitiativeBody(body: Row, partial = false): string[] {
  const errors: string[] = [];
  if (!partial && (typeof body.name !== 'string' || !body.name.trim())) errors.push('name is required');
  if (body.name !== undefined && (typeof body.name !== 'string' || !body.name.trim())) errors.push('name must be a non-empty string');
  if (body.status !== undefined && !STATUSES.has(String(body.status))) errors.push('status is invalid');
  if (body.health !== undefined && !HEALTH.has(String(body.health))) errors.push('health is invalid');
  if (body.priority !== undefined && body.priority !== null && body.priority !== '' && !PRIORITIES.has(String(body.priority))) errors.push('priority is invalid');
  if (body.update_frequency !== undefined && !FREQUENCIES.has(String(body.update_frequency))) errors.push('update_frequency is invalid');
  if (body.owner_id !== undefined && body.owner_id !== null && body.owner_id !== '' && typeof body.owner_id !== 'string') errors.push('owner_id must be a member id or null');
  if (body.labels !== undefined && (!Array.isArray(body.labels) || !body.labels.every((label: unknown) => typeof label === 'string' && label.trim()))) errors.push('labels must be an array of non-empty strings');
  for (const field of ['start_date', 'target_date']) {
    if (body[field] !== undefined && body[field] !== null && body[field] !== '' && !validDate(body[field])) errors.push(`${field} must be a valid YYYY-MM-DD date or null`);
  }
  if (validDate(body.start_date) && validDate(body.target_date) && String(body.start_date) > String(body.target_date)) errors.push('start_date must not be after target_date');
  return errors;
}

export function descendantInitiativeIds(rootId: string, relations: Row[]): Set<string> {
  const children = new Map<string, string[]>();
  for (const relation of relations.filter(item => item.status === 'active')) {
    const parent = String(relation.parent_initiative_id);
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent)?.push(String(relation.child_initiative_id));
  }
  const result = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length) {
    const id = queue.shift() as string;
    for (const child of children.get(id) || []) if (!result.has(child)) { result.add(child); queue.push(child); }
  }
  return result;
}

export function initiativeProjectIds(rootId: string, relations: Row[], memberships: Row[]): Set<string> {
  const initiatives = descendantInitiativeIds(rootId, relations);
  return new Set(memberships
    .filter(item => item.status === 'active' && initiatives.has(String(item.initiative_id)))
    .map(item => String(item.project_id)));
}

export function calculateInitiativeRollup(projects: Row[], actions: Row[]) {
  const projectIds = new Set(projects.map(project => String(project.id)));
  const scopedActions = actions.filter(action => projectIds.has(String(action.project_id)));
  const progress = calculateProjectProgress(scopedActions);
  const health = { on_track: 0, at_risk: 0, off_track: 0, no_update: 0 } as Record<string, number>;
  for (const project of projects) health[String(project.health) in health ? String(project.health) : 'no_update'] += 1;
  return {
    total_projects: projects.length,
    active_projects: projects.filter(project => ['backlog', 'planned', 'in_progress', 'paused'].includes(String(project.status))).length,
    completed_projects: projects.filter(project => project.status === 'completed').length,
    project_health: health,
    ...progress,
  };
}

function pacificWeekStart(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return null;
  const pacific = new Date(date.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  const weekday = pacific.getDay();
  pacific.setDate(pacific.getDate() - weekday);
  return `${pacific.getFullYear()}-${String(pacific.getMonth() + 1).padStart(2, '0')}-${String(pacific.getDate()).padStart(2, '0')}`;
}

export function buildInitiativeGraph(projects: Row[], actions: Row[]) {
  const projectById = new Map(projects.map(project => [String(project.id), project]));
  const counts = new Map<string, Map<string, number>>();
  for (const action of actions) {
    if (!action.completed_at || !projectById.has(String(action.project_id))) continue;
    const week = pacificWeekStart(String(action.completed_at));
    if (!week) continue;
    const projectId = String(action.project_id);
    if (!counts.has(projectId)) counts.set(projectId, new Map());
    counts.get(projectId)?.set(week, (counts.get(projectId)?.get(week) || 0) + 1);
  }
  return projects.map(project => ({
    project_id: project.id,
    project_name: project.name,
    points: Array.from(counts.get(String(project.id)) || []).sort(([a], [b]) => a.localeCompare(b)).map(([week_start, completed_issues]) => ({ week_start, completed_issues })),
  }));
}

function initiativeRpcError(c: Parameters<typeof apiError>[0], error: { code?: string; message?: string }, fallbackCode: string, fallbackMessage: string) {
  const message = error.message || '';
  if (error.code === '40001' || message.includes('REVISION_CONFLICT')) return apiError(c, 409, 'REVISION_CONFLICT', 'The initiative changed. Refresh and retry.');
  if (error.code === 'P0002' || message.includes('NOT_FOUND')) return apiError(c, 404, 'INITIATIVE_REFERENCE_NOT_FOUND', 'The initiative, project, parent, or resource was not found.');
  if (error.code === '23514' || error.code === '22023' || error.code === '23505') return apiError(c, 400, 'INVALID_INITIATIVE_OPERATION', message || fallbackMessage);
  if (error.code === '55000' || message.includes('ARCHIVED')) return apiError(c, 409, 'INITIATIVE_ARCHIVED', 'Restore the initiative before changing it.');
  console.error(`[initiatives] RPC error: ${message || error.code || 'unknown error'}`);
  return apiError(c, 500, fallbackCode, fallbackMessage);
}

async function loadStrategicData(supabase: ReturnType<typeof getDb>) {
  const [initiatives, relations, memberships, projects, actions, updates] = await Promise.all([
    supabase.from('atlas_initiatives').select('*'),
    supabase.from('atlas_initiative_relations').select('*').eq('status', 'active'),
    supabase.from('atlas_initiative_projects').select('*').eq('status', 'active'),
    supabase.from('atlas_projects').select('*').neq('status', 'archived'),
    supabase.from('atlas_actions').select('id,project_id,status,estimate_points,completed_at').not('project_id', 'is', null),
    supabase.from('atlas_initiative_updates').select('*').order('created_at', { ascending: false }),
  ]);
  for (const result of [initiatives, relations, memberships, projects, actions, updates]) if (result.error) throw result.error;
  return {
    initiatives: (initiatives.data || []) as Row[], relations: (relations.data || []) as Row[], memberships: (memberships.data || []) as Row[],
    projects: (projects.data || []) as Row[], actions: (actions.data || []) as Row[], updates: (updates.data || []) as Row[],
  };
}

function hydrateInitiative(initiative: Row, data: Awaited<ReturnType<typeof loadStrategicData>>): Row {
  const id = String(initiative.id);
  const projectIds = initiativeProjectIds(id, data.relations, data.memberships);
  const recursiveProjects = data.projects.filter(project => projectIds.has(String(project.id)));
  const directProjectIds = new Set(data.memberships.filter(item => item.initiative_id === id).map(item => String(item.project_id)));
  const byId = new Map(data.initiatives.map(item => [String(item.id), item]));
  const parents = data.relations.filter(item => item.child_initiative_id === id).map(item => byId.get(String(item.parent_initiative_id))).filter((item): item is Row => Boolean(item));
  const children = data.relations.filter(item => item.parent_initiative_id === id).map(item => byId.get(String(item.child_initiative_id))).filter((item): item is Row => Boolean(item));
  return {
    ...initiative,
    parents,
    children,
    direct_projects: data.projects.filter(project => directProjectIds.has(String(project.id))),
    projects: recursiveProjects,
    rollup: calculateInitiativeRollup(recursiveProjects, data.actions),
    latest_update: data.updates.find(update => update.initiative_id === id) || null,
  };
}

function sortInitiatives(items: Row[], sortBy = 'updated_at', sortDir = 'desc') {
  const priority = (value: unknown) => ({ p0: 0, p1: 1, p2: 2, p3: 3 } as Row)[String(value)] ?? 4;
  const direction = sortDir === 'asc' ? 1 : -1;
  return [...items].sort((a, b) => {
    let value = 0;
    if (sortBy === 'priority') value = priority(a.priority) - priority(b.priority) || Number(a.sort_order || 0) - Number(b.sort_order || 0);
    else if (sortBy === 'manual') value = Number(a.sort_order || 0) - Number(b.sort_order || 0);
    else value = String(a[sortBy] ?? 'zzzz').localeCompare(String(b[sortBy] ?? 'zzzz'));
    return value * direction;
  });
}

router.get('/', async c => {
  try {
    const data = await loadStrategicData(getDb(c.env));
    const { status, business, health, owner_id, priority, label, search, parent_id, sort_by, sort_dir } = c.req.query() as Row;
    let items = data.initiatives.filter(item => status ? String(status).split(',').includes(String(item.status)) : item.status !== 'archived').map(item => hydrateInitiative(item, data));
    if (business) items = items.filter(item => item.business === business);
    if (health) items = items.filter(item => item.health === health);
    if (owner_id) items = items.filter(item => item.owner_id === owner_id);
    if (priority) items = items.filter(item => item.priority === priority);
    if (label) items = items.filter(item => Array.isArray(item.labels) && item.labels.some((itemLabel: string) => itemLabel.toLowerCase() === String(label).toLowerCase()));
    if (parent_id === '__root__') items = items.filter(item => item.parents.length === 0);
    else if (parent_id) items = items.filter(item => item.parents.some((parent: Row) => parent.id === parent_id));
    const pattern = buildSafeIlikePattern(search)?.replaceAll('%', '').toLowerCase();
    if (pattern) items = items.filter(item => [item.name, item.summary, item.description].some(value => String(value || '').toLowerCase().includes(pattern)));
    const allowedSorts = new Set(['manual', 'priority', 'status', 'health', 'name', 'start_date', 'target_date', 'created_at', 'updated_at']);
    const sorted = sortInitiatives(items, allowedSorts.has(sort_by) ? sort_by : 'updated_at', sort_dir || 'desc');
    const { limit, offset } = parsePagination(c.req.query() as Row);
    const page = sorted.slice(offset, offset + limit);
    return c.json({ items: page, total: sorted.length, page_size: limit, has_more: offset + page.length < sorted.length, as_of: new Date().toISOString() });
  } catch (error) {
    console.error(`[initiatives] list error: ${(error as Error).message}`);
    return apiError(c, 500, 'INITIATIVE_LIST_FAILED', 'Unable to load initiatives.');
  }
});

router.post('/', async c => {
  try {
    const raw = await c.req.json<Row>().catch(() => ({} as Row));
    const body = sanitizeBody(raw, TEXT_FIELDS);
    const supabase = getDb(c.env);
    const owner = body.owner_id ? [body.owner_id] : [];
    const businessError = await validateKnownBusinessId(supabase, body.business);
    const errors = [...validateInitiativeBody(body), ...validateStringLengths(body), ...(await validateKnownMemberIds(supabase, owner, 'owner_id')), ...(businessError ? [businessError] : [])];
    if (errors.length) return apiError(c, 400, 'INVALID_INITIATIVE', errors.join('; '));
    const actor = getActor(c);
    const { data, error } = await supabase.from('atlas_initiatives').insert({
      id: uuidv4(), name: String(body.name).trim(), summary: body.summary || '', description: body.description || '', business: body.business || null,
      status: body.status || 'planned', priority: body.priority || null, owner_id: owner[0] || 'ransomed', labels: serializeJsonArray(body.labels || []),
      start_date: body.start_date || null, target_date: body.target_date || null, color: body.color || null, icon: body.icon || null,
      update_frequency: body.update_frequency || 'weekly', created_by: actor, updated_by: actor,
    }).select().single();
    if (error) throw error;
    return c.json(data, 201);
  } catch (error) {
    console.error(`[initiatives] create error: ${(error as Error).message}`);
    return apiError(c, 500, 'INITIATIVE_CREATE_FAILED', 'Unable to create the initiative.');
  }
});

router.get('/:id/graph', async c => {
  try {
    const data = await loadStrategicData(getDb(c.env));
    const initiative = data.initiatives.find(item => item.id === c.req.param('id'));
    if (!initiative) return apiError(c, 404, 'INITIATIVE_NOT_FOUND', 'Initiative not found.');
    const projectIds = initiativeProjectIds(String(initiative.id), data.relations, data.memberships);
    const weeks = Math.min(Math.max(Number.parseInt(c.req.query('weeks') || '26', 10) || 26, 4), 104);
    const cutoff = Date.now() - weeks * 7 * 86400000;
    return c.json({
      initiative_id: initiative.id,
      weeks,
      series: buildInitiativeGraph(data.projects.filter(item => projectIds.has(String(item.id))), data.actions.filter(item => item.completed_at && new Date(item.completed_at).valueOf() >= cutoff)),
    });
  } catch (error) {
    console.error(`[initiatives] graph error: ${(error as Error).message}`);
    return apiError(c, 500, 'INITIATIVE_GRAPH_FAILED', 'Unable to load initiative graph.');
  }
});

router.get('/:id', async c => {
  try {
    const supabase = getDb(c.env);
    const data = await loadStrategicData(supabase);
    const initiative = data.initiatives.find(item => item.id === c.req.param('id'));
    if (!initiative) return apiError(c, 404, 'INITIATIVE_NOT_FOUND', 'Initiative not found.');
    const aggregate = hydrateInitiative(initiative, data);
    const descendantIds = descendantInitiativeIds(String(initiative.id), data.relations);
    const projectIds = initiativeProjectIds(String(initiative.id), data.relations, data.memberships);
    const [resources, activity, projectUpdates] = await Promise.all([
      supabase.from('atlas_initiative_resources').select('*').eq('initiative_id', initiative.id).eq('status', 'active').order('title'),
      supabase.from('atlas_initiative_activity_log').select('*').eq('initiative_id', initiative.id).order('created_at', { ascending: false }).limit(200),
      projectIds.size ? supabase.from('atlas_project_updates').select('*').in('project_id', Array.from(projectIds)).order('created_at', { ascending: false }) : Promise.resolve({ data: [], error: null }),
    ]);
    for (const result of [resources, activity, projectUpdates]) if (result.error) throw result.error;
    const initiativeUpdates: Row[] = data.updates.filter(update => descendantIds.has(String(update.initiative_id))).map(update => ({ ...update, source_type: 'initiative' } as Row));
    const projectUpdateRows: Row[] = ((projectUpdates.data || []) as Row[]).map(update => ({ ...update, source_type: 'project' } as Row));
    const combinedUpdates: Row[] = [...initiativeUpdates, ...projectUpdateRows]
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    return c.json({ ...aggregate, resources: resources.data || [], updates: data.updates.filter(update => update.initiative_id === initiative.id), combined_updates: combinedUpdates, activity: activity.data || [] });
  } catch (error) {
    console.error(`[initiatives] detail error: ${(error as Error).message}`);
    return apiError(c, 500, 'INITIATIVE_LOAD_FAILED', 'Unable to load the initiative.');
  }
});

router.put('/:id', async c => {
  try {
    const raw = await c.req.json<Row>().catch(() => ({} as Row));
    if (!Number.isSafeInteger(raw.expected_revision) || Number(raw.expected_revision) < 0) return apiError(c, 400, 'INVALID_REVISION', 'expected_revision must be a non-negative integer.');
    const body = sanitizeBody(raw, TEXT_FIELDS);
    if (body.status === 'archived') return apiError(c, 400, 'INITIATIVE_TRANSITION_REQUIRED', 'Use the archive endpoint.');
    const supabase = getDb(c.env);
    const { data: existing, error: fetchError } = await supabase.from('atlas_initiatives').select('*').eq('id', c.req.param('id')).maybeSingle();
    if (fetchError) throw fetchError;
    if (!existing) return apiError(c, 404, 'INITIATIVE_NOT_FOUND', 'Initiative not found.');
    if (existing.status === 'archived') return apiError(c, 409, 'INITIATIVE_ARCHIVED', 'Restore the initiative before editing it.');
    const owner = body.owner_id ? [body.owner_id] : [];
    const businessError = await validateKnownBusinessId(supabase, body.business);
    const errors = [...validateInitiativeBody(body, true), ...validateStringLengths(body), ...(await validateKnownMemberIds(supabase, owner, 'owner_id')), ...(businessError ? [businessError] : [])];
    if (errors.length) return apiError(c, 400, 'INVALID_INITIATIVE', errors.join('; '));
    const updates: Row = {};
    for (const field of MUTABLE_FIELDS) if (body[field] !== undefined) updates[field] = body[field] === '' ? null : body[field];
    if (updates.labels !== undefined) updates.labels = serializeJsonArray(updates.labels);
    if (body.owner_id !== undefined) updates.owner_id = owner[0] || null;
    updates.revision = Number(existing.revision) + 1;
    updates.updated_by = getActor(c);
    updates.updated_at = new Date().toISOString();
    const { data, error } = await supabase.from('atlas_initiatives').update(updates).eq('id', existing.id).eq('revision', raw.expected_revision).select().maybeSingle();
    if (error) throw error;
    if (!data) return apiError(c, 409, 'REVISION_CONFLICT', 'The initiative changed. Refresh and retry.');
    return c.json(data);
  } catch (error) {
    console.error(`[initiatives] update error: ${(error as Error).message}`);
    return apiError(c, 500, 'INITIATIVE_UPDATE_FAILED', 'Unable to update the initiative.');
  }
});

async function callRpc(c: any, name: string, args: Row, fallbackCode: string, fallbackMessage: string) {
  try {
    const { data, error } = await getDb(c.env).rpc(name, args);
    if (error) return initiativeRpcError(c, error, fallbackCode, fallbackMessage);
    return c.json(data);
  } catch (error) {
    console.error(`[initiatives] ${name} error: ${(error as Error).message}`);
    return apiError(c, 500, fallbackCode, fallbackMessage);
  }
}

router.post('/:id/archive', async c => { const body = await c.req.json<Row>().catch(() => ({} as Row)); return callRpc(c, 'transition_atlas_initiative', { p_initiative_id: c.req.param('id'), p_restore: false, p_actor: getActor(c), p_expected_revision: body.expected_revision }, 'INITIATIVE_ARCHIVE_FAILED', 'Unable to archive the initiative.'); });
router.post('/:id/restore', async c => { const body = await c.req.json<Row>().catch(() => ({} as Row)); return callRpc(c, 'transition_atlas_initiative', { p_initiative_id: c.req.param('id'), p_restore: true, p_actor: getActor(c), p_expected_revision: body.expected_revision }, 'INITIATIVE_RESTORE_FAILED', 'Unable to restore the initiative.'); });
router.post('/:id/reorder', async c => { const body = await c.req.json<Row>().catch(() => ({} as Row)); return callRpc(c, 'move_atlas_initiative_order', { p_initiative_id: c.req.param('id'), p_before_initiative_id: body.before_initiative_id || null, p_actor: getActor(c), p_expected_revision: body.expected_revision }, 'INITIATIVE_REORDER_FAILED', 'Unable to reorder the initiative.'); });
router.post('/:id/projects/:projectId/attach', c => callRpc(c, 'set_atlas_initiative_project', { p_initiative_id: c.req.param('id'), p_project_id: c.req.param('projectId'), p_active: true, p_actor: getActor(c) }, 'INITIATIVE_PROJECT_ATTACH_FAILED', 'Unable to attach the project.'));
router.post('/:id/projects/:projectId/detach', c => callRpc(c, 'set_atlas_initiative_project', { p_initiative_id: c.req.param('id'), p_project_id: c.req.param('projectId'), p_active: false, p_actor: getActor(c) }, 'INITIATIVE_PROJECT_DETACH_FAILED', 'Unable to detach the project.'));
router.post('/:id/parents/:parentId/attach', c => callRpc(c, 'set_atlas_initiative_parent', { p_child_initiative_id: c.req.param('id'), p_parent_initiative_id: c.req.param('parentId'), p_active: true, p_actor: getActor(c) }, 'INITIATIVE_PARENT_ATTACH_FAILED', 'Unable to attach the parent initiative.'));
router.post('/:id/parents/:parentId/detach', c => callRpc(c, 'set_atlas_initiative_parent', { p_child_initiative_id: c.req.param('id'), p_parent_initiative_id: c.req.param('parentId'), p_active: false, p_actor: getActor(c) }, 'INITIATIVE_PARENT_DETACH_FAILED', 'Unable to detach the parent initiative.'));

router.post('/:id/updates', async c => {
  const body = await c.req.json<Row>().catch(() => ({} as Row));
  return callRpc(c, 'post_atlas_initiative_update', { p_initiative_id: c.req.param('id'), p_update_id: uuidv4(), p_health: body.health, p_body: body.body, p_actor: getActor(c) }, 'INITIATIVE_UPDATE_POST_FAILED', 'Unable to post the initiative update.');
});

router.post('/:id/resources', async c => {
  const body = await c.req.json<Row>().catch(() => ({} as Row));
  const resourceError = validateInitiativeResourceBody(body);
  if (resourceError) return apiError(c, 400, 'INITIATIVE_RESOURCE_INVALID', resourceError);
  return callRpc(c, 'upsert_atlas_initiative_resource', { p_resource_id: null, p_initiative_id: c.req.param('id'), p_resource_type: body.resource_type || 'link', p_title: body.title, p_url: body.url || null, p_document_ref: body.document_ref || null, p_status: 'active', p_actor: getActor(c), p_expected_revision: null }, 'INITIATIVE_RESOURCE_CREATE_FAILED', 'Unable to create the initiative resource.');
});

router.put('/:id/resources/:resourceId', async c => {
  const body = await c.req.json<Row>().catch(() => ({} as Row));
  const resourceError = validateInitiativeResourceBody(body);
  if (resourceError) return apiError(c, 400, 'INITIATIVE_RESOURCE_INVALID', resourceError);
  return callRpc(c, 'upsert_atlas_initiative_resource', { p_resource_id: c.req.param('resourceId'), p_initiative_id: c.req.param('id'), p_resource_type: body.resource_type || 'link', p_title: body.title, p_url: body.url || null, p_document_ref: body.document_ref || null, p_status: body.status || 'active', p_actor: getActor(c), p_expected_revision: body.expected_revision }, 'INITIATIVE_RESOURCE_UPDATE_FAILED', 'Unable to update the initiative resource.');
});

router.post('/:id/resources/:resourceId/archive', async c => {
  const body = await c.req.json<Row>().catch(() => ({} as Row));
  const resourceError = validateInitiativeResourceBody(body);
  if (resourceError) return apiError(c, 400, 'INITIATIVE_RESOURCE_INVALID', resourceError);
  return callRpc(c, 'upsert_atlas_initiative_resource', { p_resource_id: c.req.param('resourceId'), p_initiative_id: c.req.param('id'), p_resource_type: body.resource_type || 'link', p_title: body.title, p_url: body.url || null, p_document_ref: body.document_ref || null, p_status: 'archived', p_actor: getActor(c), p_expected_revision: body.expected_revision }, 'INITIATIVE_RESOURCE_ARCHIVE_FAILED', 'Unable to archive the initiative resource.');
});

export default router;
