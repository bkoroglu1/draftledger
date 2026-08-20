'use client';

import { useActionState } from 'react';
import { updateMetadataAction } from '#src/app/actions/drafts.ts';

export function SettingsForm({
  slug,
  title,
  abstract,
  visibility,
  intendedStatus,
  type,
  groupSlug,
  groups,
  canEdit,
}: {
  slug: string;
  title: string;
  abstract: string;
  visibility: string;
  intendedStatus: string;
  type: string;
  groupSlug: string;
  groups: Array<{ slug: string; name: string }>;
  canEdit: boolean;
}) {
  const [state, action, pending] = useActionState(updateMetadataAction, null);

  return (
    <form action={action} className="dl-card">
      <h2>Metadata</h2>
      {state?.error ? <p className="dl-error">{state.error}</p> : null}
      {state?.message ? <p className="dl-notice">{state.message}</p> : null}
      <input type="hidden" name="slug" value={slug} />
      <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="dl-form-grid">
          <label className="dl-field">
            <span>Title</span>
            <input name="title" defaultValue={title} required />
          </label>
          <label className="dl-field">
            <span>Document type</span>
            <select name="type" defaultValue={type}>
              <option value="standard">Standard</option>
              <option value="guideline">Guideline</option>
              <option value="procedure">Procedure</option>
              <option value="report">Report</option>
            </select>
          </label>
          <label className="dl-field">
            <span>Intended status</span>
            <select name="intendedStatus" defaultValue={intendedStatus}>
              <option value="standards-track">Standards track</option>
              <option value="informational">Informational</option>
              <option value="experimental">Experimental</option>
              <option value="internal">Internal</option>
            </select>
          </label>
          <label className="dl-field">
            <span>Visibility</span>
            <select name="visibility" defaultValue={visibility}>
              <option value="private">Private</option>
              <option value="group">Group</option>
              <option value="organization">Organization</option>
              <option value="public">Public</option>
            </select>
          </label>
          <label className="dl-field">
            <span>Working group</span>
            <select name="group" defaultValue={groupSlug}>
              <option value="">No group</option>
              {groups.map((g) => (
                <option key={g.slug} value={g.slug}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="dl-field" style={{ marginTop: '0.75rem' }}>
          <span>Abstract</span>
          <textarea name="abstract" rows={3} defaultValue={abstract} />
        </label>
        <div className="dl-actions">
          <button className="dl-button dl-button-primary" type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Save metadata'}
          </button>
        </div>
      </fieldset>
      {canEdit ? null : (
        <p className="dl-notice">
          This document cannot be edited: it is published or you do not hold an editing role.
        </p>
      )}
    </form>
  );
}
