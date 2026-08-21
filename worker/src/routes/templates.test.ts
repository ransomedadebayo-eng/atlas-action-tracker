import { describe, expect, it } from 'vitest';
import { app } from '../index';
import type { Env } from '../db';
import { chooseDefaultTemplate, validateFormSchema, validateTemplateBody, validateTemplateNodes } from './templates';

const codexToken = 'codex-template-test-token-0001';
function env(scopes = ['templates:read', 'templates:write']): Env { return { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-role-test-only', NODE_ENV: 'production', ATLAS_API_PRINCIPALS_JSON: JSON.stringify({ codex: { token: codexToken, scopes } }) }; }

describe('template validation', () => {
  it('accepts a structured action template with nested nodes', () => {
    expect(validateTemplateBody({ name: 'Bug', template_type: 'action', mode: 'form', scope: 'workspace', blueprint: { description: 'Report', sub_actions: [{ key: 'repro', title: 'Reproduce' }, { key: 'fix', parent_key: 'repro', title: 'Fix' }] }, form_schema: [{ key: 'title', type: 'title', label: 'Title', required: true }, { key: 'severity', type: 'dropdown', label: 'Severity', options: ['high', 'low'] }] })).toEqual([]);
  });

  it('rejects duplicate, missing-parent, cyclic, and over-deep template nodes', () => {
    expect(validateTemplateNodes([{ key: 'a', title: 'A' }, { key: 'a', title: 'Again' }])).toContain('template node keys must be unique non-empty strings');
    expect(validateTemplateNodes([{ key: 'a', parent_key: 'missing', title: 'A' }])).toContain('template node parent missing does not exist');
    expect(validateTemplateNodes([{ key: 'a', parent_key: 'b', title: 'A' }, { key: 'b', parent_key: 'a', title: 'B' }])).toContain('template node graph must be acyclic');
    expect(validateTemplateNodes([
      { key: 'a', title: 'A' }, { key: 'b', parent_key: 'a', title: 'B' }, { key: 'c', parent_key: 'b', title: 'C' },
      { key: 'd', parent_key: 'c', title: 'D' }, { key: 'e', parent_key: 'd', title: 'E' }, { key: 'f', parent_key: 'e', title: 'F' },
    ])).toContain('template node graph cannot exceed five levels');
  });

  it('validates structured form keys, types, and options', () => {
    expect(validateFormSchema([{ key: 'x', type: 'dropdown', options: [] }])).toContain('dropdown and checkbox fields require string options');
    expect(validateFormSchema([{ key: 'x', type: 'mystery' }])).toContain('form field type is invalid');
  });

  it('selects an exact-business default before workspace fallback', () => {
    const templates = [
      { id: 'workspace', template_type: 'action', status: 'active', is_default: true, default_audience: 'all', scope: 'workspace' },
      { id: 'personal', template_type: 'action', status: 'active', is_default: true, default_audience: 'owner', scope: 'business', business: 'personal' },
    ];
    expect(chooseDefaultTemplate(templates, 'action', 'personal')?.id).toBe('personal');
    expect(chooseDefaultTemplate(templates, 'action', 'riddim_exchange')?.id).toBe('workspace');
  });

  it('rejects form mode for project and document templates', () => {
    expect(validateTemplateBody({ name: 'Bad', template_type: 'project', mode: 'form', blueprint: { name: 'Project' }, form_schema: [] })).toContain('form mode is available only for action templates');
  });
});

describe('template HTTP boundary', () => {
  it('requires template read scope', async () => { const response = await app.request('/api/templates', { headers: { authorization: `Bearer ${codexToken}` } }, env(['actions:read'])); expect(response.status).toBe(403); await expect(response.json()).resolves.toMatchObject({ details: { required_scope: 'templates:read' } }); });
  it('keeps template configuration owner-only', async () => { const response = await app.request('/api/templates', { method: 'POST', headers: { authorization: `Bearer ${codexToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Protected' }) }, env()); expect(response.status).toBe(403); await expect(response.json()).resolves.toMatchObject({ code: 'OWNER_REQUIRED' }); });
  it('allows scoped principals to reach instantiation after authorization', async () => { const response = await app.request('/api/templates/t1/instantiate', { method: 'POST', headers: { authorization: `Bearer ${codexToken}`, 'content-type': 'application/json' }, body: '{}' }, env()); expect(response.status).not.toBe(403); });
});
