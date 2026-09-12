// @vitest-environment jsdom

import React from 'react';
import { render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DocumentsPage from './DocumentsPage.jsx';
import * as hooks from '../hooks/useDocuments.js';
import { useDocumentRealtime } from '../hooks/useDocumentRealtime.js';

vi.mock('./LazyDiscussionThread.jsx', () => ({ default: ({ targetType }) => <div data-testid={`${targetType}-discussion`} /> }));

vi.mock('../hooks/useDocuments.js', () => ({ useDocuments: vi.fn(), useDocument: vi.fn(), useCreateDocument: vi.fn(), useUpdateDocument: vi.fn(), useArchiveDocument: vi.fn(), useRestoreDocument: vi.fn(), useRevertDocument: vi.fn() }));
vi.mock('../hooks/useDocumentRealtime.js', () => ({ useDocumentRealtime: vi.fn() }));
function mutation() { return { mutate: vi.fn(), mutateAsync: vi.fn().mockResolvedValue({}), isPending: false }; }
const document = { id: 'd1', title: 'Launch plan', content: '# Launch\nShip safely.', context_type: 'project', context_id: 'p1', status: 'active', revision: 2, updated_by: 'ransomed', updated_at: '2026-08-20T20:00:00Z', template_id: 't1', template_instance_id: 'x1', versions: [{ id: 2, revision: 2, content: '# Launch\nShip safely.', actor: 'ransomed', created_at: '2026-08-20T20:00:00Z' },{ id: 1, revision: 1, content: '# Launch\nDraft.', actor: 'codex', created_at: '2026-08-20T19:00:00Z' }] };
function realtime(overrides={}) { return { clientId:'browser:test',document,draft:{title:document.title,content:document.content},syncState:'synced',presence:[{actor:'ransomed',client_id:'browser:test',selection:{start:0,end:8}}],conflict:null,operations:[{id:'o1',applied_revision:2,merge_strategy:'three_way',actor:'ransomed',created_at:'2026-08-20T20:00:00Z'}],conflicts:[],error:'',updateDraft:vi.fn(),updatePresence:vi.fn(),flush:vi.fn(),useLatest:vi.fn(),retryDraft:vi.fn(),...overrides } }
describe('DocumentsPage', () => {
  beforeEach(() => { vi.clearAllMocks(); hooks.useDocuments.mockReturnValue({ data: [document], isLoading: false }); hooks.useDocument.mockReturnValue({ data: document, isLoading: false, isError: false }); for (const name of ['useCreateDocument', 'useUpdateDocument', 'useArchiveDocument', 'useRestoreDocument','useRevertDocument']) hooks[name].mockReturnValue(mutation()); useDocumentRealtime.mockReturnValue(realtime()); });
  it('renders document list and stable open control', () => { render(<DocumentsPage documentId={null} searchQuery="" onOpenDocument={vi.fn()} onBack={vi.fn()} />); expect(screen.getByRole('heading', { name: 'Documents' })).toBeTruthy(); expect(screen.getByRole('button', { name: 'Open document: Launch plan' })).toBeTruthy(); });
  it('renders realtime presence, Markdown tools, outline, operations, versions, and provenance', () => { render(<DocumentsPage documentId="d1" searchQuery="" onOpenDocument={vi.fn()} onBack={vi.fn()} />); expect(screen.getByRole('heading', { name: 'Launch plan' })).toBeTruthy(); expect(screen.getByLabelText('Document Markdown content')).toBeTruthy(); expect(screen.getByRole('button',{name:'Format Bold'})).toBeTruthy(); expect(screen.getByRole('button',{name:'Copy link to Launch'})).toBeTruthy(); expect(screen.getByText(/this device/)).toBeTruthy(); expect(screen.getByText(/Revision 2 · three way/)).toBeTruthy(); expect(screen.getByText('Revision 2', { selector: 'summary' })).toBeTruthy(); expect(screen.getByRole('button',{name:'Revert to this version'})).toBeTruthy(); expect(screen.getByText('Template provenance')).toBeTruthy(); });
  it('shows merge conflicts without replacing the local draft',()=>{useDocumentRealtime.mockReturnValue(realtime({syncState:'conflict',conflict:{reason:'overlapping_change',document,draft:{title:'Launch plan',content:'Local draft'}}}));render(<DocumentsPage documentId="d1" searchQuery="" onOpenDocument={vi.fn()} onBack={vi.fn()}/>);expect(screen.getByRole('heading',{name:'Your draft needs review'})).toBeTruthy();expect(screen.getByRole('button',{name:'Use latest'})).toBeTruthy();expect(screen.getByRole('button',{name:'Retry merge'})).toBeTruthy()});
  it('has no automated semantic accessibility violations', async () => { const { container } = render(<DocumentsPage documentId="d1" searchQuery="" onOpenDocument={vi.fn()} onBack={vi.fn()} />); const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } }); expect(results.violations).toEqual([]); });
});
