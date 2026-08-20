'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { DIFF_VIEWS, type DiffView } from '#src/domain/types.ts';

export interface RevisionOption {
  slug: string;
  label: string;
  date: string;
  checksum: string;
  family: string;
}

const VIEW_LABELS: Record<DiffView, string> = {
  'side-by-side': 'Side-by-side',
  'before-after': 'Before-after',
  'change-bars': 'Change bars',
  inline: 'Inline',
};

export function CompareControls({
  options,
  defaultFrom,
  defaultTo,
}: {
  options: RevisionOption[];
  defaultFrom: string;
  defaultTo: string;
}) {
  const router = useRouter();
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);

  if (options.length < 2) {
    return <p className="dl-muted">Only one revision exists, so there is nothing to compare yet.</p>;
  }

  const same = from === to;
  const go = (view: DiffView) => {
    if (same) return;
    router.push(`/compare?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&view=${view}`);
  };

  const describe = (o: RevisionOption) =>
    `${o.family} ${o.label} · ${o.date} · ${o.checksum}`;

  return (
    <div>
      <label className="dl-field" htmlFor="cmp-from">
        <span>From revision</span>
        <select id="cmp-from" value={from} onChange={(e) => setFrom(e.target.value)}>
          {options.map((o) => (
            <option key={o.slug} value={o.slug}>
              {describe(o)}
            </option>
          ))}
        </select>
      </label>
      <label className="dl-field" htmlFor="cmp-to" style={{ marginTop: '0.4rem' }}>
        <span>To revision</span>
        <select id="cmp-to" value={to} onChange={(e) => setTo(e.target.value)}>
          {options.map((o) => (
            <option key={o.slug} value={o.slug} disabled={o.slug === from}>
              {describe(o)}
            </option>
          ))}
        </select>
      </label>
      {same ? (
        <p className="dl-pref-hint" role="status">
          Pick two different revisions to compare.
        </p>
      ) : null}
      <div className="dl-actions">
        {DIFF_VIEWS.map((view) => (
          <button
            key={view}
            type="button"
            className="dl-button"
            disabled={same}
            onClick={() => go(view)}
          >
            {VIEW_LABELS[view]}
          </button>
        ))}
      </div>
    </div>
  );
}
