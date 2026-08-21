// @vitest-environment jsdom

import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import axe from 'axe-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import NotificationsPage from './NotificationsPage.jsx'
import * as hooks from '../hooks/useNotifications.js'

vi.mock('../hooks/useNotifications.js',()=>({
  useCreateIntegrationConnection:vi.fn(),useCreateIntegrationSubscription:vi.fn(),useIntegrations:vi.fn(),
  useNotificationSummary:vi.fn(),useNotifications:vi.fn(),useProcessIntegrationDeliveries:vi.fn(),
  useReadAllNotifications:vi.fn(),useTransitionInboundEvent:vi.fn(),useTransitionIntegrationConnection:vi.fn(),
  useTransitionIntegrationSubscription:vi.fn(),useTransitionNotification:vi.fn(),useUpdateNotificationPreference:vi.fn(),
  useVerifyIntegrationConnection:vi.fn(),
}));
vi.mock('../hooks/useBusinesses.js',()=>({useBusinessContext:()=>({BUSINESS_LIST:[{id:'personal',label:'Personal'}]})}));
function mutation(result={}){return{mutate:vi.fn(),mutateAsync:vi.fn().mockResolvedValue(result),isPending:false}}
const notification={id:'n1',status:'unread',revision:0,created_at:'2026-08-20T20:00:00Z',event:{category:'status_changes',urgency:'high',summary:'Action completed',actor:'ransomed',target_url:'/actions/a1'}};
const preferences=['inbox','browser','email','slack','webhook'].map((channel,index)=>({id:`p${index}`,channel,category:'all',delivery_mode:channel==='inbox'?'immediate':'disabled',revision:0}));
const integrations={connections:[],deliveries:[],inbound:[],external_references:[],delivery_enabled:false};

describe('NotificationsPage',()=>{
  beforeEach(()=>{vi.clearAllMocks();hooks.useNotifications.mockReturnValue({data:{items:[notification],unread:1},isLoading:false,isError:false});hooks.useNotificationSummary.mockReturnValue({data:{unread_count:1,preferences,subscriptions:[]},isLoading:false,isError:false});hooks.useIntegrations.mockReturnValue({data:integrations,isLoading:false,isError:false});for(const name of Object.keys(hooks).filter(name=>!['useNotifications','useNotificationSummary','useIntegrations'].includes(name)))hooks[name].mockReturnValue(mutation())});
  it('renders the always-available Inbox and notification controls',()=>{render(<NotificationsPage/>);expect(screen.getByRole('heading',{name:'Notifications & Integrations'})).toBeTruthy();expect(screen.getByText('Action completed')).toBeTruthy();expect(screen.getByRole('button',{name:/Read all/})).toBeTruthy();expect(screen.getByRole('button',{name:/Archive/})).toBeTruthy()});
  it('shows per-channel preferences with external channels disabled',()=>{render(<NotificationsPage/>);fireEvent.click(screen.getByRole('tab',{name:'Preferences'}));expect(screen.getByRole('heading',{name:'Notification preferences'})).toBeTruthy();expect(screen.getByLabelText('Atlas Inbox delivery mode').value).toBe('immediate');expect(screen.getByLabelText('Slack delivery mode').value).toBe('disabled')});
  it('creates only draft connections from the UI',()=>{render(<NotificationsPage/>);fireEvent.click(screen.getByRole('tab',{name:'Connections'}));expect(screen.getByRole('heading',{name:'New integration connection'})).toBeTruthy();expect(screen.getByText(/No destination activates/)).toBeTruthy();expect(screen.getByRole('button',{name:/Create draft/})).toBeTruthy();expect(screen.getByText('No integration destination is configured.')).toBeTruthy()});
  it('shows disabled automatic delivery and empty immutable receipts',()=>{render(<NotificationsPage/>);fireEvent.click(screen.getByRole('tab',{name:'Deliveries'}));expect(screen.getByRole('heading',{name:'Delivery receipts'})).toBeTruthy();expect(screen.getByText(/Automatic post-mutation delivery is disabled/)).toBeTruthy();expect(screen.getByRole('button',{name:/Process pending/}).disabled).toBe(true)});
  it('shows inbound payloads as review-only staging',()=>{render(<NotificationsPage/>);fireEvent.click(screen.getByRole('tab',{name:'Inbound'}));expect(screen.getByRole('heading',{name:'Inbound events'})).toBeTruthy();expect(screen.getByText(/cannot mutate Atlas automatically/)).toBeTruthy();expect(screen.getByText('No inbound payloads are staged.')).toBeTruthy()});
  it('has no automated semantic accessibility violations',async()=>{const{container}=render(<NotificationsPage/>);await waitFor(()=>expect(screen.getByText('Action completed')).toBeTruthy());const findings=await axe.run(container,{rules:{'color-contrast':{enabled:false}}});expect(findings.violations).toEqual([])});
});
