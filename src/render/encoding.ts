/**
 * Single-byte text encoding for the PDF writer.
 *
 * The writer uses the base-14 Courier so no font file has to be embedded. That
 * font is declared with WinAnsi, which covers Western Europe but not Turkish,
 * Polish, Czech, Hungarian and the rest of Latin Extended-A. Rather than fold
 * those letters to a question mark, a character WinAnsi cannot express is given
 * one of the encoding's unused codes and named in a /Differences array.
 *
 * This works because no viewer ships Adobe's original Courier. Every one of
 * them substitutes a real system monospace font, and naming a glyph is enough
 * for the substitute to supply it. Verified against both the macOS PDF engine
 * and Chromium.
 *
 * The ceiling is real: a single-byte encoding has 256 slots, so a document is
 * limited to the free codes below. That is ample for any one European language
 * and cannot express a non-Latin script, which would need an embedded font.
 */

/** CP1252 occupies 0x80-0x9F with characters Latin-1 leaves as controls. */
const CP1252_HIGH = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';

/** Codes WinAnsi leaves undefined, plus the control range no text of ours uses. */
const FREE_CODES: readonly number[] = [
  ...Array.from({ length: 31 }, (_, i) => i + 1),
  127,
  129,
  141,
  143,
  144,
  157,
];

function buildWinAnsi(): Map<string, number> {
  const map = new Map<string, number>();
  for (let c = 0x20; c <= 0x7e; c += 1) map.set(String.fromCharCode(c), c);
  for (let c = 0xa0; c <= 0xff; c += 1) map.set(String.fromCharCode(c), c);
  [...CP1252_HIGH].forEach((ch, i) => {
    const code = 0x80 + i;
    // The undefined slots are placeholders in the string above; skip them.
    if (ch.charCodeAt(0) !== code || code === 0xa0) map.set(ch, code);
  });
  return map;
}

const WINANSI = buildWinAnsi();

/**
 * Adobe glyph names for Latin Extended-A, the block that carries the European
 * letters WinAnsi omits. Names come from the Adobe Glyph List, which is what a
 * substituted font resolves /Differences entries against.
 */
export const EXTRA_GLYPHS: Readonly<Record<string, string>> = {
  Ā: 'Amacron', ā: 'amacron', Ă: 'Abreve', ă: 'abreve', Ą: 'Aogonek', ą: 'aogonek',
  Ć: 'Cacute', ć: 'cacute', Ĉ: 'Ccircumflex', ĉ: 'ccircumflex',
  Ċ: 'Cdotaccent', ċ: 'cdotaccent', Č: 'Ccaron', č: 'ccaron',
  Ď: 'Dcaron', ď: 'dcaron', Đ: 'Dcroat', đ: 'dcroat',
  Ē: 'Emacron', ē: 'emacron', Ĕ: 'Ebreve', ĕ: 'ebreve',
  Ė: 'Edotaccent', ė: 'edotaccent', Ę: 'Eogonek', ę: 'eogonek',
  Ě: 'Ecaron', ě: 'ecaron',
  Ĝ: 'Gcircumflex', ĝ: 'gcircumflex', Ğ: 'Gbreve', ğ: 'gbreve',
  Ġ: 'Gdotaccent', ġ: 'gdotaccent', Ģ: 'Gcommaaccent', ģ: 'gcommaaccent',
  Ĥ: 'Hcircumflex', ĥ: 'hcircumflex', Ħ: 'Hbar', ħ: 'hbar',
  Ĩ: 'Itilde', ĩ: 'itilde', Ī: 'Imacron', ī: 'imacron',
  Ĭ: 'Ibreve', ĭ: 'ibreve', Į: 'Iogonek', į: 'iogonek',
  İ: 'Idotaccent', ı: 'dotlessi', Ĳ: 'IJ', ĳ: 'ij',
  Ĵ: 'Jcircumflex', ĵ: 'jcircumflex', Ķ: 'Kcommaaccent', ķ: 'kcommaaccent',
  ĸ: 'kgreenlandic',
  Ĺ: 'Lacute', ĺ: 'lacute', Ļ: 'Lcommaaccent', ļ: 'lcommaaccent',
  Ľ: 'Lcaron', ľ: 'lcaron', Ŀ: 'Ldot', ŀ: 'ldot', Ł: 'Lslash', ł: 'lslash',
  Ń: 'Nacute', ń: 'nacute', Ņ: 'Ncommaaccent', ņ: 'ncommaaccent',
  Ň: 'Ncaron', ň: 'ncaron', ŉ: 'napostrophe', Ŋ: 'Eng', ŋ: 'eng',
  Ō: 'Omacron', ō: 'omacron', Ŏ: 'Obreve', ŏ: 'obreve',
  Ő: 'Ohungarumlaut', ő: 'ohungarumlaut',
  Ŕ: 'Racute', ŕ: 'racute', Ŗ: 'Rcommaaccent', ŗ: 'rcommaaccent',
  Ř: 'Rcaron', ř: 'rcaron',
  Ś: 'Sacute', ś: 'sacute', Ŝ: 'Scircumflex', ŝ: 'scircumflex',
  Ş: 'Scedilla', ş: 'scedilla',
  Ţ: 'Tcommaaccent', ţ: 'tcommaaccent', Ť: 'Tcaron', ť: 'tcaron',
  Ŧ: 'Tbar', ŧ: 'tbar',
  Ũ: 'Utilde', ũ: 'utilde', Ū: 'Umacron', ū: 'umacron',
  Ŭ: 'Ubreve', ŭ: 'ubreve', Ů: 'Uring', ů: 'uring',
  Ű: 'Uhungarumlaut', ű: 'uhungarumlaut', Ų: 'Uogonek', ų: 'uogonek',
  Ŵ: 'Wcircumflex', ŵ: 'wcircumflex', Ŷ: 'Ycircumflex', ŷ: 'ycircumflex',
  Ź: 'Zacute', ź: 'zacute', Ż: 'Zdotaccent', ż: 'zdotaccent',
};

export interface PdfEncoding {
  /** Maps a character to the byte that renders it, or undefined if it cannot. */
  byteFor(ch: string): number | undefined;
  /** The /Differences array body, empty when the text is pure WinAnsi. */
  differences(): string;
  /** Characters no glyph could be found for, in first-appearance order. */
  readonly unsupported: readonly string[];
}

/**
 * Assigns codes to the non-WinAnsi characters a document actually uses. Codes
 * go out in first-appearance order, so the same source always produces the same
 * bytes and the writer stays deterministic.
 */
export function buildEncoding(texts: readonly string[]): PdfEncoding {
  const assigned = new Map<string, number>();
  const order: Array<{ code: number; glyph: string }> = [];
  const unsupported: string[] = [];
  const seenUnsupported = new Set<string>();
  let next = 0;

  for (const text of texts) {
    for (const ch of text) {
      if (WINANSI.has(ch) || assigned.has(ch)) continue;
      const glyph = EXTRA_GLYPHS[ch];
      if (!glyph || next >= FREE_CODES.length) {
        if (!seenUnsupported.has(ch)) {
          seenUnsupported.add(ch);
          unsupported.push(ch);
        }
        continue;
      }
      const code = FREE_CODES[next]!;
      next += 1;
      assigned.set(ch, code);
      order.push({ code, glyph });
    }
  }

  return {
    byteFor: (ch) => WINANSI.get(ch) ?? assigned.get(ch),
    differences: () =>
      order.length
        ? `/Differences [${order.map((e) => `${e.code} /${e.glyph}`).join(' ')}]`
        : '',
    unsupported,
  };
}

/** Escapes a string as a PDF literal in the given single-byte encoding. */
export function pdfLiteral(text: string, encoding: PdfEncoding): string {
  let out = '';
  for (const ch of text) {
    const code = encoding.byteFor(ch);
    if (code === undefined) {
      out += '?';
      continue;
    }
    if (ch === '\\' || ch === '(' || ch === ')') out += `\\${ch}`;
    else if (code < 0x20 || code > 0x7e) out += `\\${code.toString(8).padStart(3, '0')}`;
    else out += ch;
  }
  return out;
}

/**
 * Info dictionary strings are read as PDFDocEncoding or as UTF-16, never
 * through the font's encoding, so a title carries its own Unicode form.
 */
export function pdfTextString(text: string): string {
  let out = '\\376\\377';
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    const units = cp > 0xffff
      ? [0xd800 + ((cp - 0x10000) >> 10), 0xdc00 + ((cp - 0x10000) & 0x3ff)]
      : [cp];
    for (const u of units) {
      out += `\\${((u >> 8) & 0xff).toString(8).padStart(3, '0')}`;
      out += `\\${(u & 0xff).toString(8).padStart(3, '0')}`;
    }
  }
  return out;
}
