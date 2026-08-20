import { myersDiff, type Edit } from './myers.ts';

/**
 * Patience diff: anchors on lines that occur exactly once in both sides, which
 * keeps technical documents (repeated blank lines, table borders, ASCII art)
 * from producing noisy alignments. Falls back to Myers inside each segment.
 */

const MYERS_SEGMENT_LIMIT = 4000;

export function patienceDiff(a: readonly string[], b: readonly string[]): Edit[] {
  const edits: Edit[] = [];
  diffRange(a, b, 0, a.length, 0, b.length, edits, 0);
  return edits;
}

function diffRange(
  a: readonly string[],
  b: readonly string[],
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
  out: Edit[],
  depth: number,
): void {
  // Trim common prefix/suffix first: cheap and improves anchor quality.
  while (aStart < aEnd && bStart < bEnd && a[aStart] === b[bStart]) {
    out.push({ type: 'equal', aIndex: aStart, bIndex: bStart });
    aStart += 1;
    bStart += 1;
  }
  const tail: Edit[] = [];
  while (aEnd > aStart && bEnd > bStart && a[aEnd - 1] === b[bEnd - 1]) {
    aEnd -= 1;
    bEnd -= 1;
    tail.push({ type: 'equal', aIndex: aEnd, bIndex: bEnd });
  }

  const aLen = aEnd - aStart;
  const bLen = bEnd - bStart;

  if (aLen === 0) {
    for (let i = bStart; i < bEnd; i += 1) out.push({ type: 'insert', aIndex: aStart, bIndex: i });
    out.push(...tail.reverse());
    return;
  }
  if (bLen === 0) {
    for (let i = aStart; i < aEnd; i += 1) out.push({ type: 'delete', aIndex: i, bIndex: bStart });
    out.push(...tail.reverse());
    return;
  }

  const anchors =
    depth > 12 || aLen + bLen < 8 ? [] : uniqueCommonAnchors(a, b, aStart, aEnd, bStart, bEnd);

  if (!anchors.length) {
    if (aLen + bLen > MYERS_SEGMENT_LIMIT * 2) {
      // Degenerate segment: emit as a plain replace rather than burning O(ND).
      for (let i = aStart; i < aEnd; i += 1) out.push({ type: 'delete', aIndex: i, bIndex: bStart });
      for (let i = bStart; i < bEnd; i += 1) out.push({ type: 'insert', aIndex: aEnd, bIndex: i });
    } else {
      for (const edit of myersDiff(a.slice(aStart, aEnd), b.slice(bStart, bEnd))) {
        out.push({
          type: edit.type,
          aIndex: edit.aIndex + aStart,
          bIndex: edit.bIndex + bStart,
        });
      }
    }
    out.push(...tail.reverse());
    return;
  }

  let aCursor = aStart;
  let bCursor = bStart;
  for (const [ai, bi] of anchors) {
    diffRange(a, b, aCursor, ai, bCursor, bi, out, depth + 1);
    out.push({ type: 'equal', aIndex: ai, bIndex: bi });
    aCursor = ai + 1;
    bCursor = bi + 1;
  }
  diffRange(a, b, aCursor, aEnd, bCursor, bEnd, out, depth + 1);
  out.push(...tail.reverse());
}

/** Lines occurring exactly once on each side, in longest increasing order. */
function uniqueCommonAnchors(
  a: readonly string[],
  b: readonly string[],
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): Array<[number, number]> {
  const aCounts = new Map<string, { count: number; index: number }>();
  for (let i = aStart; i < aEnd; i += 1) {
    const line = a[i]!;
    if (!line.trim()) continue;
    const entry = aCounts.get(line);
    if (entry) entry.count += 1;
    else aCounts.set(line, { count: 1, index: i });
  }
  const pairs: Array<[number, number]> = [];
  const bCounts = new Map<string, { count: number; index: number }>();
  for (let i = bStart; i < bEnd; i += 1) {
    const line = b[i]!;
    if (!line.trim()) continue;
    const entry = bCounts.get(line);
    if (entry) entry.count += 1;
    else bCounts.set(line, { count: 1, index: i });
  }
  for (const [line, aEntry] of aCounts) {
    if (aEntry.count !== 1) continue;
    const bEntry = bCounts.get(line);
    if (!bEntry || bEntry.count !== 1) continue;
    pairs.push([aEntry.index, bEntry.index]);
  }
  pairs.sort((x, y) => x[0] - y[0]);
  return longestIncreasingByB(pairs);
}

function longestIncreasingByB(pairs: Array<[number, number]>): Array<[number, number]> {
  if (pairs.length < 2) return pairs;
  const tailIdx: number[] = [];
  const prev = new Array<number>(pairs.length).fill(-1);

  for (let i = 0; i < pairs.length; i += 1) {
    const value = pairs[i]![1];
    let lo = 0;
    let hi = tailIdx.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pairs[tailIdx[mid]!]![1] < value) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tailIdx[lo - 1]!;
    tailIdx[lo] = i;
  }

  const out: Array<[number, number]> = [];
  let k = tailIdx.length ? tailIdx[tailIdx.length - 1]! : -1;
  while (k !== -1) {
    out.push(pairs[k]!);
    k = prev[k]!;
  }
  return out.reverse();
}
