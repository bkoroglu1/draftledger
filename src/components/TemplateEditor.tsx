'use client';

import { useActionState, useState } from 'react';
import { deleteTemplateAction, saveTemplateAction } from '#src/app/actions/admin.ts';

export interface TemplateRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  canonicalFormat: string;
  body: string;
}

const BLANK_BODY = `---
title: {{title}}
abbrev: {{shortName}}
---

# Abstract

{{abstract}}

# Introduction

TODO: describe the problem this document solves.
`;

export function TemplateEditor({ templates }: { templates: TemplateRow[] }) {
  const [state, formAction, pending] = useActionState(saveTemplateAction, null);
  const [deleteState, deleteAction] = useActionState(deleteTemplateAction, null);
  const [selected, setSelected] = useState<TemplateRow | null>(null);
  // Deleting is confirmed inline rather than through a native dialog.
  const [confirming, setConfirming] = useState<string | null>(null);

  // Remounts the uncontrolled fields when the edit target changes.
  const formKey = selected?.id ?? 'new';

  return (
    <>
      <section className="dl-card">
        <h2>Existing templates</h2>
        {deleteState?.error ? <p className="dl-error">{deleteState.error}</p> : null}
        {deleteState?.message ? <p className="dl-notice">{deleteState.message}</p> : null}
        {templates.length === 0 ? (
          <p className="dl-muted">None yet. Use the form below to add the first one.</p>
        ) : (
          <div className="dl-table-scroll">
            <table className="dl-table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Key</th>
                  <th scope="col">Format</th>
                  <th scope="col">Description</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {templates.map((template) => (
                  <tr key={template.id}>
                    <td>{template.name}</td>
                    <td className="dl-mono">{template.key}</td>
                    <td>{template.canonicalFormat}</td>
                    <td>{template.description ?? '—'}</td>
                    <td>
                      <div className="dl-actions" style={{ marginTop: 0 }}>
                        <button type="button" className="dl-button" onClick={() => setSelected(template)}>
                          Edit
                        </button>
                        {confirming === template.id ? (
                          <>
                            <form action={deleteAction} style={{ display: 'contents' }}>
                              <input type="hidden" name="templateId" value={template.id} />
                              <button className="dl-button" type="submit">
                                Confirm delete
                              </button>
                            </form>
                            <button type="button" className="dl-button" onClick={() => setConfirming(null)}>
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button type="button" className="dl-button" onClick={() => setConfirming(template.id)}>
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {templates.map((template) => (
        <details className="dl-card" key={`body-${template.id}`}>
          <summary>
            {template.name} <code className="dl-mono">{template.key}</code>
          </summary>
          <pre className="dl-page">{template.body}</pre>
        </details>
      ))}

      <form action={formAction} className="dl-card" key={formKey}>
        <h2>{selected ? `Edit ${selected.name}` : 'New template'}</h2>
        {state?.error ? <p className="dl-error">{state.error}</p> : null}
        {state?.message ? <p className="dl-notice">{state.message}</p> : null}
        <input type="hidden" name="templateId" value={selected?.id ?? ''} />
        <div className="dl-form-grid">
          <label className="dl-field">
            <span>Name</span>
            <input name="name" defaultValue={selected?.name ?? ''} required />
          </label>
          <label className="dl-field">
            <span>Key</span>
            <input
              name="key"
              defaultValue={selected?.key ?? ''}
              placeholder="standards-track-default"
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              required
            />
          </label>
          <label className="dl-field">
            <span>Canonical format</span>
            <select name="canonicalFormat" defaultValue={selected?.canonicalFormat ?? 'markdown'}>
              <option value="markdown">markdown</option>
              <option value="rfcxml">rfcxml</option>
            </select>
          </label>
          <label className="dl-field">
            <span>Description</span>
            <input name="description" defaultValue={selected?.description ?? ''} />
          </label>
        </div>
        <label className="dl-field" style={{ marginTop: '0.75rem' }}>
          <span>Body</span>
          <textarea name="body" rows={20} defaultValue={selected?.body ?? BLANK_BODY} required />
        </label>
        <p className="dl-muted" style={{ fontSize: '0.8125rem' }}>
          <code className="dl-mono">{'{{title}}'}</code>, <code className="dl-mono">{'{{shortName}}'}</code> and{' '}
          <code className="dl-mono">{'{{abstract}}'}</code> are substituted when a draft is created. Which sections a
          document must contain is a workflow gate, not a template property — edit it under{' '}
          <a href="/admin/workflows">Workflows</a>.
        </p>
        <div className="dl-actions">
          <button className="dl-button dl-button-primary" type="submit" disabled={pending}>
            {pending ? 'Saving…' : selected ? 'Save changes' : 'Create template'}
          </button>
          {selected ? (
            <button type="button" className="dl-button" onClick={() => setSelected(null)}>
              Start a new template
            </button>
          ) : null}
        </div>
      </form>
    </>
  );
}
