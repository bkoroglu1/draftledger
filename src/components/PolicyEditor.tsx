'use client';

import { useActionState, useState } from 'react';
import { previewExpansionAction, savePolicyAction } from '#src/app/actions/admin.ts';

interface PolicyRow {
  id: string;
  scope: string;
  scopeRef: string | null;
  eventKey: string;
  channel: string;
  enabled: boolean;
  precedence: number;
  to: string[];
  cc: string[];
  suppress: string[];
  version: number;
}

export function PolicyEditor({
  catalog,
  policies,
  selectors,
  documents,
}: {
  catalog: Array<{ key: string; label: string; description: string | null; enabled: boolean }>;
  policies: PolicyRow[];
  selectors: string[];
  documents: Array<{ slug: string; title: string }>;
}) {
  const [saveState, saveAction, savePending] = useActionState(savePolicyAction, null);
  const [previewState, previewAction, previewPending] = useActionState(previewExpansionAction, null);
  const [selected, setSelected] = useState<PolicyRow | null>(policies[0] ?? null);

  return (
    <>
      <section className="dl-card">
        <h2>Event catalog</h2>
        <div className="dl-table-scroll">
          <table className="dl-table">
            <thead>
              <tr>
                <th scope="col">Event</th>
                <th scope="col">Key</th>
                <th scope="col">Enabled</th>
                <th scope="col">Description</th>
              </tr>
            </thead>
            <tbody>
              {catalog.map((event) => (
                <tr key={event.key}>
                  <td>{event.label}</td>
                  <td className="dl-mono">{event.key}</td>
                  <td>{event.enabled ? 'yes' : 'no'}</td>
                  <td>{event.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="dl-card">
        <h2>Active policies</h2>
        <div className="dl-table-scroll">
          <table className="dl-table">
            <thead>
              <tr>
                <th scope="col">Event</th>
                <th scope="col">Scope</th>
                <th scope="col">Prec.</th>
                <th scope="col">To</th>
                <th scope="col">Cc</th>
                <th scope="col">Suppress</th>
                <th scope="col">v</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {policies.map((policy) => (
                <tr key={policy.id}>
                  <td className="dl-mono">{policy.eventKey}</td>
                  <td>
                    {policy.scope}
                    {policy.scopeRef ? ` · ${policy.scopeRef}` : ''}
                  </td>
                  <td>{policy.precedence}</td>
                  <td className="dl-mono" style={{ fontSize: '0.75rem' }}>{policy.to.join(', ') || '—'}</td>
                  <td className="dl-mono" style={{ fontSize: '0.75rem' }}>{policy.cc.join(', ') || '—'}</td>
                  <td className="dl-mono" style={{ fontSize: '0.75rem' }}>{policy.suppress.join(', ') || '—'}</td>
                  <td>{policy.version}</td>
                  <td>
                    <button type="button" className="dl-button" onClick={() => setSelected(policy)}>
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <form action={saveAction} className="dl-card">
        <h2>{selected ? `Edit ${selected.eventKey} (${selected.scope})` : 'New policy'}</h2>
        {saveState?.error ? <p className="dl-error">{saveState.error}</p> : null}
        {saveState?.message ? <p className="dl-notice">{saveState.message}</p> : null}
        <input type="hidden" name="policyId" value={selected?.id ?? ''} />
        <div className="dl-form-grid">
          <label className="dl-field">
            <span>Event</span>
            <select name="eventKey" defaultValue={selected?.eventKey ?? catalog[0]?.key} key={selected?.id}>
              {catalog.map((e) => (
                <option key={e.key} value={e.key}>
                  {e.label}
                </option>
              ))}
            </select>
          </label>
          <label className="dl-field">
            <span>Scope</span>
            <select name="scope" defaultValue={selected?.scope ?? 'global'} key={`${selected?.id}-scope`}>
              <option value="global">global</option>
              <option value="namespace">namespace</option>
              <option value="group">group</option>
              <option value="document">document</option>
            </select>
          </label>
          <label className="dl-field">
            <span>Scope reference</span>
            <input name="scopeRef" defaultValue={selected?.scopeRef ?? ''} key={`${selected?.id}-ref`} placeholder="namespace key / group slug / document id" />
          </label>
          <label className="dl-field">
            <span>Channel</span>
            <input name="channel" defaultValue={selected?.channel ?? 'email'} key={`${selected?.id}-ch`} />
          </label>
          <label className="dl-field">
            <span>Precedence</span>
            <input name="precedence" type="number" defaultValue={selected?.precedence ?? 0} key={`${selected?.id}-p`} />
          </label>
          <label className="dl-field">
            <span>Enabled</span>
            <input name="enabled" type="checkbox" defaultChecked={selected?.enabled ?? true} key={`${selected?.id}-en`} />
          </label>
        </div>
        <p className="dl-muted" style={{ fontSize: '0.8125rem' }}>
          Available selectors: {selectors.join(', ')}, plus <code className="dl-mono">person:handle</code> and{' '}
          <code className="dl-mono">group:slug</code>. Comma-separated. Addresses are never entered here.
        </p>
        <div className="dl-form-grid">
          <label className="dl-field">
            <span>To selectors</span>
            <input name="to" defaultValue={selected?.to.join(', ') ?? ''} key={`${selected?.id}-to`} />
          </label>
          <label className="dl-field">
            <span>Cc selectors</span>
            <input name="cc" defaultValue={selected?.cc.join(', ') ?? ''} key={`${selected?.id}-cc`} />
          </label>
          <label className="dl-field">
            <span>Suppress selectors</span>
            <input name="suppress" defaultValue={selected?.suppress.join(', ') ?? ''} key={`${selected?.id}-su`} />
          </label>
        </div>
        <div className="dl-actions">
          <button className="dl-button dl-button-primary" type="submit" disabled={savePending}>
            {savePending ? 'Saving…' : 'Save as new version'}
          </button>
          <button type="button" className="dl-button" onClick={() => setSelected(null)}>
            Start a new policy
          </button>
        </div>
      </form>

      <form action={previewAction} className="dl-card">
        <h2>Preview expansion</h2>
        <p className="dl-muted">
          Computes the recipients for one document and event. This never creates a delivery job.
        </p>
        {previewState?.error ? <p className="dl-error">{previewState.error}</p> : null}
        <div className="dl-actions">
          <label className="dl-field">
            <span className="dl-sr-only">Document</span>
            <select name="documentSlug">
              {documents.map((d) => (
                <option key={d.slug} value={d.slug}>
                  {d.slug}
                </option>
              ))}
            </select>
          </label>
          <label className="dl-field">
            <span className="dl-sr-only">Event</span>
            <select name="eventKey">
              {catalog.map((e) => (
                <option key={e.key} value={e.key}>
                  {e.label}
                </option>
              ))}
            </select>
          </label>
          <button className="dl-button" type="submit" disabled={previewPending}>
            {previewPending ? 'Computing…' : 'Preview'}
          </button>
        </div>
        {previewState?.preview ? <pre className="dl-page">{previewState.preview}</pre> : null}
      </form>
    </>
  );
}
