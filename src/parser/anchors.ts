/**
 * Deterministic anchor generation. The same source must always produce the same
 * anchor map: reader deep links, review thread anchors and stored section rows
 * all depend on it.
 */

/**
 * Latin letters that NFKD does not decompose into ASCII plus a combining mark.
 * Without this table Turkish, Nordic and Slavic titles lose characters instead
 * of transliterating them, which would silently mangle anchors.
 */
const TRANSLITERATIONS: Record<string, string> = {
  ı: 'i', İ: 'i', ğ: 'g', Ğ: 'g', ş: 's', Ş: 's',
  ø: 'o', Ø: 'o', æ: 'ae', Æ: 'ae', œ: 'oe', Œ: 'oe',
  ð: 'd', Ð: 'd', þ: 'th', Þ: 'th', ß: 'ss',
  ł: 'l', Ł: 'l', đ: 'd', Đ: 'd', ħ: 'h', ŧ: 't',
};

export function slugify(input: string): string {
  return input
    .replace(/[^\x00-\x7f]/g, (ch) => TRANSLITERATIONS[ch] ?? ch)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function sectionAnchor(number: string | null, title: string, isAppendix: boolean): string {
  if (number) {
    return isAppendix ? `appendix-${number.toLowerCase()}` : `section-${number}`;
  }
  const slug = slugify(title);
  return slug ? `sec-${slug}` : 'sec-unnamed';
}

export function referenceAnchor(key: string): string {
  return `ref-${slugify(key) || 'unnamed'}`;
}

export function pageAnchor(page: number): string {
  return `page-${page}`;
}

/** Appends -2, -3 … to keep anchors unique while staying deterministic. */
export function dedupeAnchor(anchor: string, seen: Set<string>): string {
  if (!seen.has(anchor)) {
    seen.add(anchor);
    return anchor;
  }
  let n = 2;
  while (seen.has(`${anchor}-${n}`)) n += 1;
  const unique = `${anchor}-${n}`;
  seen.add(unique);
  return unique;
}

/** Converts a 1-based index into A, B … Z, AA, AB … for appendix numbering. */
export function appendixLetter(index: number): string {
  let n = index;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}
