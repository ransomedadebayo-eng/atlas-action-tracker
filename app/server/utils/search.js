export function buildSafeIlikePattern(value) {
  const normalized = String(value || '')
    .replace(/[,%()]/g, ' ')
    .replace(/[%_\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);

  return normalized ? `%${normalized}%` : null;
}
