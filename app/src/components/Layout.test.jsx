// @vitest-environment jsdom
import React, { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Layout from './Layout.jsx';
vi.mock('./TopBar.jsx', () => ({ default: ({ menuButtonRef, onToggleSidebar }) => <button ref={menuButtonRef} onClick={onToggleSidebar}>Open menu</button> }));
vi.mock('../hooks/useBusinesses.js', () => ({ useBusinessContext: () => ({ BUSINESS_LIST: [], BUSINESS_COLORS: {} }) }));
const props = {
  currentView: 'today', setCurrentView: vi.fn(), selectedBusiness: null, setSelectedBusiness: vi.fn(),
  onOpenQuickCapture: vi.fn(), searchQuery: '', setSearchQuery: vi.fn(), sidebarOpen: false, setSidebarOpen: vi.fn(),
};
function MobileLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  return <Layout {...props} sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} frozenBusinesses={new Set(['personal'])} setShowFrozen={vi.fn()}>
    <button>Background action</button>
  </Layout>;
}
describe('Atlas navigation', () => {
  beforeEach(() => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  });
  it('shows the supported surfaces with Focus after Week and keeps the mobile bar', () => {
    render(<Layout {...props}><div>Content</div></Layout>);
    const sidebarNav = within(screen.getByLabelText('Sidebar')).getByRole('navigation');
    const links = within(sidebarNav).getAllByRole('button').map(button => button.textContent.trim());
    expect(links.slice(0, -1)).toEqual([
      'Today', 'Week', 'Focus', 'Projects', 'All Tasks', 'Kanban', 'Documents', 'Notifications', 'Office Digest',
      'Review', 'Decide', 'Journal', 'Calendar', 'Principals', 'Transcripts', 'Automations',
    ]);
    expect(links.at(-1)).toBe('All');
    expect(within(screen.getByRole('navigation', { name: 'Main' })).getAllByRole('button').map(button => button.textContent.trim()))
      .toEqual(['Today', 'All Tasks', 'Kanban', 'Review', 'Add']);
  });

  it('contains mobile focus, hides the background, and restores the menu opener after Escape', () => {
    window.matchMedia.mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    render(<MobileLayout />);
    const sidebar = screen.getByLabelText('Sidebar');
    expect(sidebar.hasAttribute('inert')).toBe(true);
    const opener = screen.getByRole('button', { name: 'Open menu' });
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByRole('dialog', { name: 'Sidebar' })).toBe(sidebar);
    expect(sidebar.hasAttribute('inert')).toBe(false);
    const close = screen.getByRole('button', { name: 'Close menu' });
    expect(document.activeElement).toBe(close);
    const background = screen.getByText('Background action').closest('main').parentElement;
    expect(background.hasAttribute('inert')).toBe(true);
    expect(background.getAttribute('aria-hidden')).toBe('true');
    const mobileBar = screen.getByLabelText('Main');
    expect(mobileBar.hasAttribute('inert')).toBe(true);

    // JSDOM does not load Tailwind; model the desktop-only footer's mobile style.
    within(sidebar).getByRole('button', { name: /Quick Add/ }).parentElement.style.display = 'none';
    const last = screen.getByRole('button', { name: 'Show frozen (1)' });
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
    const globalShortcut = vi.fn();
    window.addEventListener('keydown', globalShortcut);
    fireEvent.keyDown(close, { key: 'Escape' });
    expect(globalShortcut).not.toHaveBeenCalled();
    window.removeEventListener('keydown', globalShortcut);
    expect(document.activeElement).toBe(opener);
    expect(sidebar.hasAttribute('inert')).toBe(true);
    expect(background.hasAttribute('inert')).toBe(false);
    expect(mobileBar.hasAttribute('inert')).toBe(false);
  });

  it.each(['navigation', 'backdrop'])('closes the mobile drawer through %s and restores focus', method => {
    window.matchMedia.mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    render(<MobileLayout />);
    const opener = screen.getByRole('button', { name: 'Open menu' });
    opener.focus();
    fireEvent.click(opener);
    if (method === 'navigation') {
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Projects' }));
      expect(props.setCurrentView).toHaveBeenCalledWith('projects');
    } else fireEvent.click(screen.getByLabelText('Dismiss navigation'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});
