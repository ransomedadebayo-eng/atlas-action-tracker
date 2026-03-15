import React from 'react'
import { X, SlidersHorizontal } from 'lucide-react'
import { STATUSES, PRIORITIES } from '../utils/constants.js'
import { STATUS_COLORS, PRIORITY_COLORS } from '../utils/colors.js'

export default function FilterBar({ filters, onFilterChange, members = [] }) {
  const hasFilters = filters.status || filters.priority || filters.owner_id || filters.search

  function clearAll() {
    onFilterChange({ business: filters.business })
  }

  function removeFilter(key) {
    const next = { ...filters }
    delete next[key]
    onFilterChange(next)
  }

  return (
    <div className="flex items-center gap-1.5 md:gap-2 flex-wrap overflow-x-auto">
      <div className="flex items-center gap-1 mr-1 md:mr-2 flex-shrink-0">
        <SlidersHorizontal className="w-4 h-4 text-text-muted" />
        <span className="text-text-muted text-[10px] md:text-xs uppercase tracking-wider font-medium hidden sm:inline">Filters</span>
      </div>

      {/* Status Filter */}
      <select
        aria-label="Filter by status"
        className="input-field text-[11px] md:text-xs py-1 px-1.5 md:px-2 bg-bg-surface flex-shrink-0"
        value={filters.status || ''}
        onChange={e => onFilterChange({ ...filters, status: e.target.value || undefined })}
      >
        <option value="">Status</option>
        {Object.entries(STATUSES).map(([id, s]) => (
          <option key={id} value={id}>{s.label}</option>
        ))}
      </select>

      {/* Priority Filter */}
      <select
        aria-label="Filter by priority"
        className="input-field text-[11px] md:text-xs py-1 px-1.5 md:px-2 bg-bg-surface flex-shrink-0"
        value={filters.priority || ''}
        onChange={e => onFilterChange({ ...filters, priority: e.target.value || undefined })}
      >
        <option value="">Priority</option>
        {Object.entries(PRIORITIES).map(([id, p]) => (
          <option key={id} value={id}>{p.label}</option>
        ))}
      </select>

      {/* Owner Filter */}
      <select
        aria-label="Filter by owner"
        className="input-field text-[11px] md:text-xs py-1 px-1.5 md:px-2 bg-bg-surface flex-shrink-0"
        value={filters.owner_id || ''}
        onChange={e => onFilterChange({ ...filters, owner_id: e.target.value || undefined })}
      >
        <option value="">Owner</option>
        {members.map(m => (
          <option key={m.id} value={m.id}>{m.name}</option>
        ))}
      </select>

      {/* Active Filter Chips */}
      {hasFilters && (
        <>
          <div className="h-4 w-px bg-border mx-1" />
          {filters.status && (
            <FilterChip
              label={STATUSES[filters.status]?.label}
              color={STATUS_COLORS[filters.status]}
              onRemove={() => removeFilter('status')}
            />
          )}
          {filters.priority && (
            <FilterChip
              label={PRIORITIES[filters.priority]?.label}
              color={PRIORITY_COLORS[filters.priority]}
              onRemove={() => removeFilter('priority')}
            />
          )}
          {filters.owner_id && (
            <FilterChip
              label={members.find(m => m.id === filters.owner_id)?.name || filters.owner_id}
              color="#3b82f6"
              onRemove={() => removeFilter('owner_id')}
            />
          )}
          {filters.search && (
            <FilterChip
              label={`"${filters.search}"`}
              color="#f59e0b"
              onRemove={() => removeFilter('search')}
            />
          )}
          <button
            className="text-text-muted hover:text-text-secondary text-xs ml-1"
            onClick={clearAll}
          >
            Clear all
          </button>
        </>
      )}
    </div>
  )
}

function FilterChip({ label, color, onRemove }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
      style={{ backgroundColor: `${color}15`, color }}
    >
      {label}
      <X
        className="w-3 h-3 cursor-pointer hover:opacity-70"
        onClick={onRemove}
      />
    </span>
  )
}
