// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import QuickCapture from './QuickCapture.jsx';
import * as actionHooks from '../hooks/useActions.js';
import * as memberHooks from '../hooks/useMembers.js';
import * as templateHooks from '../hooks/useTemplates.js';

vi.mock('../hooks/useActions.js', () => ({ useCreateAction: vi.fn() }));
vi.mock('../hooks/useMembers.js', () => ({ useMembers: vi.fn(), useCurrentMember: vi.fn() }));
vi.mock('../hooks/useBusinesses.js', () => ({ useBusinessContext: () => ({ BUSINESS_LIST: [{ id: 'personal', label: 'Personal' }] }) }));
vi.mock('../hooks/useEstimateSettings.js', () => ({ useEstimateSettings: () => ({ data: { enabled: true, options: [] } }) }));
vi.mock('../hooks/useTemplates.js', () => ({ useTemplates: vi.fn(), useInstantiateTemplate: vi.fn() }));

describe('QuickCapture templates', () => {
  beforeEach(() => {
    memberHooks.useMembers.mockReturnValue({ data: [{ id: 'ransomed', name: 'Ransomed' }, { id: 'nicole', name: 'Nicole' }] });
    memberHooks.useCurrentMember.mockReturnValue({ data: { id: 'ransomed', name: 'Ransomed' } });
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

  it('waits for identity and attributes an untemplated action to Nicole', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'a1' });
    actionHooks.useCreateAction.mockReturnValue({ mutateAsync: create, isPending: false });
    templateHooks.useTemplates.mockReturnValue({ data: [] });
    memberHooks.useCurrentMember.mockReturnValue({ data: undefined, isError: false });
    const props = { onClose: vi.fn(), selectedBusiness: 'personal', prefilledDate: null };
    const view = render(<QuickCapture {...props} />);
    fireEvent.change(screen.getByLabelText('Action title'), { target: { value: 'Family task' } });
    expect(screen.getByRole('button', { name: 'Verifying identity…' }).disabled).toBe(true);
    expect(create).not.toHaveBeenCalled();

    memberHooks.useCurrentMember.mockReturnValue({ data: { id: 'nicole', name: 'Nicole' }, isError: false });
    view.rerender(<QuickCapture {...props} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create Action' }).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Create Action' }));
    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ owners: ['nicole'] })));
  });

  it('shows a retry path and blocks creation when identity lookup fails', () => {
    const refetch = vi.fn();
    memberHooks.useCurrentMember.mockReturnValue({ data: undefined, isError: true, error: new Error('Identity unavailable'), refetch });
    templateHooks.useTemplates.mockReturnValue({ data: [] });
    render(<QuickCapture onClose={vi.fn()} selectedBusiness="personal" prefilledDate={null} />);
    expect(screen.getByRole('alert').textContent).toContain('Identity unavailable');
    expect(screen.getByRole('button', { name: 'Verifying identity…' }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
