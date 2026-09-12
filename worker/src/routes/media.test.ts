import { describe, expect, it } from 'vitest';
import { app } from '../index';
import type { Env } from '../db';
import { buildDailyMap, buildMediaPayload, buildTwitterAllowance, getPacificWeekStart, validateMediaUpsertBody } from './media';

const codexToken='codex-media-test-token-000001';
function env(scopes=['media:read','media:write']):Env{return{SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'service-role-test-only',NODE_ENV:'production',ATLAS_API_PRINCIPALS_JSON:JSON.stringify({codex:{token:codexToken,scopes}})}};
const reset={id:'reset',item_type:'reset',status:'queued',planned_date:null,rank:6,title:'Reset',trigger_kind:'after_work_reset'};
const ownerAction={id:'a1',title:'Finish the launch brief',status:'in_progress',owners:['ransomed'],work_mode:'review_required',next_action:'Draft the opening section'};

describe('media daily guidance helpers',()=>{
  it('resolves the Pacific Monday across a UTC boundary',()=>{
    expect(getPacificWeekStart(new Date('2026-08-31T01:00:00Z'))).toBe('2026-08-24');
    expect(getPacificWeekStart(new Date('2026-08-31T08:00:00Z'))).toBe('2026-08-31');
  });

  it('returns today’s item and a complete seven-day map',()=>{
    const plan={id:'p1',week_start:'2026-08-24',source_status:'partial',capacity_class:'recovery'};
    const items=[
      {id:'missed',item_type:'consumable',status:'queued',planned_date:'2026-08-28',rank:0,title:'Missed item',eligible_from:'2026-08-28T16:00:00Z',eligible_until:'2026-08-28T23:00:00Z'},
      {id:'today',item_type:'consumable',status:'queued',planned_date:'2026-08-29',rank:1,title:'Saturday item',trigger_kind:'saturday_walk',eligible_from:'2026-08-29T16:00:00Z',eligible_until:'2026-08-29T23:00:00Z'},
      {id:'future',item_type:'consumable',status:'queued',planned_date:'2026-08-30',rank:2,title:'Sunday item',trigger_kind:'sunday_faith',eligible_from:'2026-08-30T14:00:00Z',eligible_until:'2026-08-30T19:00:00Z'},reset];
    const payload=buildMediaPayload(plan,items,'2026-08-29','2026-08-29T18:00:00Z',{items:[{action:ownerAction}]},null);
    expect(payload.today_item).toMatchObject({id:'today'});
    expect(payload.primary_recommendation).toMatchObject({kind:'media',item:{id:'today'}});
    expect(payload.daily_limit).toBe(1);
    expect(payload.items.find((item:any)=>item.id==='missed')).toMatchObject({display_status:'missed'});
    expect(payload.next_planned_trigger).toBe('sunday_faith');
    expect(payload.source_warning).toContain('verified choices');
    expect(payload.daily_map).toHaveLength(7);
    expect(payload.today_guidance).toMatchObject({date:'2026-08-29',kind:'item',item:{id:'today'}});
  });

  it('shows today’s planned choice before its suggested time and never promotes an Atlas task',()=>{
    const plan={id:'p1',week_start:'2026-08-24',source_status:'complete',capacity_class:'standard'};
    const items=[{id:'done',item_type:'consumable',status:'done',planned_date:'2026-08-29',rank:0,title:'Morning item',eligible_from:'2026-08-29T12:30:00Z',eligible_until:'2026-08-29T16:00:00Z'},{id:'later-window',item_type:'consumable',status:'queued',planned_date:'2026-08-29',rank:1,title:'Later item',eligible_from:'2026-08-29T22:00:00Z',eligible_until:'2026-08-30T01:00:00Z'},reset];
    const todayPlan={items:[{action:{id:'agent',title:'Agent work',status:'in_progress',owners:['codex'],work_mode:'autonomous'}},{action:ownerAction}]};
    const payload=buildMediaPayload(plan,items,'2026-08-29','2026-08-29T19:00:00Z',todayPlan,null);
    expect(payload.today_item).toMatchObject({id:'later-window'});
    expect(payload.primary_recommendation).toMatchObject({kind:'media',item:{id:'later-window'}});
    expect(payload.primary_recommendation.action).toBeUndefined();
    expect(payload.next_window).toMatchObject({id:'later-window'});
    expect(payload.windows_used).toBe(1);
    expect(payload.windows_remaining).toBe(0);
  });

  it('keeps today’s planned choice stable when its suggested time arrives',()=>{
    const plan={id:'p1',week_start:'2026-08-24',source_status:'complete',capacity_class:'standard'};
    const items=[{id:'done',item_type:'consumable',status:'done',planned_date:'2026-08-29',rank:0,title:'Morning item',eligible_from:'2026-08-29T12:30:00Z',eligible_until:'2026-08-29T16:00:00Z'},{id:'later-window',item_type:'consumable',status:'queued',planned_date:'2026-08-29',rank:1,title:'Later item',eligible_from:'2026-08-29T22:00:00Z',eligible_until:'2026-08-30T01:00:00Z'},reset];
    const payload=buildMediaPayload(plan,items,'2026-08-29','2026-08-29T23:00:00Z',{items:[{action:ownerAction}]},null);
    expect(payload.primary_recommendation).toMatchObject({kind:'media',item:{id:'later-window'}});
  });

  it('uses an explicit open-day instruction when no media is planned',()=>{
    const payload=buildMediaPayload({id:'p1',week_start:'2026-08-24',source_status:'complete',capacity_class:'recovery'},[reset],'2026-08-29','2026-08-29T18:00:00Z',{items:[]},null);
    expect(payload.primary_recommendation).toMatchObject({kind:'open',heading:'No planned media today'});
    expect(payload.today_guidance).toMatchObject({kind:'open',title:'No planned media today'});
    expect(payload.reset_item).toMatchObject({id:'reset'});
  });

  it('does not replace an open day with system cutoff language at night',()=>{
    const payload=buildMediaPayload({id:'p1',week_start:'2026-08-24',source_status:'complete',capacity_class:'recovery'},[reset],'2026-08-29','2026-08-30T06:36:00Z',{items:[{action:ownerAction}]},null);
    expect(payload.primary_recommendation).toMatchObject({kind:'open',heading:'No planned media today'});
  });

  it('derives explicit open days around scheduled and completed choices',()=>{
    const map=buildDailyMap('2026-08-24',[{id:'done',item_type:'consumable',status:'done',planned_date:'2026-08-25',title:'Done'},{id:'future',item_type:'consumable',status:'queued',planned_date:'2026-08-28',title:'Future',purpose:'Learn one thing'}],'2026-08-27');
    expect(map).toHaveLength(7);
    expect(map[1]).toMatchObject({kind:'complete',title:'Done'});
    expect(map[3]).toMatchObject({kind:'open',title:'No planned media today'});
    expect(map[4]).toMatchObject({kind:'item',title:'Future'});
  });

  it('offers Twitter once from 6-8 PM Pacific and preserves a started allowance',()=>{
    expect(buildTwitterAllowance(null,new Date('2026-08-30T01:30:00Z'))).toMatchObject({available:true,state:'available'});
    expect(buildTwitterAllowance(null,new Date('2026-08-30T03:30:00Z'))).toMatchObject({available:false,state:'closed'});
    expect(buildTwitterAllowance({twitter_started_at:'2026-08-30T01:30:00Z',twitter_expires_at:'2026-08-30T01:45:00Z'},new Date('2026-08-30T01:35:00Z'))).toMatchObject({available:false,state:'active'});
  });

  it('validates a capacity-independent one-choice-per-day map before database work',()=>{
    expect(validateMediaUpsertBody({week_start:'2026-08-25',items:[]})).toContain('week_start must be a valid Pacific Monday');
    const duplicateRecovery=[0,1].map(rank=>({source_key:String(rank),platform:'youtube',category:'leisure',item_type:'consumable',title:'x',creator:'Creator',source_url:'https://www.youtube.com/watch?v='+rank,planned_date:'2026-08-24',trigger_kind:rank?'daytime_transition_1':'weekday_morning',purpose:'x',input_job:'restore',selection_reason:'Chosen for a deliberate recovery window',stop_rule:'Stop when it ends',rank}));
    const resetItem={source_key:'reset',platform:'apple_music',category:'reset',item_type:'reset',title:'Reset',planned_date:null,trigger_kind:'after_work_reset',purpose:'Use familiar audio',input_job:'reset',selection_reason:'Lowers stimulation',stop_rule:'Keep the screen off',rank:2};
    const body={week_start:'2026-08-24',capacity_class:'recovery',source_status:'complete',source_fingerprint:'x',intent_summary:'Restore without opening a feed.',input_jobs:['restore'],weekly_budget:3,items:[...duplicateRecovery,resetItem]};
    expect(validateMediaUpsertBody(body)).toContain('plans may schedule only one consumable per day');
    expect(validateMediaUpsertBody({...body,items:[{...duplicateRecovery[0],source_url:'https://www.morningbrew.com/'},resetItem]})).toContain('items[0].source_url must link directly to a specific item');
    expect(validateMediaUpsertBody({...body,weekly_budget:0,items:[resetItem]})).toContain('weekly_budget must be between one and six');
    expect(validateMediaUpsertBody({...body,input_jobs:['orient','advance','restore'],weekly_budget:6,items:[{...duplicateRecovery[0],platform:'spotify',source_url:'https://open.spotify.com/episode/example',input_job:'orient'},resetItem]})).not.toContain('input_jobs must contain up to three unique jobs');
    expect(validateMediaUpsertBody({...body,items:[{...duplicateRecovery[0],platform:'other',source_url:null},resetItem]})).not.toContain('items[0].source_url must link directly to a specific item');
  });
});

describe('media plan HTTP boundary',()=>{
  it('requires media read scope',async()=>{const response=await app.request('/api/media/current',{headers:{authorization:`Bearer ${codexToken}`}},env(['actions:read']));expect(response.status).toBe(403)});
  it('keeps consumption and Twitter allowance status owner-only',async()=>{
    const statusResponse=await app.request('/api/media/items/item-1/status',{method:'POST',headers:{authorization:`Bearer ${codexToken}`,'content-type':'application/json'},body:JSON.stringify({expected_revision:1,status:'done',idempotency_key:'x'})},env());expect(statusResponse.status).toBe(403);
    const feedbackResponse=await app.request('/api/media/items/item-1/feedback',{method:'POST',headers:{authorization:`Bearer ${codexToken}`,'content-type':'application/json'},body:JSON.stringify({outcome:'helpful',idempotency_key:'feedback-1'})},env());expect(feedbackResponse.status).toBe(403);
    const twitterResponse=await app.request('/api/media/daily/2026-08-29/twitter/start',{method:'POST',headers:{authorization:`Bearer ${codexToken}`,'content-type':'application/json'},body:JSON.stringify({idempotency_key:'twitter-1'})},env());expect(twitterResponse.status).toBe(403);
    const protocolResponse=await app.request('/api/media/sync-protocols/activate',{method:'POST',headers:{authorization:`Bearer ${codexToken}`,'content-type':'application/json'},body:'{}'},env());expect(protocolResponse.status).toBe(403);
  });
  it('requires media write scope for curation, sync evidence, and reviews',async()=>{for(const path of ['/api/media/plans/upsert','/api/media/sync-manifests','/api/media/sync-applies','/api/media/input-reviews']){const response=await app.request(path,{method:'POST',headers:{authorization:`Bearer ${codexToken}`,'content-type':'application/json'},body:'{}'},env(['media:read']));expect(response.status).toBe(403)}});
});
