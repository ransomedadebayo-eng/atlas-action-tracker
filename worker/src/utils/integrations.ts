export type IntegrationEndpointResult = {
  valid: boolean;
  normalized_url?: string;
  host?: string;
  error?: string;
};

function isPrivateIpv4(hostname: string): boolean {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return false;
  const parts = hostname.split('.').map(Number);
  if (parts.some(part => part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19));
}

export function validateIntegrationEndpoint(input: unknown): IntegrationEndpointResult {
  if (typeof input !== 'string' || !input.trim() || input.length > 2048) return { valid: false, error: 'A bounded HTTPS endpoint is required.' };
  try {
    const url = new URL(input.trim());
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (url.protocol !== 'https:') return { valid: false, error: 'Integration endpoints must use HTTPS.' };
    if (url.username || url.password) return { valid: false, error: 'Integration endpoints cannot contain credentials.' };
    if (url.port && url.port !== '443') return { valid: false, error: 'Integration endpoints may use only the standard HTTPS port.' };
    if (!host || host.length > 253 || host.includes(':')) return { valid: false, error: 'IPv6 and malformed endpoint hosts are not accepted.' };
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')
      || host === 'metadata.google.internal' || host === 'metadata') {
      return { valid: false, error: 'Local and metadata endpoints are not accepted.' };
    }
    if (isPrivateIpv4(host)) return { valid: false, error: 'Private, loopback, link-local, and reserved IP endpoints are not accepted.' };
    url.hash = '';
    return { valid: true, normalized_url: url.toString(), host };
  } catch {
    return { valid: false, error: 'Integration endpoint is not a valid URL.' };
  }
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function hmacSha256Hex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function buildWebhookSigningInput(timestamp: string, deliveryId: string, eventType: string, payload: string): string {
  return JSON.stringify({
    version: 'atlas-webhook-v1',
    timestamp,
    deliveryId,
    eventType,
    payload,
  });
}

export function validWebhookHeaders(deliveryId: string, eventType: string, timestamp: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9:._-]{0,299}$/.test(deliveryId)
    && /^[a-z][a-z0-9._-]{0,99}$/.test(eventType)
    && /^\d{13}$/.test(timestamp);
}

export function timingSafeHexEqual(left: string, right: string): boolean {
  if (!/^[0-9a-f]+$/i.test(left) || !/^[0-9a-f]+$/i.test(right) || left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

export function isFreshWebhookTimestamp(value: unknown, now = Date.now(), toleranceMs = 300_000): boolean {
  const timestamp = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(timestamp) && Math.abs(now - timestamp) <= toleranceMs;
}

export function retryDelayMs(attemptNumber: number): number | null {
  if (attemptNumber === 1) return 60_000;
  if (attemptNumber === 2) return 3_600_000;
  if (attemptNumber === 3) return 21_600_000;
  return null;
}

export function buildWebhookPayload(event: Record<string, any>) {
  return {
    action: event.event_action,
    type: event.resource_type,
    actor: event.actor,
    createdAt: event.created_at,
    data: {
      id: event.resource_id,
      category: event.category,
      summary: event.summary,
      urgency: event.urgency,
      ...((event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)) ? event.payload : {}),
    },
    url: event.target_url,
    eventId: event.id,
  };
}

export function integrationSecret(env: unknown, secretRef: unknown): string | null {
  if (typeof secretRef !== 'string' || !/^ATLAS_INTEGRATION_SECRET_[A-Z0-9_]{1,100}$/.test(secretRef)) return null;
  const value = (env as Record<string, unknown>)[secretRef];
  return typeof value === 'string' && value.length >= 24 ? value : null;
}

export function compactDeliveryError(error: unknown): string {
  const value = error instanceof Error ? `${error.name}:${error.message}` : String(error || 'delivery_failed');
  return value.replace(/[\r\n\t]+/g, ' ').slice(0, 200);
}

export function containsCredentialLikeKey(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(containsCredentialLikeKey);
  return Object.entries(value as Record<string, unknown>).some(([key, nested]) => (
    /(secret|token|password|authorization|api[_-]?key|credential|private[_-]?key)/i.test(key)
    || containsCredentialLikeKey(nested)
  ));
}

export async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > maxBytes) throw new Error('response_too_large');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) throw new Error('response_too_large');
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(merged);
}
