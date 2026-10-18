/** Ignore retired inputs before validation; log field names only, once per payload. */
export function ignoreDeprecatedFields<T extends Record<string, unknown>>(body: T, fields: readonly string[], surface: string): T {
  const ignored = fields.filter(field => Object.prototype.hasOwnProperty.call(body, field));
  for (const field of ignored) delete body[field];
  if (ignored.length) console.warn(`[${surface}] ignored deprecated field: ${ignored.join(', ')}`);
  return body;
}
export const ACTION_DEPRECATED_FIELDS = ['workflow_status_id', 'cycle_id', 'template_id', 'template_instance_id'];
export const TEMPLATE_DEPRECATED_FIELDS = ['template_id', 'template_instance_id'];
