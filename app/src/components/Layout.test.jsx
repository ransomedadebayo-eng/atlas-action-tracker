// @vitest-environment jsdom

import React from 'react';
import{render,screen,within}from'@testing-library/react';
import{describe,expect,it,vi}from'vitest';
import Layout from'./Layout.jsx';

vi.mock('../hooks/useBusinesses.js',()=>({useBusinessContext:()=>({BUSINESS_LIST:[],BUSINESS_COLORS:{},BUSINESSES:{}})}));
vi.mock('../hooks/useTheme.js',()=>({useTheme:()=>({theme:'dark',toggleTheme:vi.fn()})}));

window.matchMedia=vi.fn().mockImplementation(query=>({matches:false,media:query,addEventListener:vi.fn(),removeEventListener:vi.fn()}));

describe('Media navigation',()=>{
  it('places Media in the sidebar and mobile bottom navigation while keeping Kanban out of the bottom bar',()=>{
    render(<Layout currentView="media" setCurrentView={vi.fn()} selectedBusiness={null} setSelectedBusiness={vi.fn()} onOpenQuickCapture={vi.fn()} searchQuery="" setSearchQuery={vi.fn()} sidebarOpen={false} setSidebarOpen={vi.fn()} frozenBusinesses={new Set()} toggleFreezeBusiness={vi.fn()} showFrozen={false} setShowFrozen={vi.fn()}><div>Media content</div></Layout>);
    expect(within(screen.getByLabelText('Sidebar')).getByRole('button',{name:'Media'})).toBeTruthy();
    const mobile=screen.getByRole('navigation',{name:'Main'});
    expect(within(mobile).getByRole('button',{name:'Media'})).toBeTruthy();
    expect(within(mobile).queryByRole('button',{name:'Kanban'})).toBeNull();
  });
});
