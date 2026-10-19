export const FOCUS_PHASES = [
  { id: 'focus', label: 'Focus', setting: 'focus_minutes', min: 1, max: 180 },
  { id: 'short_break', label: 'Short break', setting: 'short_break_minutes', min: 1, max: 60 },
  { id: 'long_break', label: 'Long break', setting: 'long_break_minutes', min: 1, max: 120 },
];

// Measure the server clock at the request midpoint, rather than trusting the
// device clock or subtracting one second per tick (background tabs can sleep).
export function sampleFocusState(state, sentAt, receivedAt) {
  const serverNow = Date.parse(state?.server_now);
  if (!Number.isFinite(serverNow) || !Number.isInteger(state?.revision) || state.revision < 0
    || !['ready', 'running', 'paused'].includes(state?.status)
    || !FOCUS_PHASES.some(phase => phase.id === state?.phase)) {
    throw new Error('The server returned an invalid Focus state. Refresh to try again.');
  }
  return { ...state, clock_offset_ms: serverNow - (sentAt + receivedAt) / 2 };
}

export function focusRemainingMs(state, now = Date.now()) {
  if (!state) return 0;
  if (state.status === 'running' && state.deadline_at) {
    return Math.max(0, Date.parse(state.deadline_at) - now - (state.clock_offset_ms || 0));
  }
  return Math.max(0, Number(state.remaining_ms) || 0);
}

export function formatCountdown(milliseconds) {
  const seconds = Math.ceil(Math.max(0, milliseconds) / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function formatFocusTime(milliseconds) {
  const minutes = Math.floor(Math.max(0, Number(milliseconds) || 0) / 60000);
  if (!minutes && milliseconds > 0) return '<1 min';
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes} min`;
}

export function eligibleFocusProject(project) {
  return Boolean(project?.id && !project.archived_at
    && !['archived', 'completed', 'done', 'closed', 'canceled', 'cancelled'].includes(project.status));
}

export function parseFocusSettings(draft) {
  const settings = { chime_enabled: Boolean(draft.chime_enabled) };
  for (const phase of FOCUS_PHASES) {
    const value = Number(draft[phase.setting]);
    if (!Number.isInteger(value) || value < phase.min || value > phase.max) {
      throw new Error(`${phase.label} must be a whole number from ${phase.min} to ${phase.max} minutes.`);
    }
    settings[phase.setting] = value;
  }
  return settings;
}
