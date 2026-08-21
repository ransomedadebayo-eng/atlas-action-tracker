export function formatDate(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatDateLong(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

export function formatRelativeDate(dateStr) {
  if (!dateStr) return 'No date';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const date = new Date(dateStr + 'T00:00:00');
  const diffDays = Math.floor((date - today) / (1000 * 60 * 60 * 24));

  if (diffDays < -1) return `Overdue ${Math.abs(diffDays)}d`;
  if (diffDays === -1) return 'Yesterday';
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays <= 7) return `${diffDays}d`;
  return formatDate(dateStr);
}

export function isOverdue(dateStr) {
  if (!dateStr) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const date = new Date(dateStr + 'T00:00:00');
  return date < today;
}

export function isToday(dateStr) {
  if (!dateStr) return false;
  const today = getISODate();
  return dateStr === today;
}

export function getISODate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ATLAS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

export function getFirstDayOfMonth(year, month) {
  return new Date(year, month, 1).getDay();
}

export function formatTimestamp(ts) {
  if (!ts) return '';
  const date = new Date(ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z');
  return date.toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}
export const ATLAS_TIME_ZONE = 'America/Los_Angeles';

export function getPacificWeekStart(date = new Date()) {
  const iso = getISODate(date);
  const parsed = new Date(`${iso}T12:00:00Z`);
  const day = parsed.getUTCDay() || 7;
  parsed.setUTCDate(parsed.getUTCDate() - day + 1);
  return parsed.toISOString().slice(0, 10);
}

export function addISODate(dateStr, days) {
  const date = new Date(`${dateStr}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function getPacificWeekDates(weekStart) {
  return Array.from({ length: 7 }, (_, index) => addISODate(weekStart, index));
}
