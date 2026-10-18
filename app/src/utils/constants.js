export { STATUSES, STATUS_LIST, canonicalStatus, KANBAN_COLUMNS } from './statuses.js';

export const PRIORITIES = {
  p0: { label: 'P0 Urgent', shortLabel: 'P0' },
  p1: { label: 'P1 High', shortLabel: 'P1' },
  p2: { label: 'P2 Medium', shortLabel: 'P2' },
  p3: { label: 'P3 Low', shortLabel: 'P3' },
};

export const PRIORITY_LIST = Object.entries(PRIORITIES).map(([id, val]) => ({
  id,
  ...val,
}));

export function canonicalPriority(priority) {
  const normalized = typeof priority === 'string' ? priority.trim().toLowerCase() : '';
  return PRIORITIES[normalized] ? normalized : null;
}

export const WORK_MODES = {
  autonomous: {
    label: 'Autonomous',
    shortLabel: 'Auto',
    description: 'Agent can execute and verify without user input.',
    order: 0,
  },
  review_required: {
    label: 'Review Required',
    shortLabel: 'Review',
    description: 'Agent should prepare the work, then wait for approval or a decision.',
    order: 1,
  },
  user_only: {
    label: 'User Only',
    shortLabel: 'User',
    description: 'Agent can prepare the work, but Ransomed must perform the final action.',
    order: 2,
  },
};

export const WORK_MODE_LIST = Object.entries(WORK_MODES).map(([id, val]) => ({
  id,
  ...val,
}));

export const APPROVAL_STATES = {
  not_required: { label: 'Not Required' },
  needs_review: { label: 'Needs Review' },
  approved: { label: 'Approved' },
  rejected: { label: 'Rejected' },
  deferred: { label: 'Deferred' },
};

export const APPROVAL_STATE_LIST = Object.entries(APPROVAL_STATES).map(([id, val]) => ({
  id,
  ...val,
}));

export const BUSINESSES = {
  riddim_exchange: { label: 'Riddim Exchange', shortLabel: 'RX' },
  real_estate: { label: 'Real Estate', shortLabel: 'RE' },
  investments: { label: 'Investments', shortLabel: 'INV' },
  personal: { label: 'Personal', shortLabel: 'PER' },
  fitness: { label: 'Fitness', shortLabel: 'FIT' },
  learning_platform: { label: 'Learning Platform', shortLabel: 'LP' },
  improvisr: { label: 'Improvisr', shortLabel: 'IMP' },
};

export const BUSINESS_LIST = Object.entries(BUSINESSES).map(([id, val]) => ({
  id,
  ...val,
}));

export const RECURRENCES = {
  none: { label: 'None' },
  daily: { label: 'Daily' },
  weekly: { label: 'Weekly' },
  biweekly: { label: 'Biweekly' },
  monthly: { label: 'Monthly' },
};

export const RECURRENCE_LIST = Object.entries(RECURRENCES)
  .filter(([id]) => id !== 'none')
  .map(([id, val]) => ({ id, ...val }));

export const TRANSCRIPT_STATUSES = {
  pending: { label: 'Pending Review' },
  reviewed: { label: 'Reviewed' },
  archived: { label: 'Archived' },
};

export const VIEWS = {
  dashboard: 'dashboard',
  kanban: 'kanban',
  calendar: 'calendar',
  members: 'members',
  transcripts: 'transcripts',
};
