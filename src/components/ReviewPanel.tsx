'use client';

import { useActionState, useState } from 'react';
import {
  createThreadAction,
  replyThreadAction,
  setThreadStatusAction,
  startReviewAction,
} from '#src/app/actions/drafts.ts';

export interface ThreadProps {
  id: string;
  anchor: string | null;
  sectionNumber: string | null;
  type: string;
  status: string;
  isOrphaned: boolean;
  createdByName: string | null;
  createdAt: string;
  comments: Array<{ id: string; body: string; suggestion: string | null; authorName: string | null; createdAt: string }>;
}

export function StartReviewForm({ slug }: { slug: string }) {
  const [state, action, pending] = useActionState(startReviewAction, null);
  return (
    <form action={action} className="dl-card">
      <h2>Send for review</h2>
      <p className="dl-muted">
        Submitting creates an immutable revision first, and the review round is pinned to it. Later
        edits to the working copy cannot change this round&apos;s evidence.
      </p>
      {state?.error ? <p className="dl-error">{state.error}</p> : null}
      {state?.message ? <p className="dl-notice">{state.message}</p> : null}
      <input type="hidden" name="slug" value={slug} />
      <div className="dl-actions">
        <label className="dl-field" style={{ flex: '1 1 20rem' }}>
          <span className="dl-sr-only">Note to reviewers</span>
          <input name="note" placeholder="What should reviewers focus on?" />
        </label>
        <button className="dl-button dl-button-primary" type="submit" disabled={pending}>
          {pending ? 'Submitting…' : 'Create revision and open review round'}
        </button>
      </div>
    </form>
  );
}

export function NewThreadForm({
  slug,
  sections,
}: {
  slug: string;
  sections: Array<{ anchor: string; number: string | null; title: string }>;
}) {
  const [state, action, pending] = useActionState(createThreadAction, null);
  return (
    <form action={action} className="dl-card">
      <h2>Open a review thread</h2>
      {state?.error ? <p className="dl-error">{state.error}</p> : null}
      {state?.message ? <p className="dl-notice">{state.message}</p> : null}
      <input type="hidden" name="slug" value={slug} />
      <div className="dl-form-grid">
        <label className="dl-field">
          <span>Anchor to a section</span>
          <select name="anchor" defaultValue="">
            <option value="">Whole document</option>
            {sections.map((s) => (
              <option key={s.anchor} value={s.anchor}>
                {s.number ? `${s.number}. ` : ''}
                {s.title}
              </option>
            ))}
          </select>
        </label>
        <label className="dl-field">
          <span>Thread type</span>
          <select name="type" defaultValue="comment">
            <option value="comment">Comment</option>
            <option value="question">Question</option>
            <option value="suggestion">Suggestion</option>
            <option value="blocking">Blocking change request</option>
            <option value="editorial">Editorial</option>
            <option value="security">Security</option>
            <option value="legal">Legal</option>
            <option value="approval-note">Approval note</option>
          </select>
        </label>
      </div>
      <label className="dl-field" style={{ marginTop: '0.75rem' }}>
        <span>Comment</span>
        <textarea name="body" rows={3} required />
      </label>
      <label className="dl-field" style={{ marginTop: '0.75rem' }}>
        <span>Suggested replacement text (optional)</span>
        <textarea name="suggestion" rows={2} />
      </label>
      <div className="dl-actions">
        <button className="dl-button" type="submit" disabled={pending}>
          {pending ? 'Opening…' : 'Open thread'}
        </button>
      </div>
    </form>
  );
}

export function ThreadActions({ slug, threadId, status }: { slug: string; threadId: string; status: string }) {
  const [replyState, replyAction, replyPending] = useActionState(replyThreadAction, null);
  const [statusState, statusAction, statusPending] = useActionState(setThreadStatusAction, null);
  const [open, setOpen] = useState(false);

  return (
    <div>
      <div className="dl-actions">
        <button type="button" className="dl-button" onClick={() => setOpen((v) => !v)}>
          {open ? 'Cancel reply' : 'Reply'}
        </button>
        <form action={statusAction} className="dl-actions" style={{ margin: 0 }}>
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="threadId" value={threadId} />
          <select name="status" defaultValue={status} aria-label="Thread status">
            <option value="open">Open</option>
            <option value="resolved">Resolved</option>
            <option value="wont-fix">Won&apos;t fix</option>
          </select>
          <button className="dl-button" type="submit" disabled={statusPending}>
            {statusPending ? 'Saving…' : 'Set status'}
          </button>
        </form>
      </div>
      {statusState?.error ? <p className="dl-error">{statusState.error}</p> : null}
      {open ? (
        <form action={replyAction} className="dl-actions">
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="threadId" value={threadId} />
          <label className="dl-field" style={{ flex: '1 1 20rem' }}>
            <span className="dl-sr-only">Reply</span>
            <textarea name="body" rows={2} required placeholder="Reply to this thread" />
          </label>
          <button className="dl-button" type="submit" disabled={replyPending}>
            {replyPending ? 'Posting…' : 'Post reply'}
          </button>
        </form>
      ) : null}
      {replyState?.error ? <p className="dl-error">{replyState.error}</p> : null}
    </div>
  );
}
