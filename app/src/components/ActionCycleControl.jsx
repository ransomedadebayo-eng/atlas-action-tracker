import React, { useEffect, useMemo, useState } from 'react';
import { CalendarRange, Unlink } from 'lucide-react';
import { useAssignCycleAction, useCycles, useRemoveCycleAction } from '../hooks/useCycles.js';

export default function ActionCycleControl({ action, isArchived }) {
  const { data, isLoading, isError } = useCycles({ business: action.business || undefined });
  const assign = useAssignCycleAction();
  const remove = useRemoveCycleAction();
  const [cycleId, setCycleId] = useState(action.cycle_id || '');
  const [notice, setNotice] = useState('');
  useEffect(() => setCycleId(action.cycle_id || ''), [action.id, action.cycle_id]);
  const cycles = useMemo(() => [...(data?.current || []), ...(data?.upcoming || [])], [data]);
  const current = [...(data?.cycles || [])].find(cycle => cycle.id === action.cycle_id);
  if (isLoading) return <div className="text-xs text-text-muted">Loading cycle assignment…</div>;
  if (isError || (!current && cycles.length === 0)) return null;
  async function save() {
    setNotice('');
    try {
      if (!cycleId && action.cycle_id) await remove.mutateAsync({ id: action.cycle_id, actionId: action.id });
      else if (cycleId && cycleId !== action.cycle_id) await assign.mutateAsync({ id: cycleId, actionId: action.id });
      setNotice(cycleId ? 'Cycle assignment saved.' : 'Cycle assignment removed.');
    } catch (error) {
      setNotice(error.message || 'Cycle assignment could not be saved.');
    }
  }
  return <div className="rounded-xl border border-border bg-bg-surface p-3"><div className="flex items-center gap-2"><CalendarRange className="h-4 w-4 text-accent" /><div><p className="label">Cycle</p><p className="mt-1 text-xs text-text-muted">Execution timebox, separate from Atlas Week.</p></div></div><div className="mt-3 flex gap-2"><select aria-label="Action cycle" className="input-field min-h-11 min-w-0 flex-1 text-sm" value={cycleId} onChange={event => setCycleId(event.target.value)} disabled={isArchived}><option value="">No cycle</option>{current && !cycles.some(cycle => cycle.id === current.id) && <option value={current.id}>{current.name} ({current.status})</option>}{cycles.map(cycle => <option key={cycle.id} value={cycle.id}>{cycle.name} · {cycle.status}</option>)}</select><button type="button" className="btn-secondary min-h-11" onClick={save} disabled={isArchived || cycleId === (action.cycle_id || '') || assign.isPending || remove.isPending}>{cycleId ? 'Save' : <><Unlink className="mr-1 inline h-4 w-4" />Remove</>}</button></div>{notice && <p className="mt-2 text-xs text-text-secondary" role="status">{notice}</p>}</div>;
}
