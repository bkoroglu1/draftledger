import type { DiffView } from '#src/domain/types.ts';
import type { Edit } from './myers.ts';
import { patienceDiff } from './patience.ts';

export { myersDiff } from './myers.ts';
export { patienceDiff } from './patience.ts';
export type { Edit } from './myers.ts';

export type RowType = 'equal' | 'insert' | 'delete' | 'empty';

export interface DiffRow {
  type: RowType;
  aNumber: number | null;
  bNumber: number | null;
  text: string;
}

export interface SideBySideRow {
  left: { number: number | null; text: string; type: RowType };
  right: { number: number | null; text: string; type: RowType };
}

export interface DiffHunk {
  aStart: number;
  aCount: number;
  bStart: number;
  bCount: number;
  header: string;
  rows: DiffRow[];
  sideBySide: SideBySideRow[];
}

export interface DiffStats {
  added: number;
  removed: number;
  unchanged: number;
  changedHunks: number;
}

export interface DiffResult {
  hunks: DiffHunk[];
  stats: DiffStats;
  /** Full row list, used by inline and change-bars views. */
  rows: DiffRow[];
  identical: boolean;
}

export interface DiffOptions {
  /** Context lines kept around each change. */
  context?: number;
  /** Off by default: whitespace is meaningful in fixed-width technical text. */
  ignoreWhitespace?: boolean;
  algorithm?: 'patience' | 'myers';
}

export function diffText(before: string, after: string, options: DiffOptions = {}): DiffResult {
  return diffLines(splitLines(before), splitLines(after), options);
}

export function splitLines(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

export function diffLines(
  beforeLines: string[],
  afterLines: string[],
  options: DiffOptions = {},
): DiffResult {
  const context = options.context ?? 3;
  const normalize = options.ignoreWhitespace
    ? (l: string) => l.replace(/\s+/g, ' ').trim()
    : (l: string) => l;

  const a = beforeLines.map(normalize);
  const b = afterLines.map(normalize);
  const edits: Edit[] = patienceDiff(a, b);

  const rows: DiffRow[] = edits.map((edit) => {
    if (edit.type === 'equal') {
      return {
        type: 'equal',
        aNumber: edit.aIndex + 1,
        bNumber: edit.bIndex + 1,
        text: beforeLines[edit.aIndex] ?? '',
      };
    }
    if (edit.type === 'delete') {
      return { type: 'delete', aNumber: edit.aIndex + 1, bNumber: null, text: beforeLines[edit.aIndex] ?? '' };
    }
    return { type: 'insert', aNumber: null, bNumber: edit.bIndex + 1, text: afterLines[edit.bIndex] ?? '' };
  });

  const stats: DiffStats = {
    added: rows.filter((r) => r.type === 'insert').length,
    removed: rows.filter((r) => r.type === 'delete').length,
    unchanged: rows.filter((r) => r.type === 'equal').length,
    changedHunks: 0,
  };

  const hunks = buildHunks(rows, context);
  stats.changedHunks = hunks.length;

  return { hunks, stats, rows, identical: stats.added === 0 && stats.removed === 0 };
}

function buildHunks(rows: DiffRow[], context: number): DiffHunk[] {
  const changedIdx = rows
    .map((r, i) => (r.type === 'equal' ? -1 : i))
    .filter((i) => i !== -1);
  if (!changedIdx.length) return [];

  const ranges: Array<[number, number]> = [];
  let start = Math.max(0, changedIdx[0]! - context);
  let end = Math.min(rows.length - 1, changedIdx[0]! + context);

  for (const idx of changedIdx.slice(1)) {
    if (idx - context <= end + 1) {
      end = Math.min(rows.length - 1, idx + context);
    } else {
      ranges.push([start, end]);
      start = Math.max(0, idx - context);
      end = Math.min(rows.length - 1, idx + context);
    }
  }
  ranges.push([start, end]);

  return ranges.map(([from, to]) => {
    const slice = rows.slice(from, to + 1);
    const aNumbers = slice.map((r) => r.aNumber).filter((n): n is number => n !== null);
    const bNumbers = slice.map((r) => r.bNumber).filter((n): n is number => n !== null);
    const aStart = aNumbers[0] ?? 0;
    const bStart = bNumbers[0] ?? 0;
    return {
      aStart,
      aCount: aNumbers.length,
      bStart,
      bCount: bNumbers.length,
      header: `@@ -${aStart},${aNumbers.length} +${bStart},${bNumbers.length} @@`,
      rows: slice,
      sideBySide: toSideBySide(slice),
    };
  });
}

/** Pairs deletions with insertions so both columns stay aligned. */
export function toSideBySide(rows: DiffRow[]): SideBySideRow[] {
  const out: SideBySideRow[] = [];
  let i = 0;
  while (i < rows.length) {
    const row = rows[i]!;
    if (row.type === 'equal') {
      out.push({
        left: { number: row.aNumber, text: row.text, type: 'equal' },
        right: { number: row.bNumber, text: row.text, type: 'equal' },
      });
      i += 1;
      continue;
    }
    const deletions: DiffRow[] = [];
    const insertions: DiffRow[] = [];
    while (i < rows.length && rows[i]!.type === 'delete') deletions.push(rows[i++]!);
    while (i < rows.length && rows[i]!.type === 'insert') insertions.push(rows[i++]!);
    const max = Math.max(deletions.length, insertions.length);
    for (let k = 0; k < max; k += 1) {
      const del = deletions[k];
      const ins = insertions[k];
      out.push({
        left: del
          ? { number: del.aNumber, text: del.text, type: 'delete' }
          : { number: null, text: '', type: 'empty' },
        right: ins
          ? { number: ins.bNumber, text: ins.text, type: 'insert' }
          : { number: null, text: '', type: 'empty' },
      });
    }
    if (max === 0) i += 1;
  }
  return out;
}

/** Change-bars view: full text with a marker column, calm by design. */
export interface ChangeBarLine {
  number: number | null;
  marker: '' | 'changed' | 'added' | 'removed';
  text: string;
  /** Description used for the accessible legend/announcement. */
  label: string;
}

export function toChangeBars(rows: DiffRow[]): ChangeBarLine[] {
  const out: ChangeBarLine[] = [];
  let i = 0;
  while (i < rows.length) {
    const row = rows[i]!;
    if (row.type === 'equal') {
      out.push({ number: row.bNumber, marker: '', text: row.text, label: 'unchanged' });
      i += 1;
      continue;
    }
    const deletions: DiffRow[] = [];
    const insertions: DiffRow[] = [];
    while (i < rows.length && rows[i]!.type === 'delete') deletions.push(rows[i++]!);
    while (i < rows.length && rows[i]!.type === 'insert') insertions.push(rows[i++]!);

    if (insertions.length && deletions.length) {
      for (const ins of insertions) {
        out.push({ number: ins.bNumber, marker: 'changed', text: ins.text, label: 'changed line' });
      }
    } else if (insertions.length) {
      for (const ins of insertions) {
        out.push({ number: ins.bNumber, marker: 'added', text: ins.text, label: 'added line' });
      }
    } else {
      for (const del of deletions) {
        out.push({ number: del.aNumber, marker: 'removed', text: del.text, label: 'removed line' });
      }
    }
  }
  return out;
}

export function isDiffView(value: string): value is DiffView {
  return ['side-by-side', 'before-after', 'change-bars', 'inline'].includes(value);
}

/** Unified-diff text, used by the API and for copy/paste. */
export function toUnifiedDiff(result: DiffResult, fromLabel: string, toLabel: string): string {
  const out: string[] = [`--- ${fromLabel}`, `+++ ${toLabel}`];
  for (const hunk of result.hunks) {
    out.push(hunk.header);
    for (const row of hunk.rows) {
      const prefix = row.type === 'insert' ? '+' : row.type === 'delete' ? '-' : ' ';
      out.push(prefix + row.text);
    }
  }
  return out.join('\n');
}
