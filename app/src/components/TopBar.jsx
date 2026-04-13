import React, { useRef } from 'react'
import { Search, X, Plus, Upload, Menu } from 'lucide-react'
import { useBusinessContext } from '../hooks/useBusinesses.js'

const VIEW_TITLES = {
  dashboard: 'Dashboard',
  kanban: 'Kanban Board',
  calendar: 'Calendar',
  members: 'Team',
  transcripts: 'Transcripts',
}

export default function TopBar({
  currentView,
  selectedBusiness,
  searchQuery,
  setSearchQuery,
  onNewAction,
  onViewTranscripts,
  onToggleSidebar,
}) {
  const { BUSINESSES, BUSINESS_COLORS } = useBusinessContext()
  const searchRef = useRef(null)
  const businessInfo = selectedBusiness ? BUSINESSES[selectedBusiness] : null
  const businessColor = selectedBusiness ? BUSINESS_COLORS[selectedBusiness] : null

  function handleSearchChange(e) {
    setSearchQuery(e.target.value)
  }

  return (
    <header
      className="flex items-center gap-2 md:gap-4 px-3 md:px-6 border-b border-white/10 flex-shrink-0 bg-bg-primary h-14"
    >
      {/* Hamburger */}
      <button
        className="md:hidden p-1.5 -ml-1 text-text-muted hover:text-text-primary"
        onClick={onToggleSidebar}
        aria-label="Open menu"
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* Left: title + business pill */}
      <div className="flex items-center gap-2 md:gap-3 min-w-0 flex-shrink-0">
        <h1 className="text-text-primary font-headline font-semibold text-sm md:text-base whitespace-nowrap">
          {VIEW_TITLES[currentView] || 'ATLAS'}
        </h1>
        {businessInfo && (
          <span
            className="text-[10px] uppercase tracking-widest font-bold px-3 py-1 rounded-full whitespace-nowrap hidden sm:inline-flex"
            style={{
              backgroundColor: `${businessColor}18`,
              color: businessColor,
              border: `1px solid ${businessColor}30`,
            }}
          >
            {businessInfo.label}
          </span>
        )}
      </div>

      {/* Center: search */}
      <div className="flex-1 max-w-md mx-auto relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
        <input
          ref={searchRef}
          type="text"
          className="input-field w-full pl-9 pr-8 text-sm"
          placeholder="Search actions..."
          value={searchQuery}
          onChange={handleSearchChange}
        />
        {searchQuery && (
          <button
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary"
            onClick={() => setSearchQuery('')}
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Right: action buttons */}
      <div className="flex items-center gap-1.5 md:gap-2 flex-shrink-0">
        <button
          className="btn-secondary flex items-center gap-1.5 text-sm py-1.5 hidden md:flex"
          onClick={onViewTranscripts}
          title="Upload Transcript"
        >
          <Upload className="w-4 h-4" />
          <span className="hidden lg:inline">Transcript</span>
        </button>
        <button
          className="btn-primary flex items-center gap-1.5 text-sm py-1.5 hidden md:flex"
          onClick={onNewAction}
        >
          <Plus className="w-4 h-4" />
          <span>New Action</span>
        </button>
      </div>
    </header>
  )
}
