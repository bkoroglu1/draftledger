'use client';

import { useActionState } from 'react';
import { reportErratumAction } from '#src/app/actions/errata.ts';

export function ErratumForm({
  slug,
  sections,
}: {
  slug: string;
  sections: Array<{ anchor: string; number: string | null; title: string }>;
}) {
  const [state, action, pending] = useActionState(reportErratumAction, null);

  return (
    <form action={action} className="dl-card">
      {state?.error ? <p className="dl-error">{state.error}</p> : null}
      <input type="hidden" name="slug" value={slug} />
      <div className="dl-form-grid">
        <label className="dl-field">
          <span>Erratum type</span>
          <select name="type" defaultValue="editorial" required>
            <option value="editorial">Editorial</option>
            <option value="technical">Technical</option>
          </select>
        </label>
        <label className="dl-field">
          <span>Section</span>
          <select
            name="sectionAnchor"
            defaultValue=""
            onChange={(e) => {
              const form = e.currentTarget.form;
              const picked = sections.find((s) => s.anchor === e.currentTarget.value);
              if (form) {
                (form.elements.namedItem('sectionNumber') as HTMLInputElement).value =
                  picked?.number ?? '';
              }
            }}
          >
            <option value="">Whole document</option>
            {sections.map((s) => (
              <option key={s.anchor} value={s.anchor}>
                {s.number ? `${s.number}. ` : ''}
                {s.title}
              </option>
            ))}
          </select>
        </label>
        <input type="hidden" name="sectionNumber" defaultValue="" />
      </div>
      <label className="dl-field" style={{ marginTop: '0.75rem' }}>
        <span>Original text</span>
        <textarea name="originalText" rows={3} placeholder="Quote the published text exactly" />
      </label>
      <label className="dl-field" style={{ marginTop: '0.75rem' }}>
        <span>Corrected text</span>
        <textarea name="correctedText" rows={3} placeholder="Proposed correction" />
      </label>
      <label className="dl-field" style={{ marginTop: '0.75rem' }}>
        <span>Notes</span>
        <textarea name="notes" rows={3} placeholder="Why this is an error" />
      </label>
      <div className="dl-actions">
        <button className="dl-button dl-button-primary" type="submit" disabled={pending}>
          {pending ? 'Filing…' : 'File erratum'}
        </button>
      </div>
    </form>
  );
}
