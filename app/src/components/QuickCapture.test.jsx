// @vitest-environment jsdom

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import QuickCapture from './QuickCapture.jsx';
import * as actionHooks from '../hooks/useActions.js';
import * as templateHooks from '../hooks/useTemplates.js';

vi.mock('../hooks/useActions.js', () => ({ useCreateAction: vi.fn() }));
vi.mock('../hooks/useMembers.js', () => ({ useMembers: () => ({ data: [{ id: 'ransomed', name: 'Ransomed' }] }) }));
vi.mock('../hooks/useBusinesses.js', () => ({ useBusinessContext: () => ({ BUSINESS_LIST: [{ id: 'personal', label: 'Personal' }] }) }));
vi.mock('../hooks/useEstimateSettings.js', () => ({ useEstimateSettings: () => ({ data: { enabled: true, options: [] } }) }));
vi.mock('../hooks/useTemplates.js', () => ({ useTemplates: vi.fn(), useInstantiateTemplate: vi.fn() }));

describe('QuickCapture templates', () => {
  beforeEach(() => {
    actionHooks.useCreateAction.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
    templateHooks.useInstantiateTemplate.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
    templateHooks.useTemplates.mockReturnValue({ data: [{ id: 't1', name: 'Personal default', template_type: 'action', mode: 'standard', scope: 'business', business: 'personal', is_default: true, blueprint: { title: 'Weekly review', description: 'Review progress', priority: 'p1', owners: ['ransomed'] } }] });
  });

  it('automatically applies the exact-business default action template', async () => {
    render(<QuickCapture onClose={vi.fn()} selectedBusiness="personal" prefilledDate={null} />);
    await waitFor(() => expect(screen.getByLabelText('Action template').value).toBe('t1'));
    expect(screen.getByLabelText('Action title').value).toBe('Weekly review');
    expect(screen.getByLabelText('Priority').value).toBe('p1');
  });
});
