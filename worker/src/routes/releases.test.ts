import { describe,expect,it } from 'vitest';
import { app } from '../index';
import type { Env } from '../db';
import { matchesPathFilters,validatePipelineBody,validateReleaseEvent,validateStageBody } from './releases';

const token='codex-release-test-token-0001';
function env(scopes=['releases:read','releases:write']):Env{return{SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'service-role-test-only',NODE_ENV:'production',ATLAS_API_PRINCIPALS_JSON:JSON.stringify({codex:{token,scopes}})}}
describe('release validation',()=>{
  it('validates pipelines, stage definitions, and CI events',()=>{expect(validatePipelineBody({name:'Web',pipeline_type:'continuous',path_filters:['app/**']})).toEqual([]);expect(validateStageBody({stage_key:'prod',name:'Production',environment:'production',position:0})).toEqual([]);expect(validateReleaseEvent({event_key:'deploy-1',event_type:'stage_started',external_release_id:'sha-1',stage_key:'production',action_ids:['a1'],changed_paths:['app/a.js']})).toEqual([])});
  it('rejects unsafe paths and incomplete stage events',()=>{expect(validatePipelineBody({name:'Web',pipeline_type:'bad',path_filters:['../secret']})).toEqual(expect.arrayContaining(['pipeline_type is invalid','path_filters must be safe glob strings']));expect(validateReleaseEvent({event_key:'x',event_type:'stage_started',external_release_id:'r1'})).toContain('stage_key is required for stage events')});
  it('matches monorepo path globs deterministically',()=>{expect(matchesPathFilters(['app/src/a.js'],['app/**'])).toBe(true);expect(matchesPathFilters(['worker/src/a.ts'],['app/**'])).toBe(false);expect(matchesPathFilters([],['app/**'])).toBe(true)});
});
describe('release HTTP boundary',()=>{
  it('requires release read scope',async()=>{const response=await app.request('/api/releases/pipelines',{headers:{authorization:`Bearer ${token}`}},env(['actions:read']));expect(response.status).toBe(403);await expect(response.json()).resolves.toMatchObject({details:{required_scope:'releases:read'}})});
  it('keeps pipeline configuration owner-only',async()=>{const response=await app.request('/api/releases/pipelines',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({name:'Protected'})},env());expect(response.status).toBe(403);await expect(response.json()).resolves.toMatchObject({code:'OWNER_REQUIRED'})});
  it('requires ingest scope on CI endpoint',async()=>{const response=await app.request('/api/releases/ingest/p1',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:'{}'},env(['releases:write']));expect(response.status).toBe(403);await expect(response.json()).resolves.toMatchObject({details:{required_scope:'releases:ingest'}})});
  it('keeps release archive owner-only on the real transition route',async()=>{const response=await app.request('/api/releases/items/release-1/transition',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({status:'archived',expected_revision:0})},env(['releases:write']));expect(response.status).toBe(403);await expect(response.json()).resolves.toMatchObject({code:'OWNER_REQUIRED'})});
});
