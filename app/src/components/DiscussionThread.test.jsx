// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DiscussionThread, { mentionsFrom } from './DiscussionThread.jsx';
import * as hooks from '../hooks/useComments.js';

vi.mock('../hooks/useComments.js',()=>({useDiscussion:vi.fn(),useCreateComment:vi.fn(),useUpdateComment:vi.fn(),useArchiveComment:vi.fn(),useRestoreComment:vi.fn(),useResolveComment:vi.fn(),useReopenComment:vi.fn(),useToggleReaction:vi.fn(),useSetDiscussionSubscription:vi.fn()}));
function mutation(){return{mutate:vi.fn(),mutateAsync:vi.fn().mockResolvedValue({}),isPending:false}}
const discussion={current_actor:'ransomed',subscription:{status:'active'},target_reactions:[{emoji:'👀',count:1,actors:['codex']}],target_reacted_by_actor:[],threads:[{id:'c1',body:'What should ship?',status:'active',revision:2,created_by:'ransomed',created_at:'2026-08-20T20:00:00Z',updated_at:'2026-08-20T20:00:00Z',anchor:{field:'content',quote:'Ship safely',source_revision:2},attachments:[{title:'Design',url:'https://example.com/design'}],reactions:[{emoji:'👍',count:1,actors:['codex']}],reacted_by_actor:[],resolved_at:'2026-08-20T22:00:00Z',resolved_by:'ransomed',replies:[{id:'c2',thread_root_id:'c1',body:'Use the safe path.',status:'active',revision:0,created_by:'codex',created_at:'2026-08-20T21:00:00Z',updated_at:'2026-08-20T21:00:00Z',attachments:[],reactions:[],reacted_by_actor:[]}]}]};
describe('DiscussionThread',()=>{
  beforeEach(()=>{vi.clearAllMocks();hooks.useDiscussion.mockReturnValue({data:discussion,isLoading:false,isError:false});for(const name of ['useCreateComment','useUpdateComment','useArchiveComment','useRestoreComment','useResolveComment','useReopenComment','useToggleReaction','useSetDiscussionSubscription'])hooks[name].mockReturnValue(mutation())});
  it('extracts canonical mentions without duplicates',()=>{expect(mentionsFrom('Ask @Codex and @codex then @ransomed')).toEqual(['codex','ransomed'])});
  it('renders roots, replies, anchors, attachments, reactions, and resolution state',()=>{render(<DiscussionThread targetType="document" targetId="d1"/>);expect(screen.getByText('What should ship?')).toBeTruthy();expect(screen.getByText('Use the safe path.')).toBeTruthy();expect(screen.getByText(/Ship safely/)).toBeTruthy();expect(screen.getByRole('link',{name:'Design'})).toBeTruthy();expect(screen.getByText(/Resolved by ransomed/)).toBeTruthy();expect(screen.getByRole('button',{name:/👀 reaction/})).toBeTruthy();});
  it('opens a reply composer and exposes follow state',()=>{render(<DiscussionThread targetType="project" targetId="p1"/>);fireEvent.click(screen.getByRole('button',{name:/Reply/}));expect(screen.getByLabelText('Reply body')).toBeTruthy();expect(screen.getByRole('button',{name:/Mute/})).toBeTruthy();});
  it('has no automated semantic accessibility violations',async()=>{const{container}=render(<DiscussionThread targetType="action" targetId="a1"/>);const results=await axe.run(container,{rules:{'color-contrast':{enabled:false}}});expect(results.violations).toEqual([])});
});
