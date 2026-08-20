import type { DiffView as DiffViewMode } from '#src/domain/types.ts';
import { toChangeBars, type DiffResult } from '#src/diff/index.ts';

/**
 * Diff renderer for all four views. Colour never carries the meaning on its
 * own: rows are marked with +/-, insertions and deletions use <ins>/<del>, and
 * every view ships a textual legend.
 */
export function DiffView({
  result,
  mode,
  beforeLabel,
  afterLabel,
  beforeText,
  afterText,
}: {
  result: DiffResult;
  mode: DiffViewMode;
  beforeLabel: string;
  afterLabel: string;
  beforeText: string;
  afterText: string;
}) {
  if (result.identical) {
    return <p className="dl-notice">These two revisions have identical canonical sources.</p>;
  }

  return (
    <>
      <p className="dl-muted" style={{ fontSize: '0.8125rem' }}>
        <strong>{result.stats.added}</strong> line(s) added, <strong>{result.stats.removed}</strong>{' '}
        removed, across <strong>{result.stats.changedHunks}</strong> hunk(s). Legend:{' '}
        <code className="dl-mono">+</code> added, <code className="dl-mono">-</code> removed,{' '}
        <code className="dl-mono">|</code> change bar. Whitespace is significant and is never hidden.
      </p>
      {mode === 'inline' ? <InlineView result={result} /> : null}
      {mode === 'side-by-side' ? (
        <SideBySideView result={result} beforeLabel={beforeLabel} afterLabel={afterLabel} />
      ) : null}
      {mode === 'change-bars' ? <ChangeBarsView result={result} /> : null}
      {mode === 'before-after' ? (
        <BeforeAfterView
          beforeLabel={beforeLabel}
          afterLabel={afterLabel}
          beforeText={beforeText}
          afterText={afterText}
        />
      ) : null}
    </>
  );
}

function InlineView({ result }: { result: DiffResult }) {
  return (
    <div className="dl-diff">
      <table>
        <caption className="dl-sr-only">Inline diff with additions and deletions in one flow.</caption>
        <tbody>
          {result.hunks.map((hunk) => (
            <>
              <tr key={hunk.header}>
                <td className="dl-diff-hunk-header" colSpan={3}>
                  {hunk.header}
                </td>
              </tr>
              {hunk.rows.map((row, i) => (
                <tr key={`${hunk.header}-${i}`} data-type={row.type}>
                  <td className="dl-lineno">{row.aNumber ?? ''}</td>
                  <td className="dl-lineno">{row.bNumber ?? ''}</td>
                  <td>
                    {row.type === 'insert' ? (
                      <ins>+{row.text}</ins>
                    ) : row.type === 'delete' ? (
                      <del>-{row.text}</del>
                    ) : (
                      <span> {row.text}</span>
                    )}
                  </td>
                </tr>
              ))}
            </>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SideBySideView({
  result,
  beforeLabel,
  afterLabel,
}: {
  result: DiffResult;
  beforeLabel: string;
  afterLabel: string;
}) {
  return (
    <div className="dl-diff">
      <table>
        <caption className="dl-sr-only">
          Side-by-side diff: {beforeLabel} on the left, {afterLabel} on the right.
        </caption>
        <thead>
          <tr>
            <th colSpan={2} scope="col">
              {beforeLabel}
            </th>
            <th colSpan={2} scope="col">
              {afterLabel}
            </th>
          </tr>
        </thead>
        <tbody>
          {result.hunks.map((hunk) => (
            <>
              <tr key={hunk.header}>
                <td className="dl-diff-hunk-header" colSpan={4}>
                  {hunk.header}
                </td>
              </tr>
              {hunk.sideBySide.map((row, i) => (
                <tr key={`${hunk.header}-sbs-${i}`}>
                  <td className="dl-lineno">{row.left.number ?? ''}</td>
                  <td data-type={row.left.type} style={cellStyle(row.left.type)}>
                    {row.left.type === 'delete' ? <del>{row.left.text}</del> : row.left.text}
                  </td>
                  <td className="dl-lineno">{row.right.number ?? ''}</td>
                  <td data-type={row.right.type} style={cellStyle(row.right.type)}>
                    {row.right.type === 'insert' ? <ins>{row.right.text}</ins> : row.right.text}
                  </td>
                </tr>
              ))}
            </>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function cellStyle(type: string): React.CSSProperties {
  if (type === 'insert') return { background: 'var(--dl-diff-add-bg)', color: 'var(--dl-diff-add-fg)' };
  if (type === 'delete') return { background: 'var(--dl-diff-del-bg)', color: 'var(--dl-diff-del-fg)' };
  if (type === 'empty') return { background: 'var(--dl-subtle)' };
  return {};
}

function ChangeBarsView({ result }: { result: DiffResult }) {
  const lines = toChangeBars(result.rows);
  return (
    <div className="dl-diff">
      <table>
        <caption className="dl-sr-only">
          Change bars: the full text with changed, added and removed lines marked in the margin.
        </caption>
        <tbody>
          {lines.map((line, i) => (
            <tr key={i} data-marker={line.marker || undefined}>
              <td className="dl-lineno">{line.number ?? ''}</td>
              <td className="dl-marker" aria-hidden="true">
                {line.marker === 'added' ? '+' : line.marker === 'removed' ? '-' : line.marker ? '|' : ''}
              </td>
              <td>
                {line.marker ? <span className="dl-sr-only">{line.label}: </span> : null}
                {line.text}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BeforeAfterView({
  beforeLabel,
  afterLabel,
  beforeText,
  afterText,
}: {
  beforeLabel: string;
  afterLabel: string;
  beforeText: string;
  afterText: string;
}) {
  return (
    <div>
      <section className="dl-card">
        <h2>Before — {beforeLabel}</h2>
        <pre className="dl-page" style={{ maxHeight: '40vh', overflow: 'auto' }}>
          {beforeText}
        </pre>
      </section>
      <section className="dl-card">
        <h2>After — {afterLabel}</h2>
        <pre className="dl-page" style={{ maxHeight: '40vh', overflow: 'auto' }}>
          {afterText}
        </pre>
      </section>
    </div>
  );
}
