// @vitest-environment jsdom
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Layout from './Layout.jsx';
vi.mock('./TopBar.jsx', () => ({ default: () => null }));
vi.mock('../hooks/useBusinesses.js', () => ({ useBusinessContext: () => ({ BUSINESS_LIST: [], BUSINESS_COLORS: {} }) }));
const props = {
  currentView: 'today', setCurrentView: vi.fn(), selectedBusiness: null, setSelectedBusiness: vi.fn(),
  onOpenQuickCapture: vi.fn(), searchQuery: '', setSearchQuery: vi.fn(), sidebarOpen: false, setSidebarOpen: vi.fn(),
};
describe('Atlas navigation', () => {
  beforeEach(() => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  });
  it('shows exactly the fifteen supported surfaces in order and keeps the mobile bar', () => {
    render(<Layout {...props}><div>Content</div></Layout>);
    const sidebarNav = within(screen.getByLabelText('Sidebar')).getByRole('navigation');
    const links = within(sidebarNav).getAllByRole('button').map(button => button.textContent.trim());
    expect(links.slice(0, -1)).toEqual([
      'Today', 'Week', 'Projects', 'All Tasks', 'Kanban', 'Documents', 'Notifications', 'Office Digest',
      'Review', 'Decide', 'Journal', 'Calendar', 'Principals', 'Transcripts', 'Automations',
    ]);
    expect(links.at(-1)).toBe('All');
    expect(within(screen.getByRole('navigation', { name: 'Main' })).getAllByRole('button').map(button => button.textContent.trim()))
      .toEqual(['Today', 'All Tasks', 'Kanban', 'Review', 'Add']);
  });
});
