// @vitest-environment jsdom

import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import axe from 'axe-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import WorkflowsPage from './WorkflowsPage.jsx'
import * as workflowHooks from '../hooks/useWorkflows.js'
import { useActions } from '../hooks/useActions.js'
import { useMembers } from '../hooks/useMembers.js'

vi.mock('../hooks/useWorkflows.js', () => ({
  useWorkflow: vi.fn(), useTriage: vi.fn(), useAcceptTriage: vi.fn(), useApplyInactivity: vi.fn(),
  useArchiveWorkflowStatus: vi.fn(), useCreateWorkflowRule: vi.fn(), useCreateWorkflowStatus: vi.fn(),
  useDeclineTriage: vi.fn(), useDuplicateTriage: vi.fn(), useEnterTriage: vi.fn(),
  usePreviewInactivity: vi.fn(), usePreviewWorkflowRule: vi.fn(), useReorderWorkflowStatuses: vi.fn(),
  useSnoozeTriage: vi.fn(), useTransitionWorkflowRule: vi.fn(), useUpdateTriageSettings: vi.fn(),
  useUpdateWorkflowStatus: vi.fn(), useUpdateWorkflow: vi.fn(),
}))
vi.mock('../hooks/useActions.js', () => ({ useActions: vi.fn() }))
vi.mock('../hooks/useMembers.js', () => ({ useMembers: vi.fn() }))

function mutation(result = {}) { return { mutate: vi.fn(), mutateAsync: vi.fn().mockResolvedValue(result), isPending: false } }
const statuses = [
  { id: 's-triage', status_key: 'triage', name: 'Triage', color: '#f59e0b', category: 'triage', legacy_status: 'open', position: 0, revision: 0 },
  { id: 's-todo', status_key: 'todo', name: 'Ready', color: '#a1a1aa', category: 'unstarted', legacy_status: 'not_started', position: 1, is_default: true, revision: 0 },
  { id: 's-progress', status_key: 'in_progress', name: 'Building', color: '#3b82f6', category: 'started', legacy_status: 'in_progress', position: 2, revision: 0 },
  { id: 's-done', status_key: 'done', name: 'Done', color: '#22c55e', category: 'completed', legacy_status: 'done', position: 3, revision: 0 },
  { id: 's-cancel', status_key: 'canceled', name: 'Canceled', color: '#737373', category: 'canceled', legacy_status: 'canceled', position: 4, revision: 0 },
  { id: 's-duplicate', status_key: 'duplicate', name: 'Duplicate', color: '#52525b', category: 'duplicate', legacy_status: 'done', position: 5, is_system: true, revision: 0 },
]
const workflow = {
  id: 'w1', business: 'personal', name: 'Personal workflow', statuses, pending_triage_count: 1,
  triage_settings: { enabled: true, require_priority: true, responsible_member_ids: ['ransomed'], default_accept_status_id: 's-todo', auto_close_categories: ['backlog', 'unstarted'], revision: 1 },
  rules: [{ id: 'r1', name: 'Escalate urgent intake', trigger_type: 'triage_entered', conditions: { mode: 'all', items: [] }, effects: { priority: 'p0' }, enabled: false, position: 0, revision: 0 }],
  recent_rule_runs: [],
}
const actions = [{ id: 'a1', title: 'Review vendor proposal', business: 'personal', priority: 'p1', status: 'not_started', workflow_status: statuses[1] }]
const triage = { workflow, entries: [{ id: 't1', action_id: 'a1', state: 'pending', source_type: 'email', revision: 0, created_at: '2026-08-20T20:00:00Z', action: actions[0] }] }

describe('WorkflowsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    workflowHooks.useWorkflow.mockReturnValue({ data: { workflow }, isLoading: false, isError: false })
    workflowHooks.useTriage.mockReturnValue({ data: triage, isLoading: false, isError: false })
    for (const name of Object.keys(workflowHooks).filter(name => name.startsWith('use') && !['useWorkflow', 'useTriage'].includes(name))) workflowHooks[name].mockReturnValue(mutation())
    useActions.mockReturnValue({ data: actions })
    useMembers.mockReturnValue({ data: [{ id: 'ransomed', name: 'Ransomed', is_active: true }] })
  })

  it('renders ordered configured statuses and Triage settings', async () => {
    render(<WorkflowsPage selectedBusiness="personal" onOpenAction={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'Personal workflow' })).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Ready name' })).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Building name' })).toBeTruthy()
    await waitFor(() => expect(screen.getByText('Enable Triage')).toBeTruthy())
    expect(screen.getByText('Close parent when all sub-actions resolve')).toBeTruthy()
    expect(screen.getByText('Close sub-actions with parent')).toBeTruthy()
  })

  it('renders the Triage queue and explicit decision controls', () => {
    render(<WorkflowsPage selectedBusiness="personal" onOpenAction={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: /Triage/ }))
    expect(screen.getByRole('heading', { name: 'Triage queue' })).toBeTruthy()
    expect(screen.getByText('Review vendor proposal')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Accept/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Decline/ })).toBeTruthy()
  })

  it('renders paused rules with preview and activation controls', () => {
    render(<WorkflowsPage selectedBusiness="personal" onOpenAction={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Rules' }))
    expect(screen.getByText('Escalate urgent intake')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Preview/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Activate/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Create paused rule/ })).toBeTruthy()
  })

  it('renders preview-first inactivity controls', () => {
    render(<WorkflowsPage selectedBusiness="personal" onOpenAction={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Inactivity' }))
    expect(screen.getByRole('heading', { name: 'Inactivity policy' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Preview/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Apply verified candidates/ }).disabled).toBe(true)
  })

  it('has no automated semantic accessibility violations', async () => {
    const { container } = render(<WorkflowsPage selectedBusiness="personal" onOpenAction={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Enable Triage')).toBeTruthy())
    const findings = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
    expect(findings.violations).toEqual([])
  })
})
