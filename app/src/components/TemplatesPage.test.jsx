// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TemplatesPage, { parseTemplateJson } from './TemplatesPage.jsx';
import * as hooks from '../hooks/useTemplates.js';

vi.mock('../hooks/useTemplates.js', () => ({ useTemplates: vi.fn(), useTemplate: vi.fn(), useCreateTemplate: vi.fn(), useUpdateTemplate: vi.fn(), useInstantiateTemplate: vi.fn(), useArchiveTemplate: vi.fn(), useRestoreTemplate: vi.fn(), useDuplicateTemplate: vi.fn() }));
vi.mock('../hooks/useBusinesses.js', () => ({ useBusinessContext: () => ({ BUSINESS_LIST: [{ id: 'personal', label: 'Personal' }] }) }));
function mutation(result = {}) { return { mutate: vi.fn(), mutateAsync: vi.fn().mockResolvedValue(result), isPending: false }; }
const template = { id: 't1', name: 'Bug report', description: 'Structured intake', template_type: 'action', mode: 'form', scope: 'workspace', business: null, default_audience: 'owner', is_default: true, status: 'active', revision: 1, usage_count: 3, blueprint: { description: 'Report a bug', sub_actions: [] }, form_schema: [{ key: 'title', type: 'title', label: 'Issue title', required: true }, { key: 'severity', type: 'dropdown', label: 'Severity', required: true, options: ['high', 'low'] }] };

describe('TemplatesPage', () => {
  beforeEach(() => { vi.clearAllMocks(); hooks.useTemplates.mockReturnValue({ data: [template], isLoading: false }); hooks.useTemplate.mockReturnValue({ data: { ...template, instances: [] }, isLoading: false }); for (const name of ['useCreateTemplate', 'useUpdateTemplate', 'useArchiveTemplate', 'useRestoreTemplate', 'useDuplicateTemplate']) hooks[name].mockReturnValue(mutation()); hooks.useInstantiateTemplate.mockReturnValue(mutation({ result_entity_type: 'action', result_entity_id: 'a1' })); });
  it('parses blueprint objects and rejects invalid JSON', () => { expect(parseTemplateJson('{"title":"X"}', 'Blueprint')).toEqual({ title: 'X' }); expect(() => parseTemplateJson('[]', 'Blueprint')).toThrow(/valid JSON object/); });
  it('renders template provenance and dynamic form use flow', () => { render(<TemplatesPage selectedBusiness="personal" onOpenAction={vi.fn()} onOpenProject={vi.fn()} onOpenDocument={vi.fn()} />); expect(screen.getByRole('heading', { name: 'Templates' })).toBeTruthy(); expect(screen.getByText('Bug report')).toBeTruthy(); fireEvent.click(screen.getByRole('button', { name: 'Use' })); expect(screen.getAllByRole('heading', { name: 'Bug report' }).length).toBeGreaterThan(0); expect(screen.getByLabelText(/Issue title/)).toBeTruthy(); expect(screen.getByLabelText(/Severity/)).toBeTruthy(); });
  it('has no automated semantic accessibility violations', async () => { const { container } = render(<TemplatesPage selectedBusiness="personal" onOpenAction={vi.fn()} onOpenProject={vi.fn()} onOpenDocument={vi.fn()} />); const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } }); expect(results.violations).toEqual([]); });
});
