const BASE_URL = '/api';

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const token = import.meta.env.VITE_ATLAS_API_TOKEN;
  const config = {
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    ...options,
  };

  if (config.body && typeof config.body === 'object') {
    config.body = JSON.stringify(config.body);
  }

  const res = await fetch(url, config);

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || `Request failed: ${res.status}`);
  }

  return res.json();
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
  delete: (id) => request(`/actions/${id}`, { method: 'DELETE' }),
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
  create: (data) => request('/members', { method: 'POST', body: data }),
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
  list: () => request('/views'),
  create: (data) => request('/views', { method: 'POST', body: data }),
  update: (id, data) => request(`/views/${id}`, { method: 'PUT', body: data }),
  delete: (id) => request(`/views/${id}`, { method: 'DELETE' }),
};

// Activity
export const activityApi = {
  get: (actionId) => request(`/activity/${actionId}`),
};

// Config
export const configApi = {
  businesses: () => request('/config/businesses'),
  updateBusinesses: (businesses) => request('/config/businesses', { method: 'PUT', body: businesses }),
};
