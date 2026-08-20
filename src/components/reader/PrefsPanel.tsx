'use client';

import { MAX_FONT_PT, MIN_FONT_PT, type ReaderPrefs } from '#src/lib/prefs.ts';

export function PrefsPanel({
  prefs,
  onChange,
  htmlAvailable,
}: {
  prefs: ReaderPrefs;
  onChange: (patch: Partial<ReaderPrefs>) => void;
  htmlAvailable: boolean;
}) {
  return (
    <div>
      <div className="dl-pref">
        <label htmlFor="pref-sidebar">Show sidebar by default</label>
        <select
          id="pref-sidebar"
          value={prefs.showSidebar === null ? 'device' : prefs.showSidebar ? 'yes' : 'no'}
          onChange={(e) =>
            onChange({
              showSidebar: e.target.value === 'device' ? null : e.target.value === 'yes',
            })
          }
        >
          <option value="yes">Yes</option>
          <option value="no">No</option>
          <option value="device">Follow device width</option>
        </select>
        <p className="dl-pref-hint">
          Device default: open on desktop, closed on narrow screens. Your explicit choice always
          wins.
        </p>
      </div>

      <div className="dl-pref">
        <label htmlFor="pref-tab">Tab to show by default</label>
        <select
          id="pref-tab"
          value={prefs.defaultTab}
          onChange={(e) => onChange({ defaultTab: e.target.value as 'info' | 'contents' })}
        >
          <option value="info">Info</option>
          <option value="contents">Contents</option>
        </select>
      </div>

      <div className="dl-pref">
        <label htmlFor="pref-htmlization">HTMLization configuration</label>
        <select
          id="pref-htmlization"
          value={prefs.htmlization}
          onChange={(e) => onChange({ htmlization: e.target.value as ReaderPrefs['htmlization'] })}
        >
          <option value="htmlize-plaintext">HTMLize the plaintext</option>
          <option value="plaintextify-html" disabled={!htmlAvailable}>
            Plaintextify the HTML{htmlAvailable ? '' : ' (no HTML artifact)'}
          </option>
        </select>
        <p className="dl-pref-hint">
          {htmlAvailable
            ? 'Both source artifacts exist for this revision.'
            : 'This revision has no stored HTML artifact, so only the plaintext path is available.'}
        </p>
      </div>

      <div className="dl-pref">
        <label htmlFor="pref-font">Maximum font size: {prefs.fontSizePt}pt</label>
        <input
          id="pref-font"
          type="range"
          min={MIN_FONT_PT}
          max={MAX_FONT_PT}
          step={1}
          value={prefs.fontSizePt}
          onChange={(e) => onChange({ fontSizePt: Number(e.target.value) })}
        />
        <p className="dl-pref-hint">
          Between {MIN_FONT_PT}pt and {MAX_FONT_PT}pt. Section positions are unaffected.
        </p>
      </div>

      <div className="dl-pref">
        <label htmlFor="pref-deps">Page dependencies</label>
        <select
          id="pref-deps"
          value={prefs.pageDependencies}
          onChange={(e) =>
            onChange({ pageDependencies: e.target.value as ReaderPrefs['pageDependencies'] })
          }
        >
          <option value="inline">Inline (offline friendly)</option>
          <option value="reference">Reference internal artifact URLs</option>
        </select>
        <p className="dl-pref-hint">
          Dependencies are always served from this installation; upstream hosts are never hotlinked.
        </p>
      </div>

      <div className="dl-pref">
        <label htmlFor="pref-citations">Citation links</label>
        <select
          id="pref-citations"
          value={prefs.citationLinks}
          onChange={(e) =>
            onChange({ citationLinks: e.target.value as ReaderPrefs['citationLinks'] })
          }
        >
          <option value="reference-section">Go to reference section</option>
          <option value="linked-document">Go to linked document</option>
        </select>
        <p className="dl-pref-hint">
          Controls whether [KEY] scrolls to the bibliography entry or opens the referenced document
          in this reader.
        </p>
      </div>

      <div className="dl-pref">
        <p className="dl-pref-hint">
          <a href="/about">About this installation</a> — licence and source code.
        </p>
      </div>
    </div>
  );
}
