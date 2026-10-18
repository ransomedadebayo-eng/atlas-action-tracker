// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import QuickCapture from './QuickCapture.jsx';
import * as actionHooks from '../hooks/useActions.js';
vi.mock('../hooks/useActions.js', () => ({ useCreateAction: vi.fn() }));
vi.mock('../hooks/useMembers.js', () => ({ useMembers: () => ({ data: [{ id: 'ransomed', name: 'Ransomed' }] }) }));
vi.mock('../hooks/useBusinesses.js', () => ({ useBusinessContext: () => ({ BUSINESS_LIST: [{ id: 'personal', label: 'Personal' }] }) }));
vi.mock('../hooks/useEstimateSettings.js', () => ({ useEstimateSettings: () => ({ data: { enabled: true, options: [] } }) }));

describe('QuickCapture', () => {
  let create;
  beforeEach(() => {
    create = vi.fn().mockResolvedValue({ id: 'a1' });
    actionHooks.useCreateAction.mockReturnValue({ mutateAsync: create, isPending: false });
  });
  it('creates a standard action using the selected business and explicit values', async () => {
    const onClose = vi.fn();
    render(<QuickCapture onClose={onClose} selectedBusiness="personal" prefilledDate="2026-10-19" />);
    expect(screen.queryByLabelText('Action template')).toBeNull();
    fireEvent.change(screen.getByLabelText('Action title'), { target: { value: 'Weekly review' } });
    fireEvent.click(screen.getByRole('button', { name: /create action/i }));
    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ title: 'Weekly review', status: 'not_started', business: 'personal', due_date: '2026-10-19' })));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
