/**
 * Minimal, dependency-free PDF writer for the paginated plaintext rendering.
 *
 * Uses the base-14 Courier font so no font file has to be embedded and the
 * output stays byte-deterministic for a given source (no timestamps, no ids).
 * Characters WinAnsi cannot express are carried by a /Differences encoding
 * built from the document's own text, so Turkish and the rest of Latin
 * Extended-A render without embedding anything. See encoding.ts.
 */

import { buildEncoding, pdfLiteral, pdfTextString, type PdfEncoding } from './encoding.ts';
import type { PlaintextPage } from './plaintext.ts';

const PAGE_W = 612; // US Letter, points
const PAGE_H = 792;
const MARGIN_X = 72;
const MARGIN_TOP = 60;
const FONT_SIZE = 9;
const LINE_HEIGHT = 11.4;

export interface PdfInput {
  title: string;
  documentNumber: string;
  pages: PlaintextPage[];
}

export function renderPdf(input: PdfInput): Buffer {
  const encoding = buildEncoding([
    input.title,
    input.documentNumber,
    ...input.pages.flatMap((p) => [p.header, p.footer, ...p.lines]),
  ]);
  const objects: string[] = [];
  const contentIds: number[] = [];

  // 1 catalog, 2 pages, 3 font; page objects and contents follow.
  const firstPageId = 4;
  const pageCount = Math.max(1, input.pages.length);
  const pageIds: number[] = [];
  for (let i = 0; i < pageCount; i += 1) {
    pageIds.push(firstPageId + i * 2);
    contentIds.push(firstPageId + i * 2 + 1);
  }

  objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objects[2] =
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageCount} >>`;
  const differences = encoding.differences();
  objects[3] = differences
    ? `<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding ` +
      `<< /Type /Encoding /BaseEncoding /WinAnsiEncoding ${differences} >> >>`
    : `<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>`;

  input.pages.forEach((page, index) => {
    const lines = [page.header, '', ...page.lines];
    const stream = buildContentStream(lines, page.footer, encoding);
    const pageId = pageIds[index]!;
    const contentId = contentIds[index]!;
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${byteLength(stream)} >>\nstream\n${stream}\nendstream`;
  });

  if (!input.pages.length) {
    const stream = buildContentStream([input.title], '[Page 1]', encoding);
    objects[firstPageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${firstPageId + 1} 0 R >>`;
    objects[firstPageId + 1] = `<< /Length ${byteLength(stream)} >>\nstream\n${stream}\nendstream`;
  }

  const header = `%PDF-1.4\n%âãÏÓ\n`;
  let body = '';
  const offsets: number[] = [];
  let offset = byteLength(header);

  for (let id = 1; id < objects.length; id += 1) {
    const obj = objects[id];
    if (!obj) continue;
    offsets[id] = offset;
    const chunk = `${id} 0 obj\n${obj}\nendobj\n`;
    body += chunk;
    offset += byteLength(chunk);
  }

  const maxId = objects.length;
  let xref = `xref\n0 ${maxId}\n0000000000 65535 f \n`;
  for (let id = 1; id < maxId; id += 1) {
    const off = offsets[id];
    xref += off === undefined ? `0000000000 65535 f \n` : `${String(off).padStart(10, '0')} 00000 n \n`;
  }

  const trailer =
    `trailer\n<< /Size ${maxId} /Root 1 0 R /Info << /Title (${pdfTextString(input.title)}) ` +
    `/Subject (${pdfTextString(input.documentNumber)}) /Producer (DraftLedger) >> >>\n` +
    `startxref\n${offset}\n%%EOF\n`;

  return Buffer.from(header + body + xref + trailer, 'latin1');
}

function buildContentStream(lines: string[], footer: string, encoding: PdfEncoding): string {
  const parts: string[] = ['BT', `/F1 ${FONT_SIZE} Tf`, `${LINE_HEIGHT} TL`, `1 0 0 1 ${MARGIN_X} ${PAGE_H - MARGIN_TOP} Tm`];
  for (const line of lines) {
    parts.push(`(${pdfLiteral(line, encoding)}) Tj`, 'T*');
  }
  parts.push('ET');
  parts.push('BT', `/F1 ${FONT_SIZE} Tf`, `1 0 0 1 ${MARGIN_X} ${MARGIN_TOP - 20} Tm`, `(${pdfLiteral(footer, encoding)}) Tj`, 'ET');
  return parts.join('\n');
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, 'latin1');
}
