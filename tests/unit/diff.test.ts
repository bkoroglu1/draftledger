import { describe, expect, it } from 'vitest';
import {
  diffLines,
  diffText,
  myersDiff,
  patienceDiff,
  toChangeBars,
  toSideBySide,
  toUnifiedDiff,
} from '#src/diff/index.ts';

const BEFORE = `line one
line two
line three
line four
line five`;

const AFTER = `line one
line two changed
line three
inserted line
line four
line five`;

describe('diff engine', () => {
  const result = diffText(BEFORE, AFTER);

  it('detects insertions and deletions', () => {
    expect(result.identical).toBe(false);
    expect(result.stats.added).toBe(2);
    expect(result.stats.removed).toBe(1);
  });

  it('reports identical inputs as identical', () => {
    expect(diffText(BEFORE, BEFORE).identical).toBe(true);
    expect(diffText(BEFORE, BEFORE).hunks).toHaveLength(0);
  });

  it('keeps whitespace significant by default', () => {
    const spaced = diffText('a  b', 'a b');
    expect(spaced.identical).toBe(false);
    const ignored = diffText('a  b', 'a b', { ignoreWhitespace: true });
    expect(ignored.identical).toBe(true);
  });

  it('aligns deletions with insertions in the side-by-side view', () => {
    const rows = toSideBySide(result.rows);
    const changed = rows.find((r) => r.left.type === 'delete');
    expect(changed?.right.type).toBe('insert');
    expect(changed?.left.text).toBe('line two');
    expect(changed?.right.text).toBe('line two changed');
  });

  it('marks changed, added and removed lines for the change-bars view', () => {
    const bars = toChangeBars(result.rows);
    expect(bars.some((b) => b.marker === 'changed')).toBe(true);
    expect(bars.some((b) => b.marker === 'added')).toBe(true);
    // Every marked line carries a textual label, so colour is never the only cue.
    for (const bar of bars.filter((b) => b.marker)) expect(bar.label).toBeTruthy();
  });

  it('produces a unified diff', () => {
    const unified = toUnifiedDiff(result, 'before', 'after');
    expect(unified).toContain('--- before');
    expect(unified).toContain('+line two changed');
    expect(unified).toContain('-line two');
  });

  it('handles empty inputs on either side', () => {
    expect(diffText('', 'a\nb').stats.added).toBe(2);
    expect(diffText('a\nb', '').stats.removed).toBe(2);
    expect(diffText('', '').identical).toBe(true);
  });

  it('agrees with plain Myers on small inputs', () => {
    const a = ['a', 'b', 'c', 'd'];
    const b = ['a', 'x', 'c', 'd', 'e'];
    const applyEdits = (edits: ReturnType<typeof myersDiff>) =>
      edits.filter((e) => e.type !== 'delete').map((e) => (e.type === 'equal' ? a[e.aIndex] : b[e.bIndex]));
    expect(applyEdits(myersDiff(a, b))).toEqual(b);
    expect(applyEdits(patienceDiff(a, b))).toEqual(b);
  });

  it('reconstructs the target from the edit script', () => {
    const before = BEFORE.split('\n');
    const after = AFTER.split('\n');
    const rebuilt = diffLines(before, after)
      .rows.filter((r) => r.type !== 'delete')
      .map((r) => r.text);
    expect(rebuilt).toEqual(after);
  });

  it('stays responsive on a large document', () => {
    const big = Array.from({ length: 4000 }, (_, i) => `line ${i}`);
    const modified = [...big];
    modified[2000] = 'line 2000 changed';
    modified.splice(3000, 0, 'brand new line');
    const started = Date.now();
    const large = diffLines(big, modified);
    expect(large.stats.added).toBe(2);
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
