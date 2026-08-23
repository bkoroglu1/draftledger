import { describe, expect, it } from 'vitest';
import { buildEncoding, pdfLiteral, pdfTextString } from '#src/render/encoding.ts';
import { renderPdf } from '#src/render/pdf.ts';

/**
 * The PDF writer used to fold every non-ASCII character to a question mark,
 * which made Turkish documents unreadable. These pin the encoding that replaced
 * that behaviour.
 */

describe('pdf encoding', () => {
  it('passes WinAnsi characters through without a Differences array', () => {
    const enc = buildEncoding(['A plain ASCII line with accents: café, naïve, Größe']);
    expect(enc.differences()).toBe('');
    expect(enc.unsupported).toEqual([]);
  });

  it('assigns codes and glyph names to the Turkish letters WinAnsi lacks', () => {
    const enc = buildEncoding(['doğrulama çalıştırılmalı İSTANBUL ĞŞ']);
    const diff = enc.differences();

    // The six Turkish-specific letters. ç is WinAnsi already and must not
    // consume a slot.
    for (const glyph of ['gbreve', 'Gbreve', 'scedilla', 'Scedilla', 'dotlessi', 'Idotaccent']) {
      expect(diff).toContain(`/${glyph}`);
    }
    expect(diff).not.toContain('/ccedilla');
    expect(enc.unsupported).toEqual([]);
  });

  it('escapes assigned codes as octal so the literal stays byte-safe', () => {
    const enc = buildEncoding(['ğ']);
    const literal = pdfLiteral('ağ', enc);
    expect(literal.startsWith('a')).toBe(true);
    expect(literal).toMatch(/\\\d{3}$/);
  });

  it('escapes PDF delimiters', () => {
    const enc = buildEncoding(['x']);
    expect(pdfLiteral('a(b)c\\d', enc)).toBe('a\\(b\\)c\\\\d');
  });

  it('reports a character it cannot render rather than silently dropping it', () => {
    const enc = buildEncoding(['一 kanji']);
    expect(enc.unsupported).toEqual(['一']);
    expect(pdfLiteral('一', enc)).toBe('?');
  });

  it('gives the same codes for the same source', () => {
    const a = buildEncoding(['ğşı']);
    const b = buildEncoding(['ğşı']);
    expect(a.differences()).toBe(b.differences());
  });

  it('writes Info strings as UTF-16 rather than through the font encoding', () => {
    // A title must not depend on which glyph codes the body happened to claim.
    expect(pdfTextString('Aı')).toBe('\\376\\377\\000\\101\\001\\061');
  });

  it('produces a document whose Differences array covers its own text', () => {
    const pdf = renderPdf({
      title: 'AWS Decommission Süreç Analizi',
      documentNumber: 'DRAFT-APILEX-DECOMMISSION',
      pages: [
        {
          number: 1,
          header: 'Apilex',
          footer: '[Page 1]',
          lines: ['alınmalıdır (MUST). Doğrulama komutları içindedir.'],
        },
      ],
    });
    const text = pdf.toString('latin1');
    expect(text).toContain('/BaseEncoding /WinAnsiEncoding');
    expect(text).toContain('/dotlessi');
    expect(text).toContain('/gbreve');
    // Nothing may fall back to a question mark for this text.
    expect(text).not.toMatch(/\(\?/);
  });
});
