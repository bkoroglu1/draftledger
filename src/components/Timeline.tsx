import Link from 'next/link';
import type { TimelineModel } from '#src/services/timeline.ts';
import { timelineToTable } from '#src/services/timeline.ts';

const STATE_LABELS: Record<string, string> = {
  drafting: 'Editing',
  review: 'In review',
  'changes-requested': 'Changes requested',
  approved: 'Approved',
  publishing: 'Publishing',
  published: 'Published',
  superseded: 'Superseded',
  withdrawn: 'Withdrawn',
  historic: 'Historic',
  idea: 'Idea',
};

const STATE_MARKS: Record<string, string> = {
  drafting: '▢',
  review: '◔',
  'changes-requested': '▲',
  approved: '◕',
  publishing: '◑',
  published: '●',
  superseded: '◇',
  withdrawn: '✕',
  historic: '◌',
  idea: '·',
};

/**
 * Lifecycle timeline. Positions come from real timestamps, colour is never the
 * only signal (each segment carries a mark, a label and an accessible name),
 * and the same data is repeated as a table for screen readers and for print.
 */
export function Timeline({ model }: { model: TimelineModel }) {
  if (model.empty) {
    return (
      <p className="dl-muted">
        This document has no revisions yet, so there is nothing to place on a timeline.
      </p>
    );
  }

  const start = model.start.getTime();
  // `model.end` already accounts for "now"; recomputing it here would be an
  // impure read during render.
  const end = Math.max(model.end.getTime(), start + 86_400_000);
  const span = end - start;
  const pct = (time: number) => ((time - start) / span) * 100;
  const openEnded = model.end;
  const rows = timelineToTable(model);
  const states = [...new Set(model.rows.flatMap((r) => r.segments.map((s) => s.state)))];

  return (
    <div>
      <div className="dl-timeline">
        <div className="dl-timeline-grid">
          {model.rows.map((row) => (
            <div className="dl-timeline-row" key={row.key}>
              <div className="dl-timeline-label">
                {row.label}
                <span className="dl-muted"> ({row.kind})</span>
              </div>
              <div className="dl-timeline-track">
                {row.segments.map((segment) => {
                  const from = pct(segment.start.getTime());
                  const to = pct((segment.end ?? openEnded).getTime());
                  const width = Math.max(1.5, to - from);
                  const title = [
                    `${row.label} ${segment.revisionLabel}`,
                    `${STATE_LABELS[segment.state] ?? segment.state}`,
                    `${segment.start.toISOString().slice(0, 16).replace('T', ' ')} → ${
                      segment.end ? segment.end.toISOString().slice(0, 16).replace('T', ' ') : 'now'
                    }`,
                    `by ${segment.actorName}`,
                    segment.changeSummary ?? '',
                    `checksum ${segment.checksumShort}`,
                  ]
                    .filter(Boolean)
                    .join(' · ');
                  return (
                    <Link
                      key={segment.id}
                      href={segment.href}
                      className="dl-timeline-seg"
                      data-state={segment.state}
                      data-current={segment.isCurrent ? 'true' : undefined}
                      style={{ left: `${from}%`, width: `${width}%` }}
                      title={title}
                      aria-label={title}
                    >
                      <span aria-hidden="true">
                        {STATE_MARKS[segment.state] ?? '▢'} {segment.revisionLabel}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <div className="dl-timeline-axis" aria-hidden="true">
          <span>{new Date(start).toISOString().slice(0, 10)}</span>
          <span>{new Date(start + span / 2).toISOString().slice(0, 10)}</span>
          <span>{new Date(end).toISOString().slice(0, 10)}</span>
        </div>
        <div className="dl-legend">
          {states.map((state) => (
            <span key={state} data-state={state} className={`dl-timeline-seg-legend dl-state-${state}`}>
              {STATE_MARKS[state] ?? '▢'} {STATE_LABELS[state] ?? state}
            </span>
          ))}
        </div>
      </div>

      {model.markers.length ? (
        <ul className="dl-muted" style={{ fontSize: '0.8125rem', marginTop: '0.5rem' }}>
          {model.markers.map((marker) => (
            <li key={`${marker.kind}-${marker.at.toISOString()}`}>
              {marker.at.toISOString().slice(0, 10)} — {marker.label}
            </li>
          ))}
        </ul>
      ) : null}

      <details style={{ marginTop: '0.75rem' }}>
        <summary>Timeline as a table</summary>
        <div className="dl-table-scroll">
          <table className="dl-table">
            <caption className="dl-sr-only">
              Every timeline segment with its revision, lifecycle state, date range and actor.
            </caption>
            <thead>
              <tr>
                <th scope="col">Row</th>
                <th scope="col">Revision</th>
                <th scope="col">State</th>
                <th scope="col">From</th>
                <th scope="col">To</th>
                <th scope="col">By</th>
                <th scope="col">Checksum</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.row}-${row.revision}`}>
                  <td>{row.row}</td>
                  <td>
                    <Link href={row.href}>{row.revision}</Link>
                  </td>
                  <td>{STATE_LABELS[row.state] ?? row.state}</td>
                  <td>{row.from.toISOString().slice(0, 16).replace('T', ' ')}</td>
                  <td>{row.to ? row.to.toISOString().slice(0, 16).replace('T', ' ') : 'now'}</td>
                  <td>{row.actor}</td>
                  <td className="dl-mono">{row.checksum}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
