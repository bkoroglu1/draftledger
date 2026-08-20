/**
 * Myers O(ND) line diff with backtracking. Operates on hashed lines so the
 * comparison cost does not depend on line length.
 */

export type EditType = 'equal' | 'insert' | 'delete';

export interface Edit {
  type: EditType;
  /** Index into the "before" array (delete/equal). */
  aIndex: number;
  /** Index into the "after" array (insert/equal). */
  bIndex: number;
}

export function myersDiff(a: readonly string[], b: readonly string[]): Edit[] {
  const n = a.length;
  const m = b.length;

  if (n === 0 && m === 0) return [];
  if (n === 0) return b.map((_, i) => ({ type: 'insert' as const, aIndex: 0, bIndex: i }));
  if (m === 0) return a.map((_, i) => ({ type: 'delete' as const, aIndex: i, bIndex: 0 }));

  const max = n + m;
  const offset = max;
  const v = new Int32Array(2 * max + 1);
  const trace: Int32Array[] = [];

  let d = 0;
  outer: for (; d <= max; d += 1) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && (v[offset + k - 1] ?? 0) < (v[offset + k + 1] ?? 0))) {
        x = v[offset + k + 1] ?? 0;
      } else {
        x = (v[offset + k - 1] ?? 0) + 1;
      }
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) break outer;
    }
  }

  // Walk the trace backwards to recover the edit script.
  const edits: Edit[] = [];
  let x = n;
  let y = m;
  for (let step = Math.min(d, trace.length - 1); step >= 0; step -= 1) {
    const vPrev = trace[step]!;
    const k = x - y;
    let prevK: number;
    if (k === -step || (k !== step && (vPrev[offset + k - 1] ?? 0) < (vPrev[offset + k + 1] ?? 0))) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }
    const prevX = vPrev[offset + prevK] ?? 0;
    const prevY = prevX - prevK;

    while (x > prevX && y > prevY) {
      x -= 1;
      y -= 1;
      edits.push({ type: 'equal', aIndex: x, bIndex: y });
    }
    if (step === 0) break;
    if (x === prevX) {
      y -= 1;
      edits.push({ type: 'insert', aIndex: x, bIndex: y });
    } else {
      x -= 1;
      edits.push({ type: 'delete', aIndex: x, bIndex: y });
    }
  }

  return edits.reverse();
}
