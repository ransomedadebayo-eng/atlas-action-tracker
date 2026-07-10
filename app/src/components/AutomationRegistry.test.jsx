// @vitest-environment jsdom

import React from 'react'
import { render, screen } from '@testing-library/react'
import axe from 'axe-core'
import { describe, expect, it, vi } from 'vitest'
import { useAutomationRegistry } from '../hooks/useAtlasOs.js'
import AutomationRegistry from './AutomationRegistry.jsx'

vi.mock('../hooks/useAtlasOs.js', () => ({
  useAutomationRegistry: vi.fn(),
}))

describe('AutomationRegistry', () => {
  it('is a read-only report surface with no run control', () => {
    useAutomationRegistry.mockReturnValue({
      data: {
        jobs: [{
          id: 'atlas-stewardship-daily',
          route_used: 'codex protocol',
          schedule: 'daily',
          writes_to: ['Today'],
          latest_report: { title: 'Verified report', created_at: '2026-07-09T12:00:00Z' },
        }],
      },
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    })

    render(<AutomationRegistry />)

    expect(screen.getByText(/read-only status/i)).toBeTruthy()
    expect(screen.getByText('atlas-stewardship-daily')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /run/i })).toBeNull()
  })

  it('has no automated semantic accessibility violations', async () => {
    useAutomationRegistry.mockReturnValue({
      data: { jobs: [] },
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    })

    const { container } = render(<AutomationRegistry />)
    const results = await axe.run(container, {
      rules: { 'color-contrast': { enabled: false } },
    })

    expect(results.violations).toEqual([])
  })
})
