// @vitest-environment jsdom

import React from 'react';
import { render,screen } from '@testing-library/react';
import axe from 'axe-core';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import ReleasesPage from './ReleasesPage.jsx';
import * as hooks from '../hooks/useReleases.js';
import * as actionHooks from '../hooks/useActions.js';

vi.mock('../hooks/useReleases.js',()=>({useReleasePipelines:vi.fn(),useReleasePipeline:vi.fn(),useReleaseChangelog:vi.fn(),useCreateReleasePipeline:vi.fn(),useUpdateReleasePipeline:vi.fn(),useArchiveReleasePipeline:vi.fn(),useSetReleaseAccessKey:vi.fn(),useCreateReleaseStage:vi.fn(),useCreateRelease:vi.fn(),useAttachReleaseAction:vi.fn(),useDetachReleaseAction:vi.fn(),useTransitionReleaseStage:vi.fn(),useTransitionRelease:vi.fn(),useUpdateRelease:vi.fn(),useGenerateReleaseNotes:vi.fn()}));
vi.mock('../hooks/useActions.js',()=>({useActions:vi.fn()}));
vi.mock('../hooks/useBusinesses.js',()=>({useBusinessContext:()=>({BUSINESS_LIST:[{id:'personal',label:'Personal'}]})}));
function mutation(){return{mutate:vi.fn(),mutateAsync:vi.fn().mockResolvedValue({}),isPending:false}}
const pipeline={id:'p1',name:'Atlas Web',description:'Continuous production delivery',pipeline_type:'continuous',business:'personal',path_filters:['app/**'],auto_generate_notes:true,complete_actions_on_release:false,access_key_fingerprint:'abc123def456',status:'active',revision:3,release_count:1,stage_count:1,stages:[{id:'s1',stage_key:'production',name:'Production',environment:'production',position:0,freeze_on_start:true,revision:0}],releases:[{id:'r1',pipeline_id:'p1',name:'August release',version:'1.2.0',commit_sha:'abc123',status:'in_progress',notes:'## Changes',notes_source:'manual',revision:2,stage_runs:[{id:'run1',stage_id:'s1',status:'started',frozen_at:'2026-08-20T20:00:00Z',revision:1,stage:{id:'s1',name:'Production',environment:'production',position:0}}],actions:[{id:'ra1',action_id:'a1',stage_run_id:'run1',source:'ci',action:{id:'a1',title:'Ship Atlas',status:'done'}}]}]};
describe('ReleasesPage',()=>{
  beforeEach(()=>{vi.clearAllMocks();hooks.useReleasePipelines.mockReturnValue({data:[pipeline],isLoading:false});hooks.useReleasePipeline.mockReturnValue({data:pipeline,isLoading:false});hooks.useReleaseChangelog.mockReturnValue({data:[{id:'old',name:'July release',version:'1.1.0',released_at:'2026-07-20T20:00:00Z',notes:'Previous changes'}],isLoading:false});actionHooks.useActions.mockReturnValue({data:[{id:'a2',title:'Available action'}]});for(const name of ['useCreateReleasePipeline','useUpdateReleasePipeline','useArchiveReleasePipeline','useSetReleaseAccessKey','useCreateReleaseStage','useCreateRelease','useAttachReleaseAction','useDetachReleaseAction','useTransitionReleaseStage','useTransitionRelease','useUpdateRelease','useGenerateReleaseNotes'])hooks[name].mockReturnValue(mutation())});
  it('renders release pipeline portfolio',()=>{render(<ReleasesPage pipelineId={null} selectedBusiness="personal" onOpenPipeline={vi.fn()} onBack={vi.fn()}/>);expect(screen.getByRole('heading',{name:'Releases'})).toBeTruthy();expect(screen.getByRole('button',{name:'Open release pipeline: Atlas Web'})).toBeTruthy();});
  it('renders stages, release attribution, notes, changelog, and guarded CI key control',()=>{render(<ReleasesPage pipelineId="p1" selectedBusiness="personal" onOpenPipeline={vi.fn()} onBack={vi.fn()}/>);expect(screen.getByRole('heading',{name:'Atlas Web'})).toBeTruthy();expect(screen.getByText('Production')).toBeTruthy();expect(screen.getByText('Ship Atlas')).toBeTruthy();expect(screen.getByLabelText('Release notes').value).toBe('## Changes');expect(screen.getByText('July release')).toBeTruthy();expect(screen.getByLabelText('New pipeline access key')).toBeTruthy();expect(screen.getByText(/membership frozen/)).toBeTruthy();});
  it('has no automated semantic accessibility violations',async()=>{const{container}=render(<ReleasesPage pipelineId="p1" selectedBusiness="personal" onOpenPipeline={vi.fn()} onBack={vi.fn()}/>);const results=await axe.run(container,{rules:{'color-contrast':{enabled:false}}});expect(results.violations).toEqual([])});
});
