import { describe, expect, it } from 'vitest';
import { app } from '../index';
import type { Env } from '../db';
import { buildDiscussion, validateAnchor, validateAttachment, validateCommentBody } from './comments';

const codexToken='codex-comment-test-token-0001';
function env(scopes=['comments:read','comments:write']):Env{return{SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'service-role-test-only',NODE_ENV:'production',ATLAS_API_PRINCIPALS_JSON:JSON.stringify({codex:{token:codexToken,scopes}})}}

describe('comment validation and aggregation',()=>{
  it('accepts HTTPS attachment metadata and revision-bound anchors',()=>{
    expect(validateAttachment({title:'Design',url:'https://example.com/design',mime_type:'text/html',size_bytes:42})).toBe(true);
    expect(validateAnchor({field:'content',quote:'selected text',start:2,end:15,source_revision:3})).toBe(true);
    expect(validateCommentBody({body:'Review @codex',mentions:['codex'],attachments:[{title:'Design',url:'https://example.com'}],anchor:{field:'content',quote:'text'}})).toEqual([]);
  });
  it('rejects local or insecure attachments, bad anchors, and invalid mentions',()=>{
    expect(validateAttachment({title:'Local',url:'file:///tmp/secret'})).toBe(false);
    expect(validateAttachment({title:'HTTP',url:'http://example.com'})).toBe(false);
    expect(validateAnchor({field:'content',quote:'x',start:5,end:2})).toBe(false);
    expect(validateCommentBody({body:'x',mentions:['unknown'],attachments:[]})).toContain('mentions must contain unique canonical principals');
  });
  it('builds ordered roots, replies, and actor reaction groups',()=>{
    const comments=[{id:'root',created_at:'2026-08-20T01:00:00Z'},{id:'reply',thread_root_id:'root',created_at:'2026-08-20T02:00:00Z'}];
    const reactions=[{target_type:'comment',target_id:'root',emoji:'👍',actor:'codex',status:'active'},{target_type:'comment',target_id:'root',emoji:'👍',actor:'ransomed',status:'active'},{target_type:'comment',target_id:'reply',emoji:'✅',actor:'codex',status:'active'}];
    const result=buildDiscussion(comments,reactions,'codex');
    expect(result.threads).toHaveLength(1); expect(result.threads[0].replies).toHaveLength(1); expect(result.threads[0].reactions[0]).toEqual({emoji:'👍',count:2,actors:['codex','ransomed']}); expect(result.threads[0].replies[0].reacted_by_actor).toEqual(['✅']);
  });
});

describe('comment HTTP boundary',()=>{
  it('requires comment read scope',async()=>{const response=await app.request('/api/comments?target_type=action&target_id=a1',{headers:{authorization:`Bearer ${codexToken}`}},env(['actions:read']));expect(response.status).toBe(403);await expect(response.json()).resolves.toMatchObject({details:{required_scope:'comments:read'}})});
  it('requires comment write scope',async()=>{const response=await app.request('/api/comments',{method:'POST',headers:{authorization:`Bearer ${codexToken}`,'content-type':'application/json'},body:JSON.stringify({target_type:'action',target_id:'a1',body:'Comment'})},env(['comments:read']));expect(response.status).toBe(403);await expect(response.json()).resolves.toMatchObject({details:{required_scope:'comments:write'}})});
});
