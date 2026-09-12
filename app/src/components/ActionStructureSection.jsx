import React, { useMemo, useState } from 'react';
import { AlertTriangle, ArrowUpRight, CheckCircle2, FolderKanban, GitBranch, Link2, ListTree, Plus, RotateCcw, Unlink } from 'lucide-react';
import {
  useActionStructure, useActions, useCreateActionRelation, useCreateSubAction,
  useConvertActionToProject, useMarkActionDuplicate, useRestoreDuplicateAction, useSetActionParent,
  useTransitionActionRelation,
} from '../hooks/useActions.js';

function statusLabel(value) {
  return String(value || 'unknown').replace(/_/g, ' ');
}

function relationLabel(direction) {
  if (direction === 'blocking') return 'Blocks';
  if (direction === 'blocked_by') return 'Blocked by';
  if (direction === 'duplicate_of') return 'Duplicate of';
  if (direction === 'duplicated_by') return 'Duplicated by';
  return 'Related';
}

export default function ActionStructureSection({ action, isArchived, onSelectAction = () => {} }) {
  const actionId = action.id;
  const { data: structure, isLoading, isError } = useActionStructure(actionId);
  const { data: actionOptions = [] } = useActions({ limit: 200, sort_by: 'title', sort_dir: 'asc' });
  const createSubAction = useCreateSubAction();
  const setParent = useSetActionParent();
  const createRelation = useCreateActionRelation();
  const transitionRelation = useTransitionActionRelation();
  const markDuplicate = useMarkActionDuplicate();
  const restoreDuplicate = useRestoreDuplicateAction();
  const convertToProject = useConvertActionToProject();
  const [subAction, setSubAction] = useState({ title: '', due_date: '' });
  const [parentId, setParentId] = useState('');
  const [relation, setRelation] = useState({ relation_type: 'related', target_action_id: '' });
  const [canonicalId, setCanonicalId] = useState('');
  const [notice, setNotice] = useState('');

  const candidates = useMemo(() => actionOptions.filter(candidate => (
    candidate.id !== actionId && candidate.status !== 'archived' && candidate.resolution !== 'duplicate'
  )), [actionOptions, actionId]);
  const childIds = new Set((structure?.children || []).map(child => String(child.id)));
  const parentCandidates = candidates.filter(candidate => !childIds.has(String(candidate.id)));

  async function run(promise, success) {
    setNotice('');
    try {
      const result = await promise;
      setNotice(success);
      return result;
    } catch (error) {
      setNotice(error.message || 'The structure change could not be saved.');
      return null;
    }
  }

  async function addSubAction(event) {
    event.preventDefault();
    if (!subAction.title.trim()) return setNotice('Sub-action title is required.');
    const result = await run(createSubAction.mutateAsync({
      id: actionId,
      title: subAction.title,
      due_date: subAction.due_date || null,
      expected_parent_revision: action.revision,
    }), 'Sub-action created.');
    if (result) setSubAction({ title: '', due_date: '' });
  }

  async function attachParent(event) {
    event.preventDefault();
    if (!parentId) return setNotice('Choose a parent action.');
    const result = await run(setParent.mutateAsync({ id: actionId, parent_action_id: parentId, expected_revision: action.revision }), 'Parent action updated.');
    if (result) setParentId('');
  }

  async function addRelation(event) {
    event.preventDefault();
    if (!relation.target_action_id) return setNotice('Choose a related action.');
    const result = await run(createRelation.mutateAsync({ id: actionId, ...relation }), 'Action relation added.');
    if (result) setRelation(current => ({ ...current, target_action_id: '' }));
  }

  async function resolveDuplicate(event) {
    event.preventDefault();
    if (!canonicalId) return setNotice('Choose the canonical action.');
    if (!window.confirm('Mark this action as a duplicate? It will close with an explicit duplicate resolution.')) return;
    await run(markDuplicate.mutateAsync({ id: actionId, canonical_action_id: canonicalId, expected_revision: action.revision }), 'Action marked as duplicate.');
  }

  if (isLoading) return <div className="rounded-xl border border-border bg-bg-surface p-4 text-sm text-text-muted">Loading hierarchy and relations…</div>;
  if (isError) return <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400" role="alert">Hierarchy and relations could not be loaded.</div>;

  const progress = structure?.child_progress || {};
  const canonical = structure?.canonical_action;
  const isDuplicate = action.resolution === 'duplicate';
  const hasChildren = (structure?.children || []).length > 0;

  return (
    <section className="space-y-4 border-t border-white/10 pt-4" aria-labelledby="action-structure-heading">
      <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><ListTree className="h-4 w-4 text-accent" /><div><p id="action-structure-heading" className="label">Structure & relations</p><p className="mt-1 text-xs text-text-muted">Break down work and expose dependencies without losing history.</p></div></div>{action.identifier && <span className="badge border-accent/30 font-mono text-accent">{action.identifier}</span>}</div>
      {notice && <div className="rounded-lg border border-accent/30 bg-accent-muted px-3 py-2 text-xs text-text-primary" role="status">{notice}</div>}

      {isDuplicate && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
          <div className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-400" /><div className="min-w-0 flex-1"><p className="text-sm font-semibold text-text-primary">Duplicate resolution</p><button type="button" className="mt-1 text-left text-xs text-accent hover:underline" onClick={() => canonical && onSelectAction(canonical.id)}>{canonical ? `Canonical: ${canonical.title}` : `Canonical action: ${action.duplicate_of_id}`}</button></div></div>
          <button type="button" className="btn-ghost mt-2 flex min-h-10 items-center gap-2" onClick={() => run(restoreDuplicate.mutateAsync({ id: actionId, expected_revision: action.revision }), 'Duplicate resolution restored.')}><RotateCcw className="h-4 w-4" />Restore as active</button>
        </div>
      )}

      <div className="rounded-xl border border-border bg-bg-surface p-3">
        <div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold text-text-primary">Sub-actions</p><p className="mt-1 text-xs text-text-muted">{progress.completed_children || 0}/{progress.total_children || 0} complete · {progress.completed_effort || 0}/{progress.total_effort || 0} effort</p></div><span className="text-sm font-semibold text-accent">{progress.progress_percent || 0}%</span></div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-bg-elevated"><div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(0, Math.min(100, progress.progress_percent || 0))}%` }} /></div>
        <div className="mt-3 space-y-2">{(structure?.children || []).map(child => <button type="button" key={child.id} className="flex min-h-11 w-full items-center gap-2 rounded-lg border border-border px-3 py-2 text-left hover:border-border-hover" onClick={() => onSelectAction(child.id)}><CheckCircle2 className={`h-4 w-4 flex-shrink-0 ${['done', 'completed', 'closed'].includes(child.status) ? 'text-emerald-400' : 'text-text-muted'}`} /><span className="min-w-0 flex-1 truncate text-sm text-text-primary">{child.title}</span><span className="text-xs text-text-muted">{child.estimate_points ?? '1*'}</span><ArrowUpRight className="h-3.5 w-3.5 text-text-muted" /></button>)}{(structure?.children || []).length === 0 && <p className="py-3 text-center text-xs text-text-muted">No sub-actions yet.</p>}</div>
        {!isArchived && !isDuplicate && <form className="mt-3 grid gap-2" onSubmit={addSubAction}><input aria-label="New sub-action title" className="input-field min-h-11 w-full text-sm" placeholder="New sub-action title" value={subAction.title} onChange={event => setSubAction(current => ({ ...current, title: event.target.value }))} /><div className="grid grid-cols-[1fr_auto] gap-2"><input aria-label="Sub-action due date" type="date" className="input-field min-h-11 text-sm" value={subAction.due_date} onChange={event => setSubAction(current => ({ ...current, due_date: event.target.value }))} /><button type="submit" className="btn-secondary min-h-11"><Plus className="mr-1 inline h-4 w-4" />Add</button></div></form>}
      </div>

      {hasChildren && !isArchived && !isDuplicate && <button type="button" className="btn-secondary flex min-h-11 w-full items-center justify-center gap-2" disabled={convertToProject.isPending} onClick={() => window.confirm('Convert this parent action and its direct sub-actions into a project? The hierarchy will be removed, but the conversion receipt will remain.') && run(convertToProject.mutateAsync({ id: actionId, expected_revision: action.revision }), 'Parent action converted to a project.')}><FolderKanban className="h-4 w-4" />{convertToProject.isPending ? 'Converting…' : 'Convert parent action to project'}</button>}

      <div className="rounded-xl border border-border bg-bg-surface p-3">
        <p className="text-sm font-semibold text-text-primary">Parent action</p>
        {structure?.parent ? <div className="mt-2 flex items-center gap-2"><button type="button" className="min-w-0 flex-1 truncate text-left text-sm text-accent hover:underline" onClick={() => onSelectAction(structure.parent.id)}>{structure.parent.title}</button>{!isArchived && <button type="button" className="btn-ghost min-h-10" aria-label="Remove parent action" onClick={() => run(setParent.mutateAsync({ id: actionId, parent_action_id: null, expected_revision: action.revision }), 'Parent removed.')}><Unlink className="h-4 w-4" /></button>}</div> : (!isArchived && !isDuplicate ? <form className="mt-2 flex gap-2" onSubmit={attachParent}><select aria-label="Parent action" className="input-field min-h-11 min-w-0 flex-1 text-sm" value={parentId} onChange={event => setParentId(event.target.value)}><option value="">Choose parent…</option>{parentCandidates.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.title}</option>)}</select><button type="submit" className="btn-secondary min-h-11">Set</button></form> : <p className="mt-2 text-xs text-text-muted">No parent action.</p>)}
      </div>

      <div className="rounded-xl border border-border bg-bg-surface p-3">
        <div className="flex items-center gap-2"><Link2 className="h-4 w-4 text-accent" /><p className="text-sm font-semibold text-text-primary">Automatic references</p></div>
        <div className="mt-3 space-y-2">{(structure?.text_references || []).map(reference => <button type="button" key={reference.id} className="flex min-h-11 w-full items-center gap-2 rounded-lg border border-border px-3 text-left" onClick={() => onSelectAction(reference.target_action_id)}><span className="font-mono text-xs text-accent">{reference.matched_identifier}</span><span className="min-w-0 flex-1 truncate text-xs text-text-muted">from {reference.source_field}</span><ArrowUpRight className="h-3.5 w-3.5 text-text-muted" /></button>)}{(structure?.text_references || []).length === 0 && <p className="py-2 text-xs text-text-muted">No action identifiers referenced here.</p>}</div>
        {(structure?.backlinks || []).length > 0 && <div className="mt-4 border-t border-border pt-3"><p className="label mb-2">Backlinks</p>{structure.backlinks.map(reference => <button type="button" key={reference.id} className="mb-2 flex min-h-10 w-full items-center gap-2 rounded-lg border border-border px-3 text-left" disabled={reference.source_type !== 'action'} onClick={() => reference.source_type === 'action' && onSelectAction(reference.source_id)}><span className="badge border-border">{reference.source_type}</span><span className="min-w-0 flex-1 truncate text-xs text-text-secondary">{reference.source_id} · {reference.source_field}</span>{reference.source_type === 'action' && <ArrowUpRight className="h-3.5 w-3.5 text-text-muted" />}</button>)}</div>}
      </div>

      <div className="rounded-xl border border-border bg-bg-surface p-3">
        <div className="flex items-center gap-2"><GitBranch className="h-4 w-4 text-accent" /><p className="text-sm font-semibold text-text-primary">Action relations</p></div>
        <div className="mt-3 space-y-2">{(structure?.relations || []).map(item => <div key={item.id} className="flex items-center gap-2 rounded-lg border border-border p-2"><Link2 className="h-4 w-4 flex-shrink-0 text-text-muted" /><button type="button" className="min-w-0 flex-1 text-left" onClick={() => item.related_action && onSelectAction(item.related_action.id)}><span className="block text-[10px] font-semibold uppercase tracking-wider text-text-muted">{relationLabel(item.direction)}</span><span className="block truncate text-sm text-text-primary">{item.related_action?.title || 'Unavailable action'}</span></button>{!isArchived && item.relation_type !== 'duplicate' && <button type="button" className="btn-ghost min-h-10" aria-label={`Archive ${relationLabel(item.direction)} relation`} onClick={() => run(transitionRelation.mutateAsync({ id: actionId, relationId: item.id, transition: 'archive' }), 'Relation archived.')}><Unlink className="h-4 w-4" /></button>}</div>)}{(structure?.relations || []).length === 0 && <p className="py-3 text-center text-xs text-text-muted">No active relations.</p>}</div>
        {!isArchived && !isDuplicate && <form className="mt-3 grid gap-2" onSubmit={addRelation}><div className="grid grid-cols-[130px_1fr] gap-2"><select aria-label="Relation type" className="input-field min-h-11 text-sm" value={relation.relation_type} onChange={event => setRelation(current => ({ ...current, relation_type: event.target.value }))}><option value="related">Related</option><option value="blocks">Blocks</option><option value="blocked_by">Blocked by</option></select><select aria-label="Related action" className="input-field min-h-11 min-w-0 text-sm" value={relation.target_action_id} onChange={event => setRelation(current => ({ ...current, target_action_id: event.target.value }))}><option value="">Choose action…</option>{candidates.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.title}</option>)}</select></div><button type="submit" className="btn-secondary min-h-11">Add relation</button></form>}
      </div>

      {!isArchived && !isDuplicate && <details className="rounded-xl border border-border bg-bg-surface p-3"><summary className="cursor-pointer text-sm font-semibold text-text-secondary">Mark as duplicate</summary><form className="mt-3 space-y-2" onSubmit={resolveDuplicate}><select aria-label="Canonical action" className="input-field min-h-11 w-full text-sm" value={canonicalId} onChange={event => setCanonicalId(event.target.value)}><option value="">Choose canonical action…</option>{candidates.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.title}</option>)}</select><button type="submit" className="btn-secondary min-h-11 w-full text-amber-400">Resolve as duplicate</button></form></details>}
    </section>
  );
}
