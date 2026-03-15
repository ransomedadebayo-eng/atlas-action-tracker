import React from 'react'
import {
  LayoutDashboard,
  Columns,
  CalendarDays,
  Users,
  FileText,
  Command,
  Zap,
  X,
} from 'lucide-react'
import TopBar from './TopBar.jsx'
import { useBusinessContext } from '../hooks/useBusinesses.js'

const NAV_LINKS = [
  { id: 'dashboard', label: 'Dashboard', Icon: LayoutDashboard },
  { id: 'kanban', label: 'Kanban', Icon: Columns },
  { id: 'calendar', label: 'Calendar', Icon: CalendarDays },
  { id: 'members', label: 'Team', Icon: Users },
  { id: 'transcripts', label: 'Transcripts', Icon: FileText },
]

export default function Layout({
  currentView,
  setCurrentView,
  selectedBusiness,
  setSelectedBusiness,
  onOpenQuickCapture,
  searchQuery,
  setSearchQuery,
  sidebarOpen,
  setSidebarOpen,
  children,
}) {
  const { BUSINESS_LIST, BUSINESS_COLORS } = useBusinessContext()

  function handleNavClick(viewId) {
    setCurrentView(viewId)
    setSidebarOpen(false)
  }

  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar — hidden on mobile, slide-over when open */}
      <aside
        aria-label="Sidebar"
        className={`
          flex flex-col h-full border-r border-border flex-shrink-0
          fixed inset-y-0 left-0 z-50 w-[240px] transition-transform duration-200 ease-out
          md:static md:translate-x-0
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
          bg-bg-surface
        `}
      >
        {/* Logo */}
        <div className="px-5 py-5 border-b border-border">
          <div className="flex items-center gap-2">
            <span
              className="w-2.5 h-2.5 rounded-full flex-shrink-0 animate-pulse"
              style={{ backgroundColor: '#f59e0b' }}
            />
            <span className="font-mono font-bold text-text-primary tracking-wide text-base">
              ATLAS
            </span>
            <span
              className="ml-auto text-[10px] font-mono px-1.5 py-0.5 rounded"
              style={{ backgroundColor: 'rgba(245,158,11,0.12)', color: '#f59e0b' }}
            >
              v1.0
            </span>
            {/* Close button on mobile */}
            <button
              className="md:hidden ml-1 p-1 text-text-muted hover:text-text-primary"
              onClick={() => setSidebarOpen(false)}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <p className="text-text-muted text-[11px] mt-1 ml-5">Action Tracker</p>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 overflow-y-auto">
          <div className="space-y-0.5">
            {NAV_LINKS.map(({ id, label, Icon }) => (
              <button
                key={id}
                className={`sidebar-link w-full${currentView === id ? ' active' : ''}`}
                onClick={() => handleNavClick(id)}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                {label}
              </button>
            ))}
          </div>

          {/* Businesses */}
          <div className="mt-6">
            <p className="text-text-muted text-[10px] uppercase tracking-widest font-semibold px-3 mb-2">
              Businesses
            </p>
            <div className="space-y-0.5">
              <button
                className={`sidebar-link w-full${selectedBusiness === null ? ' active' : ''}`}
                onClick={() => { setSelectedBusiness(null); setSidebarOpen(false) }}
              >
                <span className="w-2 h-2 rounded-full bg-text-muted flex-shrink-0" />
                All
              </button>
              {BUSINESS_LIST.map(({ id, label }) => (
                <button
                  key={id}
                  className={`sidebar-link w-full${selectedBusiness === id ? ' active' : ''}`}
                  onClick={() => { setSelectedBusiness(id === selectedBusiness ? null : id); setSidebarOpen(false) }}
                >
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: BUSINESS_COLORS[id] }}
                  />
                  <span className="truncate">{label}</span>
                </button>
              ))}
            </div>
          </div>
        </nav>

        {/* Quick Add — desktop only (mobile uses bottom bar FAB) */}
        <div className="p-3 border-t border-border hidden md:block">
          <button
            className="btn-primary w-full flex items-center justify-center gap-2 text-sm"
            onClick={onOpenQuickCapture}
          >
            <Zap className="w-4 h-4" />
            <span>Quick Add</span>
            <span
              className="ml-auto flex items-center gap-0.5 text-[10px] opacity-60"
            >
              <Command className="w-3 h-3" />K
            </span>
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex flex-col flex-1 overflow-hidden pb-16 md:pb-0">
        <TopBar
          currentView={currentView}
          selectedBusiness={selectedBusiness}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          onNewAction={onOpenQuickCapture}
          onViewTranscripts={() => setCurrentView('transcripts')}
          onToggleSidebar={() => setSidebarOpen(v => !v)}
        />
        <main id="main-content" className="flex-1 overflow-y-auto p-4 md:p-6 bg-bg-primary">
          {children}
        </main>
      </div>

      {/* Mobile bottom tab bar */}
      <nav
        aria-label="Main"
        className="fixed bottom-0 left-0 right-0 z-30 md:hidden border-t border-border flex items-center justify-around bg-bg-surface h-14"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {NAV_LINKS.slice(0, 4).map(({ id, label, Icon }) => (
          <button
            key={id}
            className={`flex flex-col items-center gap-0.5 px-3 py-1.5 min-w-[60px] transition-colors ${
              currentView === id ? 'text-accent' : 'text-text-muted'
            }`}
            onClick={() => setCurrentView(id)}
          >
            <Icon className="w-5 h-5" />
            <span className="text-[10px] font-medium">{label}</span>
          </button>
        ))}
        {/* FAB-style quick add in the center position */}
        <button
          className="flex flex-col items-center gap-0.5 px-3 py-1.5 min-w-[60px] text-accent"
          onClick={onOpenQuickCapture}
        >
          <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center -mt-3 shadow-lg">
            <Zap className="w-4 h-4 text-bg-primary" />
          </div>
          <span className="text-[10px] font-medium">Add</span>
        </button>
      </nav>
    </div>
  )
}
