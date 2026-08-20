'use client';

import { useActionState, useState } from 'react';
import { createDraftAction } from '#src/app/actions/drafts.ts';

const MODES = [
  { value: 'blank', label: 'Blank technical standard' },
  { value: 'template', label: 'From an organization template' },
  { value: 'copy', label: 'Copy of an existing draft' },
  { value: 'update', label: 'Update of a published document' },
  { value: 'obsolete', label: 'Document that obsoletes a published document' },
  { value: 'fork', label: 'Fork (keeps attribution and derived-from)' },
  { value: 'import', label: 'Import a Markdown or RFCXML file' },
];

export function NewDraftForm({
  defaultMode,
  defaultSource,
  actorHandle,
  templates,
  namespaces,
  groups,
  licenses,
  people,
  documents,
}: {
  defaultMode: string;
  defaultSource: string;
  actorHandle: string;
  templates: Array<{ key: string; name: string }>;
  namespaces: Array<{ key: string; label: string }>;
  groups: Array<{ slug: string; name: string }>;
  licenses: Array<{ key: string; name: string }>;
  people: Array<{ handle: string; displayName: string }>;
  documents: Array<{ slug: string; label: string }>;
}) {
  const [state, action, pending] = useActionState(createDraftAction, null);
  const [mode, setMode] = useState(defaultMode);

  const needsSource = ['copy', 'update', 'obsolete', 'fork'].includes(mode);

  return (
    <form action={action} className="dl-card">
      {state?.error ? <p className="dl-error">{state.error}</p> : null}

      <div className="dl-form-grid">
        <label className="dl-field">
          <span>How should this document start?</span>
          <select name="mode" value={mode} onChange={(e) => setMode(e.target.value)}>
            {MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>

        {mode === 'template' ? (
          <label className="dl-field">
            <span>Template</span>
            <select name="template" required>
              {templates.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {needsSource ? (
          <label className="dl-field">
            <span>Source document</span>
            <select name="source" defaultValue={defaultSource} required>
              <option value="">Select a document…</option>
              {documents.map((d) => (
                <option key={d.slug} value={d.slug}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <label className="dl-field">
          <span>Title</span>
          <input name="title" required placeholder="Example Ledger Notification Protocol" />
        </label>
        <label className="dl-field">
          <span>Short name / slug seed</span>
          <input name="shortName" required placeholder="ledger-notification" />
        </label>
        <label className="dl-field">
          <span>Document type</span>
          <select name="type" defaultValue="standard">
            <option value="standard">Standard</option>
            <option value="guideline">Guideline</option>
            <option value="procedure">Procedure</option>
            <option value="report">Report</option>
          </select>
        </label>
        <label className="dl-field">
          <span>Intended status</span>
          <select name="intendedStatus" defaultValue="standards-track">
            <option value="standards-track">Standards track</option>
            <option value="informational">Informational</option>
            <option value="experimental">Experimental</option>
            <option value="internal">Internal</option>
          </select>
        </label>
        <label className="dl-field">
          <span>Namespace / series</span>
          <select name="namespace" defaultValue={namespaces[0]?.key ?? ''}>
            {namespaces.map((n) => (
              <option key={n.key} value={n.key}>
                {n.label}
              </option>
            ))}
          </select>
        </label>
        <label className="dl-field">
          <span>Working group / project</span>
          <select name="group" defaultValue={groups[0]?.slug ?? ''}>
            <option value="">No group</option>
            {groups.map((g) => (
              <option key={g.slug} value={g.slug}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <label className="dl-field">
          <span>Authors (comma-separated handles)</span>
          <input name="authors" defaultValue={actorHandle} list="dl-people" />
        </label>
        <label className="dl-field">
          <span>Editors (comma-separated handles)</span>
          <input name="editors" placeholder="optional" list="dl-people" />
        </label>
        <label className="dl-field">
          <span>Canonical authoring format</span>
          <select name="format" defaultValue="markdown">
            <option value="markdown">Markdown (recommended)</option>
            <option value="rfcxml">RFCXML (advanced)</option>
          </select>
        </label>
        <label className="dl-field">
          <span>Licence / copyright profile</span>
          <select name="license" defaultValue={licenses[0]?.key ?? ''}>
            {licenses.map((l) => (
              <option key={l.key} value={l.key}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label className="dl-field">
          <span>Visibility</span>
          <select name="visibility" defaultValue="group">
            <option value="private">Private (owner and authors)</option>
            <option value="group">Group</option>
            <option value="organization">Organization</option>
            <option value="public">Public</option>
          </select>
        </label>
        <label className="dl-field">
          <span>Additional relation</span>
          <select name="relationType" defaultValue="">
            <option value="">None</option>
            <option value="updates">updates</option>
            <option value="obsoletes">obsoletes</option>
            <option value="replaces">replaces</option>
            <option value="derived-from">derived-from</option>
          </select>
        </label>
        <label className="dl-field">
          <span>Relation target identifier</span>
          <input name="relationTarget" placeholder="TEST-STD-0001" />
        </label>
      </div>

      <datalist id="dl-people">
        {people.map((p) => (
          <option key={p.handle} value={p.handle}>
            {p.displayName}
          </option>
        ))}
      </datalist>

      <label className="dl-field" style={{ marginTop: '0.75rem' }}>
        <span>Abstract</span>
        <textarea name="abstract" rows={3} placeholder="One paragraph describing what this document specifies." />
      </label>

      {mode === 'import' ? (
        <label className="dl-field" style={{ marginTop: '0.75rem' }}>
          <span>Imported source (Markdown or RFCXML)</span>
          <textarea name="importedSource" rows={12} required />
        </label>
      ) : null}

      <div className="dl-actions">
        <button className="dl-button dl-button-primary" type="submit" disabled={pending}>
          {pending ? 'Creating…' : 'Create draft'}
        </button>
      </div>
    </form>
  );
}
