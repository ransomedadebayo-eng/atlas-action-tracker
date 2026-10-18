// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import QuickCapture from './QuickCapture.jsx';
import * as actionHooks from '../hooks/useActions.js';
vi.mock('../hooks/useActions.js', () => ({ useCreateAction: vi.fn() }));
vi.mock('../hooks/useMembers.js', () => ({ useMembers: () => ({ data: [{ id: 'ransomed', name: 'Ransomed' }] }) }));
vi.mock('../hooks/useBusinesses.js', () => ({ useBusinessContext: () => ({ BUSINESS_LIST: [{ id: 'personal', label: 'Personal' }] }) }));
vi.mock('../hooks/useEstimateSettings.js', () => ({ useEstimateSettings: () => ({ data: { enabled: true, options: [] } }) }));

describe('QuickCapture', () => {
  let create;
  afterEach(() => vi.restoreAllMocks());
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

  it('uses native required validation for empty titles and keeps the whitespace guard', () => {
    render(<QuickCapture onClose={vi.fn()} />);
    const title = screen.getByLabelText('Action title');
    const invalid = vi.fn();
    title.addEventListener('invalid', invalid);
    expect(title.required).toBe(true);
    expect(title.validity.valueMissing).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Create Action' }));
    expect(invalid).toHaveBeenCalledOnce();
    expect(create).not.toHaveBeenCalled();

    fireEvent.change(title, { target: { value: '   ' } });
    expect(title.validity.valid).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Create Action' }));
    expect(screen.getByRole('alert').textContent).toBe('Title is required');
    expect(document.activeElement).toBe(title);
    expect(create).not.toHaveBeenCalled();
  });

  it('focuses the title, traps Tab around pending controls, and restores the opener', async () => {
    create.mockReturnValue(new Promise(() => {}));
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const view = render(<QuickCapture onClose={vi.fn()} />);
    const title = screen.getByLabelText('Action title');
    const close = screen.getByRole('button', { name: 'Close quick capture' });
    expect(document.activeElement).toBe(title);
    close.focus();
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Create Action' }));
    fireEvent.keyDown(document.activeElement, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
    fireEvent.change(title, { target: { value: 'Pending capture' } });
    fireEvent.submit(screen.getByRole('form', { name: 'New action' }));
    expect(screen.getByRole('button', { name: 'Saving...' }).disabled).toBe(true);
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.keyDown(document.activeElement, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
    view.unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('dismisses with Escape once without also triggering the global shortcut', () => {
    const onClose = vi.fn();
    const globalShortcut = vi.fn();
    window.addEventListener('keydown', globalShortcut);
    render(<QuickCapture onClose={onClose} />);
    fireEvent.keyDown(screen.getByLabelText('Action title'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
    expect(globalShortcut).not.toHaveBeenCalled();
    window.removeEventListener('keydown', globalShortcut);
  });

  it('keeps expanded fields and the submit controls in the bounded mobile scroll region', () => {
    render(<QuickCapture onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    const form = screen.getByRole('form', { name: 'New action' });
    expect(form.classList.contains('min-h-0')).toBe(true);
    expect(form.classList.contains('overflow-y-auto')).toBe(true);
    expect(form.contains(screen.getByLabelText('Next action'))).toBe(true);
    expect(form.contains(screen.getByLabelText('Description'))).toBe(true);
    expect(form.contains(screen.getByRole('button', { name: 'Create Action' }))).toBe(true);
    const panel = form.parentElement;
    expect(panel.classList.contains('flex-col')).toBe(true);
    expect(panel.classList.contains('max-h-[90dvh]')).toBe(true);
    expect(panel.classList.contains('md:max-h-[calc(100dvh-6rem)]')).toBe(true);
    expect(panel.firstElementChild.classList.contains('shrink-0')).toBe(true);
  });
});
