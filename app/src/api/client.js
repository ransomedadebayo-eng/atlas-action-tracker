const BASE_URL = '/api';

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const config = {
    headers: {
      'Content-Type': 'application/json',
    },
    ...options,
  };

  if (config.body && typeof config.body === 'object') {
    config.body = JSON.stringify(config.body);
  }

  const res = await fetch(url, config);

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!res.ok) {
    const cloudflareLimit = text.includes('Error 1027') || text.includes('temporarily rate limited');
    const message = data?.message
      || data?.error?.message
      || (typeof data?.error === 'string' ? data.error : null)
      || (cloudflareLimit ? 'Cloudflare Workers request limit reached. Check the Workers plan or wait for the daily reset.' : res.statusText)
      || `Request failed: ${res.status}`;
    throw new Error(message);
  }

  return data;
}

// Actions
export const actionsApi = {
  list: (params = {}) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') query.set(k, v);
    });
    const qs = query.toString();
    return request(`/actions${qs ? `?${qs}` : ''}`);
  },
  get: (id) => request(`/actions/${id}`),
  create: (data) => request('/actions', { method: 'POST', body: data }),
  update: (id, data) => request(`/actions/${id}`, { method: 'PUT', body: data }),
  complete: (id, data) => request(`/actions/${id}/complete`, { method: 'POST', body: data }),
  archive: (id, data = {}) => request(`/actions/${id}/archive`, { method: 'POST', body: data }),
  restore: (id, data = {}) => request(`/actions/${id}/restore`, { method: 'POST', body: data }),
  createAgentAssignment: (id) => request(`/actions/${id}/agent-assignment`, { method: 'POST', body: {} }),
  bulkCreate: (actions) => request('/actions/bulk', { method: 'POST', body: { actions } }),
  bulkUpdate: (updates) => request('/actions/bulk', { method: 'PUT', body: { updates } }),
  stats: (params = {}) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') query.set(k, v);
    });
    const qs = query.toString();
    return request(`/actions/stats${qs ? `?${qs}` : ''}`);
  },
  byOwner: (id) => request(`/actions/by-owner/${id}`),
  structure: (id) => request(`/actions/${encodeURIComponent(id)}/structure`),
  createSubAction: (id, data) => request(`/actions/${encodeURIComponent(id)}/sub-actions`, { method: 'POST', body: data }),
  setParent: (id, data) => request(`/actions/${encodeURIComponent(id)}/parent`, { method: 'POST', body: data }),
  createRelation: (id, data) => request(`/actions/${encodeURIComponent(id)}/relations`, { method: 'POST', body: data }),
  transitionRelation: (id, relationId, transition) => request(`/actions/${encodeURIComponent(id)}/relations/${encodeURIComponent(relationId)}/${transition}`, { method: 'POST', body: {} }),
  markDuplicate: (id, data) => request(`/actions/${encodeURIComponent(id)}/duplicate`, { method: 'POST', body: data }),
  restoreDuplicate: (id, data) => request(`/actions/${encodeURIComponent(id)}/restore-duplicate`, { method: 'POST', body: data }),
  convertToProject: (id, data) => request(`/actions/${encodeURIComponent(id)}/convert-to-project`, { method: 'POST', body: data }),
};

// Transcripts
export const transcriptsApi = {
  list: (params = {}) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') query.set(k, v);
    });
    const qs = query.toString();
    return request(`/transcripts${qs ? `?${qs}` : ''}`);
  },
  get: (id) => request(`/transcripts/${id}`),
  create: (data) => request('/transcripts', { method: 'POST', body: data }),
  update: (id, data) => request(`/transcripts/${id}`, { method: 'PUT', body: data }),
};

// Members
export const membersApi = {
  list: (params = {}) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') query.set(k, v);
    });
    const qs = query.toString();
    return request(`/members${qs ? `?${qs}` : ''}`);
  },
  get: (id) => request(`/members/${id}`),
  update: (id, data) => request(`/members/${id}`, { method: 'PUT', body: data }),
  actions: (id, params = {}) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') query.set(k, v);
    });
    const qs = query.toString();
    return request(`/members/${id}/actions${qs ? `?${qs}` : ''}`);
  },
  stats: () => request('/members/stats'),
};

// Views
export const viewsApi = {
  list: (params = {}) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') query.set(key, value);
    });
    const qs = query.toString();
    return request(`/views${qs ? `?${qs}` : ''}`);
  },
  create: (data) => request('/views', { method: 'POST', body: data }),
  update: (id, data) => request(`/views/${id}`, { method: 'PUT', body: data }),
  archive: (id, data) => request(`/views/${id}/archive`, { method: 'POST', body: data }),
  restore: (id, data) => request(`/views/${id}/restore`, { method: 'POST', body: data }),
};

// Activity
export const activityApi = {
  get: (actionId) => request(`/activity/${actionId}`),
};

// Today
export const todayApi = {
  get: (date) => request(`/today${date ? `?date=${encodeURIComponent(date)}` : ''}`),
};

export const updatesApi = {
  officeDigest: () => request('/updates/office-digest'),
};

// Weekly planning
export const weeksApi = {
  get: (weekStart, revisionId) => request(`/weeks/${encodeURIComponent(weekStart)}${revisionId ? `?revision_id=${encodeURIComponent(revisionId)}` : ''}`),
  createDraft: (data) => request('/weeks/drafts', { method: 'POST', body: data }),
  save: (id, data) => request(`/weeks/revisions/${encodeURIComponent(id)}`, { method: 'PUT', body: data }),
  requestReview: (id, data) => request(`/weeks/revisions/${encodeURIComponent(id)}/request-review`, { method: 'POST', body: data }),
  publish: (id, data) => request(`/weeks/revisions/${encodeURIComponent(id)}/publish`, { method: 'POST', body: data }),
  fork: (id, data = {}) => request(`/weeks/revisions/${encodeURIComponent(id)}/fork`, { method: 'POST', body: data }),
  review: () => request('/weeks/review'),
};

// Projects
export const projectsApi = {
  list: (params = {}) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') query.set(k, v);
    });
    const qs = query.toString();
    return request(`/projects${qs ? `?${qs}` : ''}`);
  },
  get: (id) => request(`/projects/${encodeURIComponent(id)}`),
  create: (data) => request('/projects', { method: 'POST', body: data }),
  update: (id, data) => request(`/projects/${encodeURIComponent(id)}`, { method: 'PUT', body: data }),
  archive: (id, data) => request(`/projects/${encodeURIComponent(id)}/archive`, { method: 'POST', body: data }),
  restore: (id, data) => request(`/projects/${encodeURIComponent(id)}/restore`, { method: 'POST', body: data }),
  createMilestone: (id, data) => request(`/projects/${encodeURIComponent(id)}/milestones`, { method: 'POST', body: data }),
  updateMilestone: (id, milestoneId, data) => request(`/projects/${encodeURIComponent(id)}/milestones/${encodeURIComponent(milestoneId)}`, { method: 'PUT', body: data }),
  archiveMilestone: (id, milestoneId, data) => request(`/projects/${encodeURIComponent(id)}/milestones/${encodeURIComponent(milestoneId)}/archive`, { method: 'POST', body: data }),
  postUpdate: (id, data) => request(`/projects/${encodeURIComponent(id)}/updates`, { method: 'POST', body: data }),
  createDependency: (id, data) => request(`/projects/${encodeURIComponent(id)}/dependencies`, { method: 'POST', body: data }),
  resolveDependency: (id, dependencyId) => request(`/projects/${encodeURIComponent(id)}/dependencies/${encodeURIComponent(dependencyId)}/resolve`, { method: 'POST', body: {} }),
  archiveDependency: (id, dependencyId) => request(`/projects/${encodeURIComponent(id)}/dependencies/${encodeURIComponent(dependencyId)}/archive`, { method: 'POST', body: {} }),
  assignAction: (id, actionId, data) => request(`/projects/${encodeURIComponent(id)}/actions/${encodeURIComponent(actionId)}/assign`, { method: 'POST', body: data }),
  removeAction: (id, actionId) => request(`/projects/${encodeURIComponent(id)}/actions/${encodeURIComponent(actionId)}/remove`, { method: 'POST', body: {} }),
  reorder: (id, data) => request(`/projects/${encodeURIComponent(id)}/reorder`, { method: 'POST', body: data }),
  moveTimeline: (id, data) => request(`/projects/${encodeURIComponent(id)}/move-timeline`, { method: 'POST', body: data }),
};

// Documents
export const documentsApi = {
  list: (params = {}) => {
    const query = new URLSearchParams(); Object.entries(params).forEach(([key, value]) => { if (value !== undefined && value !== null && value !== '') query.set(key, value); });
    const qs = query.toString(); return request(`/documents${qs ? `?${qs}` : ''}`);
  },
  get: (id) => request(`/documents/${encodeURIComponent(id)}`),
  create: (data) => request('/documents', { method: 'POST', body: data }),
  update: (id, data) => request(`/documents/${encodeURIComponent(id)}`, { method: 'PUT', body: data }),
  archive: (id, data) => request(`/documents/${encodeURIComponent(id)}/archive`, { method: 'POST', body: data }),
  restore: (id, data) => request(`/documents/${encodeURIComponent(id)}/restore`, { method: 'POST', body: data }),
  revert: (id, data) => request(`/documents/${encodeURIComponent(id)}/revert`, { method: 'POST', body: data }),
};

// Collaboration
export const commentsApi = {
  get: (targetType, targetId) => request(`/comments?target_type=${encodeURIComponent(targetType)}&target_id=${encodeURIComponent(targetId)}`),
  create: (data) => request('/comments', { method: 'POST', body: data }),
  update: (id, data) => request(`/comments/${encodeURIComponent(id)}`, { method: 'PUT', body: data }),
  archive: (id, data) => request(`/comments/${encodeURIComponent(id)}/archive`, { method: 'POST', body: data }),
  restore: (id, data) => request(`/comments/${encodeURIComponent(id)}/restore`, { method: 'POST', body: data }),
  resolve: (id, data) => request(`/comments/${encodeURIComponent(id)}/resolve`, { method: 'POST', body: data }),
  reopen: (id, data) => request(`/comments/${encodeURIComponent(id)}/reopen`, { method: 'POST', body: data }),
  toggleReaction: (data) => request('/comments/reactions/toggle', { method: 'POST', body: data }),
  setSubscription: (data) => request('/comments/subscription', { method: 'POST', body: data }),
};

// Journal
export const journalApi = {
  list: (params = {}) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') query.set(k, v);
    });
    const qs = query.toString();
    return request(`/journal${qs ? `?${qs}` : ''}`);
  },
  create: (data) => request('/journal', { method: 'POST', body: data }),
  update: (id, data) => request(`/journal/${id}`, { method: 'PUT', body: data }),
  archive: (id) => request(`/journal/${id}/archive`, { method: 'POST', body: {} }),
  promote: (id, data) => request(`/journal/${id}/promote`, { method: 'POST', body: data }),
};

// Decide
export const decideApi = {
  get: () => request('/decide'),
  decideProposal: (id, data) => request(`/decide/proposals/${id}/decision`, { method: 'POST', body: data }),
};

// Config
export const configApi = {
  businesses: () => request('/config/businesses'),
  updateBusinesses: (businesses) => request('/config/businesses', { method: 'PUT', body: businesses }),
  estimates: () => request('/config/estimates'),
  updateEstimates: (settings) => request('/config/estimates', { method: 'PUT', body: settings }),
};

// Atlas-native PEOS surfaces
export const atlasOsApi = {
  review: () => request('/atlas-os/review'),
  decide: () => request('/atlas-os/decide'),
  journal: () => request('/atlas-os/journal'),
  createJournalEntry: (data) => request('/atlas-os/journal', { method: 'POST', body: data }),
};

// Automations
export const automationsApi = {
  list: () => request('/automations'),
  registry: () => request('/automations/registry'),
};

export const notificationsApi = {
  list: (params = {}) => { const query = new URLSearchParams(); Object.entries(params).forEach(([key, value]) => { if (value !== undefined && value !== null && value !== '') query.set(key, value) }); const qs = query.toString(); return request(`/notifications${qs ? `?${qs}` : ''}`) },
  summary: () => request('/notifications/summary'),
  transition: (id, status, data = {}) => request(`/notifications/${encodeURIComponent(id)}/${status}`, { method: 'POST', body: data }),
  readAll: () => request('/notifications/read-all', { method: 'POST', body: {} }),
  updatePreference: (data) => request('/notifications/preferences', { method: 'PUT', body: data }),
  subscribe: (data) => request('/notifications/subscriptions', { method: 'POST', body: data }),
  transitionSubscription: (id, transition, data = {}) => request(`/notifications/subscriptions/${encodeURIComponent(id)}/${transition}`, { method: 'POST', body: data }),
};

export const integrationsApi = {
  list: () => request('/integrations'),
  createConnection: (data) => request('/integrations/connections', { method: 'POST', body: data }),
  updateConnection: (id, data) => request(`/integrations/connections/${encodeURIComponent(id)}`, { method: 'PUT', body: data }),
  verifyConnection: (id, data = {}) => request(`/integrations/connections/${encodeURIComponent(id)}/verify`, { method: 'POST', body: data }),
  transitionConnection: (id, transition, data = {}) => request(`/integrations/connections/${encodeURIComponent(id)}/${transition}`, { method: 'POST', body: data }),
  createSubscription: (id, data) => request(`/integrations/connections/${encodeURIComponent(id)}/subscriptions`, { method: 'POST', body: data }),
  transitionSubscription: (id, transition, data = {}) => request(`/integrations/subscriptions/${encodeURIComponent(id)}/${transition}`, { method: 'POST', body: data }),
  processDeliveries: (data = {}) => request('/integrations/deliveries/process', { method: 'POST', body: data }),
  transitionInbound: (id, transition, data = {}) => request(`/integrations/inbound/${encodeURIComponent(id)}/${transition}`, { method: 'POST', body: data }),
  createReference: (id, data) => request(`/integrations/connections/${encodeURIComponent(id)}/references`, { method: 'POST', body: data }),
};
