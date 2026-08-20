'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { saveDraftAction, createRevisionAction } from '#src/app/actions/drafts.ts';

interface Diagnostic {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  line?: number;
  hint?: string;
}

interface OutlineItem {
  anchor: string;
  number: string | null;
  title: string;
  depth: number;
  line: number;
}

interface PreviewPayload {
  pages: string[];
  pageCount: number;
  wordCount: number;
  checksum: string;
  outline: OutlineItem[];
  diagnostics: Diagnostic[];
}

type SaveState =
  | { kind: 'idle' }
  | { kind: 'dirty' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: string }
  | { kind: 'conflict'; message: string }
  | { kind: 'error'; message: string };

const AUTOSAVE_DELAY_MS = 1200;
const PREVIEW_DELAY_MS = 600;

export function DraftEditor({
  slug,
  initialSource,
  initialVersion,
  canEdit,
}: {
  slug: string;
  initialSource: string;
  initialVersion: number;
  canEdit: boolean;
}) {
  const [source, setSource] = useState(initialSource);
  const [version, setVersion] = useState(initialVersion);
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' });
  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [tab, setTab] = useState<'preview' | 'outline' | 'diagnostics'>('preview');
  const [fullscreen, setFullscreen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [revisionNote, setRevisionNote] = useState('');
  const [revisionMessage, setRevisionMessage] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const saveTimer = useRef<number | null>(null);
  const previewTimer = useRef<number | null>(null);
  const latestSource = useRef(initialSource);

  const runPreview = useCallback(async (value: string) => {
    try {
      const response = await fetch(`/api/drafts/${encodeURIComponent(slug)}/preview`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source: value }),
      });
      if (!response.ok) {
        const payload = (await response.json()) as { message?: string };
        setPreviewError(payload.message ?? 'Preview failed.');
        return;
      }
      setPreviewError(null);
      setPreview((await response.json()) as PreviewPayload);
    } catch {
      setPreviewError('Preview request failed. The document is unchanged.');
    }
  }, [slug]);

  const save = useCallback(
    async (value: string) => {
      if (!canEdit) return;
      setSaveState({ kind: 'saving' });
      const formData = new FormData();
      formData.set('slug', slug);
      formData.set('source', value);
      formData.set('version', String(version));
      const result = await saveDraftAction(null, formData);
      if (result?.error) {
        // A concurrent save must never be silently overwritten.
        setSaveState(
          result.error.includes('changed by someone else')
            ? { kind: 'conflict', message: result.error }
            : { kind: 'error', message: result.error },
        );
        return;
      }
      if (typeof result?.version === 'number') setVersion(result.version);
      setSaveState({ kind: 'saved', at: new Date().toISOString().slice(11, 19) });
    },
    [canEdit, slug, version],
  );

  const onChange = (value: string) => {
    setSource(value);
    latestSource.current = value;
    setSaveState({ kind: 'dirty' });

    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    if (previewTimer.current) window.clearTimeout(previewTimer.current);
    // Debounced: the whole document is not reparsed on every keystroke.
    saveTimer.current = window.setTimeout(() => void save(latestSource.current), AUTOSAVE_DELAY_MS);
    previewTimer.current = window.setTimeout(
      () => void runPreview(latestSource.current),
      PREVIEW_DELAY_MS,
    );
  };

  const createRevision = useCallback(async () => {
    const formData = new FormData();
    formData.set('slug', slug);
    formData.set('changeSummary', revisionNote);
    const result = await createRevisionAction(null, formData);
    setRevisionMessage(result?.error ?? result?.message ?? null);
    if (!result?.error) setRevisionNote('');
  }, [slug, revisionNote]);

  // The first preview is requested once the component is interactive; the
  // server already rendered the source, so there is nothing to show before it.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!cancelled) await runPreview(initialSource);
    })();
    return () => {
      cancelled = true;
    };
  }, [initialSource, runPreview]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void save(latestSource.current);
      } else if (mod && event.key === 'Enter') {
        event.preventDefault();
        void createRevision();
      } else if (mod && event.key.toLowerCase() === 'f' && document.activeElement === textareaRef.current) {
        event.preventDefault();
        setFindOpen(true);
      } else if (event.key === 'Escape' && fullscreen) {
        setFullscreen(false);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  });

  const jumpToLine = (line: number) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const lines = source.split('\n');
    const offset = lines.slice(0, Math.max(0, line - 1)).join('\n').length + (line > 1 ? 1 : 0);
    textarea.focus();
    textarea.setSelectionRange(offset, offset);
    const ratio = (line - 1) / Math.max(1, lines.length);
    textarea.scrollTop = ratio * textarea.scrollHeight;
  };

  const errors = preview?.diagnostics.filter((d) => d.severity === 'error').length ?? 0;
  const warnings = preview?.diagnostics.filter((d) => d.severity === 'warning').length ?? 0;

  return (
    <div
      style={
        fullscreen
          ? {
              position: 'fixed',
              inset: 0,
              background: 'var(--dl-bg)',
              zIndex: 50,
              padding: '1rem',
              overflow: 'auto',
            }
          : undefined
      }
    >
      <div className="dl-actions" role="toolbar" aria-label="Editor actions">
        <span
          className="dl-notice"
          role="status"
          aria-live="polite"
          style={{ margin: 0, padding: '0.35rem 0.6rem' }}
        >
          {saveState.kind === 'idle' && 'No unsaved changes'}
          {saveState.kind === 'dirty' && 'Unsaved changes…'}
          {saveState.kind === 'saving' && 'Saving…'}
          {saveState.kind === 'saved' && `Autosaved at ${saveState.at} UTC`}
          {saveState.kind === 'conflict' && `Conflict: ${saveState.message}`}
          {saveState.kind === 'error' && `Error: ${saveState.message}`}
        </span>
        <button type="button" className="dl-button" onClick={() => void save(latestSource.current)} disabled={!canEdit}>
          Save now
        </button>
        <button type="button" className="dl-button" onClick={() => setFindOpen((v) => !v)}>
          Find &amp; replace
        </button>
        <button type="button" className="dl-button" aria-pressed={fullscreen} onClick={() => setFullscreen((v) => !v)}>
          {fullscreen ? 'Exit full screen' : 'Full screen'}
        </button>
        <span className="dl-muted" style={{ alignSelf: 'center', fontSize: '0.8125rem' }}>
          {preview ? `${preview.pageCount} page(s) · ${preview.wordCount} words · ${preview.checksum.slice(0, 10)}` : '…'}
        </span>
      </div>

      {saveState.kind === 'conflict' ? (
        <div className="dl-error">
          <strong>Someone else saved this draft while you were editing.</strong> Your text is still in
          the box below and has <em>not</em> been discarded. Reload to load their version, or copy
          your changes out first — nothing is overwritten automatically.
        </div>
      ) : null}

      {findOpen ? (
        <FindReplace
          source={source}
          onReplace={(next) => onChange(next)}
          onClose={() => setFindOpen(false)}
        />
      ) : null}

      <div className="dl-editor-layout">
        <div>
          <label htmlFor="dl-source" className="dl-sr-only">
            Document source
          </label>
          <textarea
            id="dl-source"
            ref={textareaRef}
            className="dl-editor-source"
            value={source}
            spellCheck={false}
            readOnly={!canEdit}
            onChange={(e) => onChange(e.target.value)}
            style={fullscreen ? { minHeight: '75vh' } : undefined}
          />
          {canEdit ? (
            <div className="dl-actions">
              <label className="dl-field" style={{ flex: '1 1 16rem' }}>
                <span className="dl-sr-only">Change summary</span>
                <input
                  type="text"
                  value={revisionNote}
                  onChange={(e) => setRevisionNote(e.target.value)}
                  placeholder="Change summary for this revision"
                />
              </label>
              <button type="button" className="dl-button dl-button-primary" onClick={() => void createRevision()}>
                Create revision
              </button>
              {revisionMessage ? (
                <span className="dl-muted" role="status" style={{ alignSelf: 'center' }}>
                  {revisionMessage}
                </span>
              ) : null}
            </div>
          ) : (
            <p className="dl-notice">
              You can read this source but not edit it. Published documents are immutable; use an
              erratum or an update draft instead.
            </p>
          )}
        </div>

        <div>
          <div className="dl-doctabs" role="tablist" aria-label="Editor side panel">
            {(['preview', 'outline', 'diagnostics'] as const).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                className="dl-doctab"
                onClick={() => setTab(key)}
              >
                {key === 'diagnostics'
                  ? `Diagnostics${errors + warnings ? ` (${errors + warnings})` : ''}`
                  : key.charAt(0).toUpperCase() + key.slice(1)}
              </button>
            ))}
          </div>

          {previewError ? <p className="dl-error">{previewError}</p> : null}

          {tab === 'preview' ? (
            <div className="dl-preview">
              {preview ? (
                preview.pages.map((html, i) => (
                  <div key={i} dangerouslySetInnerHTML={{ __html: html }} />
                ))
              ) : (
                <p className="dl-muted">Rendering…</p>
              )}
            </div>
          ) : null}

          {tab === 'outline' ? (
            <div className="dl-preview">
              {preview?.outline.length ? (
                <ul className="dl-contents-tree">
                  {preview.outline.map((item) => (
                    <li key={item.anchor}>
                      <button
                        type="button"
                        className="dl-button"
                        style={{
                          border: 0,
                          background: 'none',
                          paddingLeft: `${(item.depth - 1) * 0.85}rem`,
                        }}
                        onClick={() => jumpToLine(item.line)}
                      >
                        <span className="dl-contents-number">{item.number ?? '·'}</span>
                        <span>{item.title}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="dl-muted">No headings found yet.</p>
              )}
            </div>
          ) : null}

          {tab === 'diagnostics' ? (
            <div className="dl-preview">
              {preview?.diagnostics.length ? (
                preview.diagnostics.map((d, i) => (
                  <div key={i} className="dl-diagnostic" data-severity={d.severity}>
                    <strong>{d.severity}</strong> <code className="dl-mono">{d.code}</code>
                    {d.line ? (
                      <>
                        {' '}
                        <button
                          type="button"
                          className="dl-button"
                          style={{ padding: '0 0.3rem' }}
                          onClick={() => jumpToLine(d.line!)}
                        >
                          line {d.line}
                        </button>
                      </>
                    ) : null}
                    <div>{d.message}</div>
                    {d.hint ? <div className="dl-muted">Hint: {d.hint}</div> : null}
                  </div>
                ))
              ) : (
                <p className="dl-muted">No diagnostics. This source validates cleanly.</p>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function FindReplace({
  source,
  onReplace,
  onClose,
}: {
  source: string;
  onReplace: (next: string) => void;
  onClose: () => void;
}) {
  const [find, setFind] = useState('');
  const [replace, setReplace] = useState('');
  const matches = find ? source.split(find).length - 1 : 0;

  return (
    <div className="dl-card dl-actions" role="search">
      <label className="dl-field">
        <span className="dl-sr-only">Find</span>
        <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find" autoFocus />
      </label>
      <label className="dl-field">
        <span className="dl-sr-only">Replace with</span>
        <input value={replace} onChange={(e) => setReplace(e.target.value)} placeholder="Replace with" />
      </label>
      <span className="dl-muted" style={{ alignSelf: 'center' }}>
        {matches} match(es)
      </span>
      <button
        type="button"
        className="dl-button"
        disabled={!find || matches === 0}
        onClick={() => onReplace(source.split(find).join(replace))}
      >
        Replace all
      </button>
      <button type="button" className="dl-button" onClick={onClose}>
        Close
      </button>
    </div>
  );
}
