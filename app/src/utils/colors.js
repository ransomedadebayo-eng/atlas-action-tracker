export const BUSINESS_COLORS = {
  riddim_exchange: '#22c55e',
  real_estate: '#3b82f6',
  investments: '#a855f7',
  personal: '#f59e0b',
  fitness: '#ef4444',
};

export const PRIORITY_COLORS = {
  p0: '#ef4444',
  p1: '#f97316',
  p2: '#eab308',
  p3: '#71717a',
};

export const STATUS_COLORS = {
  not_started: '#71717a',
  in_progress: '#3b82f6',
  waiting: '#f59e0b',
  blocked: '#ef4444',
  done: '#22c55e',
};

export const MEMBER_COLORS = [
  '#22c55e', '#3b82f6', '#a855f7', '#f59e0b', '#ef4444',
  '#06b6d4', '#ec4899', '#8b5cf6', '#14b8a6', '#f97316',
  '#6366f1', '#84cc16', '#e879f9', '#fb923c', '#38bdf8',
  '#a3e635', '#c084fc',
];

export function getMemberColor(memberId) {
  let hash = 0;
  for (let i = 0; i < memberId.length; i++) {
    hash = memberId.charCodeAt(i) + ((hash << 5) - hash);
  }
  return MEMBER_COLORS[Math.abs(hash) % MEMBER_COLORS.length];
}

export function getBusinessBg(business, businessColors = {}) {
  const color = businessColors[business] || BUSINESS_COLORS[business];
  if (!color) return 'rgba(113, 113, 122, 0.15)';
  return `${color}20`;
}
