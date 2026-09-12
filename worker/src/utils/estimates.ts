import type { SupabaseClient } from '@supabase/supabase-js';

const ESTIMATE_SCALES: Record<string, { base: number[]; extended: number[]; labels?: Record<number, string> }> = {
  linear: { base: [1, 2, 3, 4, 5], extended: [6, 7] },
  fibonacci: { base: [1, 2, 3, 5, 8], extended: [13, 21] },
  exponential: { base: [1, 2, 4, 8, 16], extended: [32, 64] },
  tshirt: { base: [1, 2, 3, 5, 8], extended: [13, 21], labels: { 1: 'XS', 2: 'S', 3: 'M', 5: 'L', 8: 'XL', 13: 'XXL', 21: 'XXXL' } },
};
const DEFAULT_ESTIMATE_SETTINGS = { enabled: true, scale: 'fibonacci', extended: false, allow_zero: true, unestimated_value: 1 };

export function validateEstimateSettings(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['estimate settings must be an object'];
  const settings = value as Record<string, unknown>;
  const errors: string[] = [];
  if (typeof settings.enabled !== 'boolean') errors.push('enabled must be boolean');
  if (typeof settings.scale !== 'string' || !ESTIMATE_SCALES[settings.scale]) errors.push('scale must be linear, fibonacci, exponential, or tshirt');
  if (typeof settings.extended !== 'boolean') errors.push('extended must be boolean');
  if (typeof settings.allow_zero !== 'boolean') errors.push('allow_zero must be boolean');
  if (!Number.isSafeInteger(settings.unestimated_value) || Number(settings.unestimated_value) < 0 || Number(settings.unestimated_value) > 1000) {
    errors.push('unestimated_value must be a non-negative integer up to 1000');
  }
  return errors;
}

export function hydrateEstimateSettings(value: unknown) {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const settings = { ...DEFAULT_ESTIMATE_SETTINGS, ...raw };
  if (validateEstimateSettings(settings).length > 0) Object.assign(settings, DEFAULT_ESTIMATE_SETTINGS);
  const scale = ESTIMATE_SCALES[String(settings.scale)];
  const values = [...(settings.allow_zero ? [0] : []), ...scale.base, ...(settings.extended ? scale.extended : [])];
  return {
    ...settings,
    options: values.map(point => ({ value: point, label: scale.labels?.[point] || String(point) })),
  };
}

export async function validateConfiguredEstimate(supabase: SupabaseClient, value: unknown): Promise<string | null> {
  if (value === undefined || value === null) return null;
  const { data, error } = await supabase.from('atlas_config').select('value').eq('key', 'estimate_settings').maybeSingle();
  if (error) throw error;
  const settings = hydrateEstimateSettings(data?.value);
  if (!settings.enabled) return 'estimate_points cannot be set while estimates are disabled';
  if (!settings.options.some(option => option.value === value)) {
    return `estimate_points must match the configured ${settings.scale} scale: ${settings.options.map(option => option.value).join(', ')}`;
  }
  return null;
}
