import { describe, expect, it } from 'vitest';
import { app } from '../index';
import type { Env } from '../db';

const token='codex-integration-test-token-0001';
function env(scopes=['notifications:read','notifications:write','integrations:read','integrations:write']):Env{return{SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'service-role-test-only',NODE_ENV:'production',ATLAS_API_PRINCIPALS_JSON:JSON.stringify({codex:{token,scopes}})}};

describe('notification and integration HTTP boundaries',()=>{
  it('requires notification read scope',async()=>{const response=await app.request('/api/notifications',{headers:{authorization:`Bearer ${token}`}},env(['actions:read']));expect(response.status).toBe(403);await expect(response.json()).resolves.toMatchObject({details:{required_scope:'notifications:read'}})});
  it('requires integration read scope',async()=>{const response=await app.request('/api/integrations',{headers:{authorization:`Bearer ${token}`}},env(['actions:read']));expect(response.status).toBe(403);await expect(response.json()).resolves.toMatchObject({details:{required_scope:'integrations:read'}})});
  it('keeps Inbox transitions owner-only',async()=>{const response=await app.request('/api/notifications/n1/read',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:'{}'},env());expect(response.status).toBe(403);await expect(response.json()).resolves.toMatchObject({code:'OWNER_REQUIRED'})});
  it('keeps connection creation and delivery processing owner-only',async()=>{const create=await app.request('/api/integrations/connections',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:'{}'},env());const process=await app.request('/api/integrations/deliveries/process',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:'{}'},env());expect(create.status).toBe(403);expect(process.status).toBe(403)});
  it('routes oversized hooks before application authentication and database access',async()=>{const response=await app.request('/hooks/connection-1',{method:'POST',headers:{'content-type':'application/json','content-length':'70000'},body:'{}'},env());expect(response.status).toBe(413);await expect(response.json()).resolves.toMatchObject({code:'INBOUND_TOO_LARGE'})});
  it('requires JSON for the public signed-hook boundary',async()=>{const response=await app.request('/hooks/connection-1',{method:'POST',headers:{'content-type':'text/plain'},body:'hello'},env());expect(response.status).toBe(415);await expect(response.json()).resolves.toMatchObject({code:'INBOUND_CONTENT_TYPE'})});
  it('requires the versioned signed-header envelope before database access',async()=>{const response=await app.request('/hooks/connection-1',{method:'POST',headers:{'content-type':'application/json','atlas-delivery':'delivery-1','atlas-event':'project','atlas-timestamp':Date.now().toString(),'atlas-signature':'0'.repeat(64)},body:'{}'},env());expect(response.status).toBe(400);await expect(response.json()).resolves.toMatchObject({code:'INBOUND_HEADERS_INVALID'})});
});
