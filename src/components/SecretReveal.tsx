'use client';

import { useState } from 'react';

/**
 * Shows a value that exists only in this response — a generated password or a
 * one-time link. It is never re-fetchable, so the copy affordance matters.
 */
export function SecretReveal({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="dl-secret" data-testid="secret-reveal">
      <strong>{label}</strong>
      <code className="dl-mono dl-secret-value">{value}</code>
      <div className="dl-actions">
        <button
          type="button"
          className="dl-button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
            } catch {
              // Clipboard access can be refused; the value is selectable anyway.
              setCopied(false);
            }
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <p className="dl-muted" style={{ fontSize: '0.8125rem', margin: 0 }}>
        {note}
      </p>
    </div>
  );
}
