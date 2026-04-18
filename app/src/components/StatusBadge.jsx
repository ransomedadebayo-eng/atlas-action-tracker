import React from 'react';
import { STATUSES, PRIORITIES } from '../utils/constants.js';
import { STATUS_COLORS, PRIORITY_COLORS } from '../utils/colors.js';
import { useBusinessContext } from '../hooks/useBusinesses.js';

export function StatusBadge({ status }) {
  const info = STATUSES[status];
  const color = STATUS_COLORS[status];
  if (!info) return null;

  return (
    <span
      className="badge"
      style={{ backgroundColor: `${color}15`, color, borderColor: `${color}30` }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full mr-1.5"
        style={{ backgroundColor: color }}
      />
      {info.label}
    </span>
  );
}

export function PriorityBadge({ priority }) {
  const info = PRIORITIES[priority];
  const color = PRIORITY_COLORS[priority];
  if (!info) return null;

  return (
    <span
      className={`badge ${priority === 'p0' ? 'animate-pulse-p0' : ''}`}
      style={{ backgroundColor: `${color}15`, color, borderColor: `${color}30` }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full mr-1.5"
        style={{ backgroundColor: color }}
      />
      {info.shortLabel}
    </span>
  );
}

export function BusinessBadge({ business }) {
  const { BUSINESSES, BUSINESS_COLORS } = useBusinessContext();
  const info = BUSINESSES[business];
  const color = BUSINESS_COLORS[business];
  if (!info) return null;

  return (
    <span
      className="badge"
      style={{ backgroundColor: `${color}12`, color, borderColor: `${color}25` }}
    >
      {info.label}
    </span>
  );
}

export function TranscriptStatusBadge({ status }) {
  const config = {
    pending: { label: 'Pending', color: '#ffb95f' },
    reviewed: { label: 'Reviewed', color: '#f4b860' },
    archived: { label: 'Archived', color: '#71717a' },
  };
  const c = config[status] || config.pending;

  return (
    <span
      className="badge"
      style={{ backgroundColor: `${c.color}15`, color: c.color, borderColor: `${c.color}30` }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full mr-1.5"
        style={{ backgroundColor: c.color }}
      />
      {c.label}
    </span>
  );
}
