export type TextChange = { start: number; end: number; insert: string };
export type DocumentMergeInput = {
  baseTitle: string; baseContent: string;
  currentTitle: string; currentContent: string;
  proposedTitle: string; proposedContent: string;
};
export type DocumentMergeResult = {
  ok: boolean; title?: string; content?: string;
  strategy?: 'direct' | 'three_way'; reason?: 'overlapping_change' | 'title_conflict';
  proposedChange: TextChange; currentChange: TextChange;
};

export function singleTextChange(base: string, next: string): TextChange {
  let start = 0;
  const maxPrefix = Math.min(base.length, next.length);
  while (start < maxPrefix && base[start] === next[start]) start += 1;
  let baseEnd = base.length;
  let nextEnd = next.length;
  while (baseEnd > start && nextEnd > start && base[baseEnd - 1] === next[nextEnd - 1]) {
    baseEnd -= 1; nextEnd -= 1;
  }
  return { start, end: baseEnd, insert: next.slice(start, nextEnd) };
}

export function applyTextChange(value: string, change: TextChange): string {
  return value.slice(0, change.start) + change.insert + value.slice(change.end);
}

function changed(change: TextChange) { return change.start !== change.end || change.insert.length > 0; }
function sameChange(left: TextChange, right: TextChange) { return left.start === right.start && left.end === right.end && left.insert === right.insert; }

export function transformIndex(index: number, applied: TextChange): number {
  const removed = applied.end - applied.start;
  const delta = applied.insert.length - removed;
  if (applied.end < index || (applied.end === index && removed > 0)) return index + delta;
  if (applied.start < index && index < applied.end) return applied.start + applied.insert.length;
  if (applied.start === index && removed === 0) return index + applied.insert.length;
  return index;
}

export function mergeDocumentChanges(input: DocumentMergeInput): DocumentMergeResult {
  const proposedChange = singleTextChange(input.baseContent, input.proposedContent);
  const currentChange = singleTextChange(input.baseContent, input.currentContent);
  let title: string;
  if (input.proposedTitle === input.currentTitle) title = input.currentTitle;
  else if (input.proposedTitle === input.baseTitle) title = input.currentTitle;
  else if (input.currentTitle === input.baseTitle) title = input.proposedTitle;
  else return { ok: false, reason: 'title_conflict', proposedChange, currentChange };

  if (input.currentContent === input.baseContent) return { ok: true, title, content: input.proposedContent, strategy: 'direct', proposedChange, currentChange };
  if (input.proposedContent === input.baseContent || input.proposedContent === input.currentContent) return { ok: true, title, content: input.currentContent, strategy: 'three_way', proposedChange, currentChange };
  if (sameChange(proposedChange, currentChange)) return { ok: true, title, content: input.currentContent, strategy: 'three_way', proposedChange, currentChange };

  const proposedInsert = proposedChange.start === proposedChange.end;
  const currentInsert = currentChange.start === currentChange.end;
  if (proposedInsert && currentInsert && proposedChange.start === currentChange.start) {
    const combined: TextChange = { start: currentChange.start, end: currentChange.end, insert: currentChange.insert + proposedChange.insert };
    return { ok: true, title, content: applyTextChange(input.baseContent, combined), strategy: 'three_way', proposedChange, currentChange };
  }

  const disjoint = proposedChange.end <= currentChange.start || currentChange.end <= proposedChange.start;
  if (!disjoint || !changed(proposedChange)) return { ok: false, reason: 'overlapping_change', proposedChange, currentChange };
  const changes = [proposedChange, currentChange].sort((a, b) => b.start - a.start || b.end - a.end);
  let content = input.baseContent;
  for (const change of changes) content = applyTextChange(content, change);
  return { ok: true, title, content, strategy: 'three_way', proposedChange, currentChange };
}

export function changeSummary(change: TextChange) {
  return { start: change.start, delete_count: change.end - change.start, insert_count: change.insert.length };
}
