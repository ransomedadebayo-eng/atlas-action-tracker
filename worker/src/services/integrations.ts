import { Env, getDb } from '../db';
import {
  buildWebhookPayload, buildWebhookSigningInput, compactDeliveryError, hmacSha256Hex,
  integrationSecret, sha256Hex, validateIntegrationEndpoint,
} from '../utils/integrations';

type Row = Record<string, any>;

export async function dispatchPendingDeliveries(env: Env, actor = 'delivery_worker', limit = 10) {
  const supabase = getDb(env);
  const now = new Date().toISOString();
  const { data, error } = await supabase.from('atlas_outbox_deliveries')
    .select('*,event:atlas_notification_events!event_id(*),connection:atlas_integration_connections!connection_id(*),subscription:atlas_integration_subscriptions!subscription_id(*)')
    .in('status', ['pending', 'retry_wait']).lte('next_attempt_at', now).order('created_at').limit(Math.min(Math.max(limit, 1), 25));
  if (error) throw error;
  const results: Row[] = [];
  for (const queued of data || []) {
    const claimToken = crypto.randomUUID();
    const claimed = await supabase.rpc('claim_atlas_delivery', { p_delivery_id: queued.id, p_claim_token: claimToken, p_actor: actor });
    if (claimed.error || !claimed.data) {
      results.push({ delivery_id: queued.id, status: 'claim_failed', error: claimed.error?.message || 'claim_failed' });
      continue;
    }
    const connection = queued.connection as Row;
    const endpoint = validateIntegrationEndpoint(connection?.endpoint_url);
    const secret = integrationSecret(env, connection?.secret_ref);
    const payload = JSON.stringify(buildWebhookPayload((queued.event || {}) as Row));
    const requestHash = await sha256Hex(payload);
    const started = Date.now();
    let responseStatus: number | null = null;
    let success = false;
    let errorCode = '';
    try {
      if (!endpoint.valid || !endpoint.normalized_url) throw new Error(endpoint.error || 'endpoint_invalid');
      if (!secret) throw new Error('integration_secret_unavailable');
      const timestamp = Date.now().toString();
      const deliveryId = String(queued.id);
      const eventType = String(queued.event?.resource_type || 'system');
      const signature = await hmacSha256Hex(secret, buildWebhookSigningInput(timestamp, deliveryId, eventType, payload));
      const response = await fetch(endpoint.normalized_url, {
        method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(5000),
        headers: {
          'Content-Type': 'application/json; charset=utf-8', 'Accept-Charset': 'utf-8',
          'Atlas-Delivery': deliveryId, 'Atlas-Event': eventType,
          'Atlas-Signature': signature, 'Atlas-Signature-Version': 'v1', 'Atlas-Timestamp': timestamp, 'User-Agent': 'Atlas-Webhook/1.0',
        },
        body: payload,
      });
      responseStatus = response.status;
      success = response.status === 200;
      if (!success) errorCode = `http_${response.status}`;
    } catch (deliveryError) {
      errorCode = compactDeliveryError(deliveryError);
    }
    const completed = await supabase.rpc('complete_atlas_delivery_attempt', {
      p_delivery_id: queued.id, p_claim_token: claimToken, p_success: success,
      p_response_status: responseStatus, p_request_sha256: requestHash,
      p_endpoint_sha256: connection.endpoint_sha256, p_duration_ms: Date.now() - started,
      p_error_code: errorCode, p_actor: actor,
    });
    if (completed.error) throw completed.error;
    results.push({ delivery_id: queued.id, status: completed.data?.status || (success ? 'delivered' : 'failed'), response_status: responseStatus });
  }
  return { processed: results.length, results };
}
