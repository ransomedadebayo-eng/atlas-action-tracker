import React, { useState } from 'react';
import {
  Archive, ArchiveRestore, Bell, BellOff, CheckCircle2, Edit3,
  Link2, MessageCircle, Reply, RotateCcw, Send,
} from 'lucide-react';
import {
  useArchiveComment, useCreateComment, useDiscussion, useReopenComment,
  useResolveComment, useRestoreComment, useSetDiscussionSubscription,
  useToggleReaction, useUpdateComment,
} from '../hooks/useComments.js';

const QUICK_REACTIONS = ['👍', '❤️', '🎉', '👀', '✅'];

export function mentionsFrom(body) {
  return Array.from(new Set(
    (String(body).match(/@(ransomed|codex|claude)\b/gi) || [])
      .map(value => value.slice(1).toLowerCase()),
  ));
}

function ReactionBar({ targetType, targetId, groups = [], selected = [], onToggle }) {
  return (
    <div className="flex flex-wrap items-center gap-1" aria-label="Reactions">
      {groups.map(group => (
        <button
          type="button"
          key={group.emoji}
          className={`rounded-full border px-2 py-1 text-xs ${selected.includes(group.emoji) ? 'border-accent text-accent' : 'border-border text-text-secondary'}`}
          title={group.actors.join(', ')}
          aria-label={`${group.emoji} reaction by ${group.actors.join(', ')}`}
          onClick={() => onToggle(targetType, targetId, group.emoji)}
        >
          {group.emoji} {group.count}
        </button>
      ))}
      {QUICK_REACTIONS.filter(emoji => !groups.some(group => group.emoji === emoji)).map(emoji => (
        <button
          type="button"
          key={emoji}
          className="rounded-full border border-border px-2 py-1 text-xs text-text-muted"
          aria-label={`React ${emoji}`}
          onClick={() => onToggle(targetType, targetId, emoji)}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}

function CommentComposer({
  targetType, targetId, parentId, initialBody = '', initialAttachments = [],
  initialAnchor = null, editing, onCancel, getSelectedAnchor,
}) {
  const create = useCreateComment();
  const update = useUpdateComment();
  const [body, setBody] = useState(initialBody);
  const [attachment, setAttachment] = useState({ title: '', url: '' });
  const [attachments, setAttachments] = useState(initialAttachments);
  const [anchor, setAnchor] = useState(initialAnchor);
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    if (!body.trim()) return;
    setError('');
    try {
      if (editing) {
        await update.mutateAsync({
          id: editing.id,
          target_type: targetType,
          target_id: targetId,
          body,
          mentions: mentionsFrom(body),
          attachments,
          expected_revision: editing.revision,
        });
      } else {
        await create.mutateAsync({
          target_type: targetType,
          target_id: targetId,
          parent_comment_id: parentId || null,
          body,
          mentions: mentionsFrom(body),
          attachments,
          anchor,
        });
      }
      setBody('');
      onCancel?.();
    } catch (caught) {
      setError(caught.message);
    }
  }

  function addAttachment() {
    if (!attachment.title.trim() || !attachment.url.trim()) return;
    setAttachments(current => [...current, { ...attachment }]);
    setAttachment({ title: '', url: '' });
  }

  function captureAnchor() {
    const selected = getSelectedAnchor?.();
    if (selected?.quote) setAnchor(selected);
    else setError('Select text in the document editor first.');
  }

  return (
    <form className="space-y-2" onSubmit={submit}>
      {anchor && (
        <blockquote className="rounded-lg border-l-2 border-accent bg-bg-elevated p-2 text-xs text-text-secondary">
          “{anchor.quote}”
          <button type="button" className="ml-2 text-text-muted" onClick={() => setAnchor(null)}>Remove anchor</button>
        </blockquote>
      )}
      <textarea
        aria-label={parentId ? 'Reply body' : editing ? 'Edit comment body' : 'Comment body'}
        className="input-field min-h-24 w-full text-sm"
        value={body}
        onChange={event => setBody(event.target.value)}
        placeholder={parentId ? 'Write a reply…' : 'Leave a comment…'}
      />
      {attachments.map((item, index) => (
        <div key={`${item.url}-${index}`} className="flex items-center gap-2 text-xs text-accent">
          <Link2 className="h-3.5 w-3.5" />{item.title}
          <button type="button" className="text-text-muted" onClick={() => setAttachments(current => current.filter((_, itemIndex) => itemIndex !== index))}>Remove</button>
        </div>
      ))}
      <details>
        <summary className="cursor-pointer text-xs text-text-muted">Attachment or inline anchor</summary>
        <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <input aria-label="Attachment title" className="input-field min-h-10" placeholder="Attachment title" value={attachment.title} onChange={event => setAttachment(current => ({ ...current, title: event.target.value }))} />
          <input aria-label="Attachment HTTPS URL" type="url" className="input-field min-h-10" placeholder="https://…" value={attachment.url} onChange={event => setAttachment(current => ({ ...current, url: event.target.value }))} />
          <button type="button" className="btn-ghost min-h-10" onClick={addAttachment}>Add link</button>
        </div>
        {getSelectedAnchor && <button type="button" className="btn-ghost mt-2 min-h-10" onClick={captureAnchor}>Comment on selected text</button>}
      </details>
      {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
      <div className="flex justify-end gap-2">
        {onCancel && <button type="button" className="btn-secondary min-h-10" onClick={onCancel}>Cancel</button>}
        <button type="submit" className="btn-primary min-h-10" disabled={create.isPending || update.isPending}>
          <Send className="mr-1 inline h-3.5 w-3.5" />{editing ? 'Save' : 'Post'}
        </button>
      </div>
    </form>
  );
}

function CommentBody({ comment, targetType, targetId, actor, root, getSelectedAnchor }) {
  const archive = useArchiveComment();
  const restore = useRestoreComment();
  const resolve = useResolveComment();
  const reopen = useReopenComment();
  const toggle = useToggleReaction();
  const [replying, setReplying] = useState(false);
  const [editing, setEditing] = useState(false);
  const canEdit = comment.created_by === actor || actor === 'ransomed';
  const active = comment.status === 'active';
  const toggleReaction = (type, id, emoji) => toggle.mutate({ target_type: type, target_id: id, emoji });

  if (editing) {
    return (
      <CommentComposer
        targetType={targetType}
        targetId={targetId}
        editing={comment}
        initialBody={comment.body}
        initialAttachments={comment.attachments || []}
        initialAnchor={comment.anchor}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <article className={`${root ? 'rounded-xl border border-border bg-bg-surface p-3' : 'border-l border-border pl-3'} ${comment.status === 'archived' ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-text-primary">{comment.created_by}</span>
        <time className="text-xs text-text-muted">{new Date(comment.created_at).toLocaleString()}</time>
        {comment.updated_at !== comment.created_at && <span className="text-[10px] text-text-muted">edited</span>}
        {root && comment.resolved_at && <span className="badge border-green-400/30 text-green-400">Resolved by {comment.resolved_by}</span>}
      </div>
      {comment.anchor && (
        <blockquote className="mt-2 rounded-lg border-l-2 border-accent bg-bg-elevated p-2 text-xs text-text-secondary">
          “{comment.anchor.quote}” · {comment.anchor.field}{comment.anchor.source_revision !== undefined ? ` r${comment.anchor.source_revision}` : ''}
        </blockquote>
      )}
      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-text-secondary">{active ? comment.body : 'Archived comment'}</p>
      {active && (comment.attachments || []).length > 0 && (
        <div className="mt-2 space-y-1">
          {comment.attachments.map((item, index) => <a className="flex items-center gap-1 text-xs text-accent" href={item.url} target="_blank" rel="noreferrer" key={`${item.url}-${index}`}><Link2 className="h-3.5 w-3.5" />{item.title}</a>)}
        </div>
      )}
      <div className="mt-3"><ReactionBar targetType="comment" targetId={comment.id} groups={comment.reactions} selected={comment.reacted_by_actor || []} onToggle={toggleReaction} /></div>
      <div className="mt-2 flex flex-wrap gap-1">
        {active && root && <button type="button" className="btn-ghost min-h-9 text-xs" onClick={() => setReplying(value => !value)}><Reply className="mr-1 inline h-3.5 w-3.5" />Reply</button>}
        {active && canEdit && <button type="button" className="btn-ghost min-h-9 text-xs" onClick={() => setEditing(true)}><Edit3 className="mr-1 inline h-3.5 w-3.5" />Edit</button>}
        {active && canEdit ? (
          <button type="button" className="btn-ghost min-h-9 text-xs text-red-400" onClick={() => archive.mutate({ id: comment.id, target_type: targetType, target_id: targetId, expected_revision: comment.revision })}><Archive className="mr-1 inline h-3.5 w-3.5" />Archive</button>
        ) : !active && canEdit ? (
          <button type="button" className="btn-ghost min-h-9 text-xs" onClick={() => restore.mutate({ id: comment.id, target_type: targetType, target_id: targetId, expected_revision: comment.revision })}><ArchiveRestore className="mr-1 inline h-3.5 w-3.5" />Restore</button>
        ) : null}
        {root && active && !comment.resolved_at && <button type="button" className="btn-ghost min-h-9 text-xs" onClick={() => resolve.mutate({ id: comment.id, target_type: targetType, target_id: targetId, resolution_comment_id: comment.id, expected_revision: comment.revision })}><CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />Resolve</button>}
        {root && comment.resolved_at && <button type="button" className="btn-ghost min-h-9 text-xs" onClick={() => reopen.mutate({ id: comment.id, target_type: targetType, target_id: targetId, expected_revision: comment.revision })}><RotateCcw className="mr-1 inline h-3.5 w-3.5" />Reopen</button>}
        {!root && active && <button type="button" className="btn-ghost min-h-9 text-xs" onClick={() => resolve.mutate({ id: comment.thread_root_id, target_type: targetType, target_id: targetId, resolution_comment_id: comment.id, expected_revision: comment.root_revision })}><CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />Resolve with this</button>}
      </div>
      {replying && <div className="mt-3"><CommentComposer targetType={targetType} targetId={targetId} parentId={comment.id} onCancel={() => setReplying(false)} getSelectedAnchor={getSelectedAnchor} /></div>}
    </article>
  );
}

export default function DiscussionThread({ targetType, targetId, compact = false, getSelectedAnchor }) {
  const query = useDiscussion(targetType, targetId);
  const toggle = useToggleReaction();
  const subscription = useSetDiscussionSubscription();
  if (!targetId) return null;
  if (query.isLoading) return <div className="h-20 animate-pulse rounded-lg bg-bg-elevated" aria-label="Loading discussion" />;
  if (query.isError) return <p role="alert" className="text-sm text-red-400">{query.error?.message || 'Discussion could not be loaded.'}</p>;

  const data = query.data || {};
  const followed = data.subscription?.status === 'active';
  const toggleReaction = (type, id, emoji) => toggle.mutate({ target_type: type, target_id: id, emoji });
  return (
    <section className={compact ? 'mt-3 border-t border-border pt-3' : 'card p-4 sm:p-5'} aria-label={`${targetType.replace('_', ' ')} discussion`}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <MessageCircle className="h-4 w-4 text-accent" />
        <h2 className={`${compact ? 'text-sm' : 'text-lg'} font-semibold text-text-primary`}>Discussion</h2>
        <span className="text-xs text-text-muted">{(data.threads || []).length} thread{(data.threads || []).length === 1 ? '' : 's'}</span>
        <button type="button" className="btn-ghost ml-auto min-h-9 text-xs" onClick={() => subscription.mutate({ target_type: targetType, target_id: targetId, status: followed ? 'muted' : 'active' })}>
          {followed ? <><BellOff className="mr-1 inline h-3.5 w-3.5" />Mute</> : <><Bell className="mr-1 inline h-3.5 w-3.5" />Follow</>}
        </button>
      </div>
      <div className="mb-3"><ReactionBar targetType={targetType} targetId={targetId} groups={data.target_reactions || []} selected={data.target_reacted_by_actor || []} onToggle={toggleReaction} /></div>
      <CommentComposer targetType={targetType} targetId={targetId} getSelectedAnchor={getSelectedAnchor} />
      <div className="mt-4 space-y-4">
        {(data.threads || []).map(thread => (
          <div key={thread.id} className="space-y-3">
            <CommentBody comment={thread} targetType={targetType} targetId={targetId} actor={data.current_actor} root getSelectedAnchor={getSelectedAnchor} />
            {(thread.replies || []).map(reply => <CommentBody key={reply.id} comment={{ ...reply, root_revision: thread.revision }} targetType={targetType} targetId={targetId} actor={data.current_actor} root={false} />)}
          </div>
        ))}
      </div>
    </section>
  );
}
