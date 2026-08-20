'use client';

import { useActionState } from 'react';
import { importUpstreamAction } from '#src/app/actions/import.ts';

/**
 * Import is always an explicit user action — typing in the search box never
 * causes an outbound request.
 */
export function ImportPrompt({ query, enabled }: { query: string; enabled: boolean }) {
  const [state, action, pending] = useActionState(importUpstreamAction, null);

  if (!enabled) {
    return (
      <p className="dl-muted">
        The external import adapter is disabled on this installation, so only local documents are
        searchable.
      </p>
    );
  }

  return (
    <form action={action} className="dl-card">
      <h2>Import from upstream</h2>
      <p className="dl-muted">
        Fetches the document from the configured upstream allowlist and stores it read-only.
      </p>
      {state?.error ? <p className="dl-error">{state.error}</p> : null}
      <div className="dl-actions">
        <label className="dl-field" style={{ flex: '1 1 16rem' }}>
          <span className="dl-sr-only">Upstream reference</span>
          <input type="text" name="ref" defaultValue={query} placeholder="rfc5280 or draft-example-name" />
        </label>
        <button className="dl-button" type="submit" disabled={pending}>
          {pending ? 'Importing…' : 'Import from upstream'}
        </button>
      </div>
    </form>
  );
}
