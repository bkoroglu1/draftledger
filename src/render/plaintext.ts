import type { Block, Inline, ParsedDocument, SectionNode } from '#src/parser/index.ts';
import { flattenSections, inlineText } from '#src/parser/index.ts';

/**
 * Canonical plaintext layout engine.
 *
 * Produces a paginated, fixed-width rendering with running headers and
 * `[Page N]` footers, exactly like the classic RFC plaintext format. Everything
 * downstream (HTMLization, page anchors, PDF) is derived from this output, so
 * layout is deterministic for a given source and renderer version.
 */

export const PAGE_WIDTH = 72;
/** Text lines available between the running header and the page footer. */
export const BODY_LINES = 46;
const INDENT = '   ';

export interface PlaintextContext {
  /** Left column of the running header — publication series or organization. */
  headerLeft: string;
  /** Centre column — the abbreviated document title. */
  headerCenter: string;
  /** Right column — publication or revision date. */
  headerRight: string;
  /** Left column of the footer — author surnames. */
  footerLeft: string;
  /** Centre column — lifecycle/standard level. */
  footerCenter: string;
  /** Identity block printed on the first page. */
  documentNumber: string;
  documentType: string;
  organization: string;
  authors: Array<{ name: string; organization?: string }>;
  date: string;
  status: string;
  obsoletes?: string[];
  updates?: string[];
}

export interface PlaintextPage {
  number: number;
  /** Content lines only; header/footer are stored separately. */
  lines: string[];
  header: string;
  footer: string;
}

export interface AnchorPosition {
  page: number;
  lineInPage: number;
  globalLine: number;
}

export interface PlaintextRender {
  /** Full document with \f separators — the canonical `txt` artifact. */
  text: string;
  pages: PlaintextPage[];
  anchors: Record<string, AnchorPosition>;
  totalPages: number;
}

interface Emitted {
  text: string;
  /** Anchors that start at this line. */
  anchor?: string;
  /** A heading line must not be orphaned at the bottom of a page. */
  keepWithNext?: number;
}

export function renderPlaintext(doc: ParsedDocument, ctx: PlaintextContext): PlaintextRender {
  // Two passes: the first establishes page numbers, the second fills them into
  // the table of contents. Adding the numbers never changes the line count, so
  // the page assignment computed in pass one still holds.
  const first = build(doc, ctx, null);
  const pass1 = paginate(first, ctx);
  const second = build(doc, ctx, pass1.anchors);
  return paginate(second, ctx);
}

function build(
  doc: ParsedDocument,
  ctx: PlaintextContext,
  anchors: Record<string, AnchorPosition> | null,
): Emitted[] {
  const out: Emitted[] = [];
  emitFrontPage(out, doc, ctx, anchors);
  emitSections(out, doc.sections, doc);
  emitAuthorsBlock(out, ctx);
  return out;
}

/* -------------------------------------------------------------------------- */
/* Front matter                                                                */
/* -------------------------------------------------------------------------- */

function emitFrontPage(
  out: Emitted[],
  doc: ParsedDocument,
  ctx: PlaintextContext,
  anchors: Record<string, AnchorPosition> | null,
): void {
  const left: string[] = [];
  const right: string[] = [];

  left.push(ctx.organization);
  left.push(`${ctx.documentType}: ${ctx.documentNumber}`);
  if (ctx.obsoletes?.length) left.push(`Obsoletes: ${ctx.obsoletes.join(', ')}`);
  if (ctx.updates?.length) left.push(`Updates: ${ctx.updates.join(', ')}`);
  left.push(`Category: ${ctx.status}`);

  for (const a of ctx.authors) {
    right.push(a.name);
    if (a.organization) right.push(a.organization);
  }
  right.push(ctx.date);

  const rows = Math.max(left.length, right.length);
  for (let i = 0; i < rows; i += 1) {
    out.push({ text: twoColumn(left[i] ?? '', right[i] ?? '') });
  }

  out.push({ text: '' });
  out.push({ text: '' });
  for (const line of centerBlock(doc.meta.title)) out.push({ text: line });
  out.push({ text: '' });

  if (doc.abstract.length) {
    out.push({ text: 'Abstract', anchor: 'section-abstract', keepWithNext: 2 });
    out.push({ text: '' });
    emitBlocks(out, doc.abstract, INDENT);
    out.push({ text: '' });
  }

  emitStatusOfThisMemo(out, ctx);
  emitTableOfContents(out, doc, anchors);
}

function emitStatusOfThisMemo(out: Emitted[], ctx: PlaintextContext): void {
  out.push({ text: 'Status of This Document', anchor: 'section-status', keepWithNext: 2 });
  out.push({ text: '' });
  const body =
    `This document is a ${ctx.documentType.toLowerCase()} of ${ctx.organization}. ` +
    `It is published in the ${ctx.headerLeft} series with the identifier ${ctx.documentNumber} ` +
    `and carries the status ${ctx.status}. Distribution of this document follows the ` +
    `publication policy configured for its namespace.`;
  for (const line of wrap(body, PAGE_WIDTH - INDENT.length)) out.push({ text: INDENT + line });
  out.push({ text: '' });
}

function emitTableOfContents(
  out: Emitted[],
  doc: ParsedDocument,
  anchors: Record<string, AnchorPosition> | null,
): void {
  const all = flattenSections(doc.sections);
  if (!all.length) return;
  out.push({ text: 'Table of Contents', anchor: 'section-toc', keepWithNext: 3 });
  out.push({ text: '' });
  for (const s of all) {
    if (s.depth > 3) continue;
    const indent = INDENT + '  '.repeat(s.depth - 1);
    const label = s.number
      ? `${s.isAppendix ? 'Appendix ' : ''}${s.number}. ${s.title}`
      : s.title;
    // Pass one reserves the leader width so pagination does not shift later.
    const page = anchors?.[s.anchor]?.page;
    const pageText = page === undefined ? '' : String(page);
    const left = `${indent}${label} `;
    const dots = Math.max(1, PAGE_WIDTH - left.length - pageText.length - 1);
    out.push({ text: `${left}${'.'.repeat(dots)} ${pageText}`.trimEnd() });
  }
  out.push({ text: '' });
}

function emitAuthorsBlock(out: Emitted[], ctx: PlaintextContext): void {
  out.push({ text: '' });
  out.push({ text: "Authors' Addresses", anchor: 'section-authors', keepWithNext: 2 });
  out.push({ text: '' });
  for (const a of ctx.authors) {
    out.push({ text: INDENT + a.name });
    if (a.organization) out.push({ text: INDENT + a.organization });
    out.push({ text: '' });
  }
}

/* -------------------------------------------------------------------------- */
/* Body                                                                        */
/* -------------------------------------------------------------------------- */

function emitSections(out: Emitted[], sections: SectionNode[], doc: ParsedDocument): void {
  const referenceByKey = new Map(doc.references.map((r) => [r.key, r] as const));
  for (const s of flattenSections(sections)) {
    out.push({ text: '' });
    const label = s.number
      ? `${s.isAppendix ? 'Appendix ' : ''}${s.number}.  ${s.title}`
      : s.title;
    out.push({ text: label, anchor: s.anchor, keepWithNext: 2 });
    out.push({ text: '' });
    const before = out.length;
    emitBlocks(out, s.blocks, INDENT);
    if (/references$/i.test(s.title)) tagReferenceAnchors(out, before, referenceByKey);
  }
}

/** Attaches ref-* anchors to the first line of each bibliographic entry. */
function tagReferenceAnchors(
  out: Emitted[],
  from: number,
  references: Map<string, { anchor: string }>,
): void {
  for (let i = from; i < out.length; i += 1) {
    const line = out[i]!;
    const m = /^\s*\[([A-Za-z][A-Za-z0-9._-]*)\]/.exec(line.text);
    if (!m) continue;
    const ref = references.get(m[1]!);
    if (ref && !line.anchor) out[i] = { ...line, anchor: ref.anchor };
  }
}

function emitBlocks(out: Emitted[], blocks: Block[], indent: string): void {
  for (const block of blocks) {
    switch (block.kind) {
      case 'paragraph': {
        for (const line of wrap(inlineText(block.inlines), PAGE_WIDTH - indent.length)) {
          out.push({ text: indent + line });
        }
        out.push({ text: '' });
        break;
      }
      case 'artwork': {
        // Never reflowed: ABNF, ASN.1, hex dumps and ASCII diagrams stay byte-exact.
        if (block.name) {
          out.push({ text: indent + block.name });
          out.push({ text: '' });
        }
        for (const line of block.text.split('\n')) out.push({ text: line ? indent + line : '' });
        out.push({ text: '' });
        break;
      }
      case 'list': {
        block.items.forEach((item, idx) => {
          const marker = block.ordered ? `${(block.start ?? 1) + idx}.`.padEnd(3) : 'o  ';
          emitListItem(out, item, indent, marker);
        });
        break;
      }
      case 'deflist': {
        for (const item of block.items) {
          out.push({ text: indent + item.term });
          emitBlocks(out, item.blocks, indent + '   ');
        }
        break;
      }
      case 'table': {
        emitTable(out, block, indent);
        break;
      }
      case 'note': {
        out.push({ text: `${indent}${block.label}:` });
        emitBlocks(out, block.blocks, indent + '   ');
        break;
      }
      case 'blockquote': {
        emitBlocks(out, block.blocks, indent + '   ');
        break;
      }
    }
  }
}

function emitListItem(out: Emitted[], item: Block[], indent: string, marker: string): void {
  const inner = indent + ' '.repeat(marker.length);
  const buffer: Emitted[] = [];
  emitBlocks(buffer, item, inner);
  while (buffer.length && !buffer[buffer.length - 1]!.text.trim()) buffer.pop();
  if (!buffer.length) return;
  const first = buffer[0]!;
  buffer[0] = { ...first, text: indent + marker + first.text.slice(inner.length) };
  out.push(...buffer);
  out.push({ text: '' });
}

function emitTable(
  out: Emitted[],
  block: Extract<Block, { kind: 'table' }>,
  indent: string,
): void {
  const head = block.head.map((c) => inlineText(c));
  const rows = block.rows.map((r) => r.map((c) => inlineText(c)));
  const colCount = Math.max(head.length, ...rows.map((r) => r.length), 1);
  const widths: number[] = [];
  for (let c = 0; c < colCount; c += 1) {
    widths[c] = Math.max(
      (head[c] ?? '').length,
      ...rows.map((r) => (r[c] ?? '').length),
      3,
    );
  }
  const border = `+${widths.map((w) => '-'.repeat(w + 2)).join('+')}+`;
  const line = (cells: string[]) =>
    `|${widths.map((w, c) => ` ${pad(cells[c] ?? '', w, block.align[c] ?? 'left')} `).join('|')}|`;

  if (block.caption) {
    out.push({ text: indent + block.caption });
    out.push({ text: '' });
  }
  out.push({ text: indent + border });
  if (head.length) {
    out.push({ text: indent + line(head) });
    out.push({ text: indent + border });
  }
  for (const r of rows) out.push({ text: indent + line(r) });
  out.push({ text: indent + border });
  out.push({ text: '' });
}

/* -------------------------------------------------------------------------- */
/* Pagination                                                                  */
/* -------------------------------------------------------------------------- */

function paginate(lines: Emitted[], ctx: PlaintextContext): PlaintextRender {
  const pages: PlaintextPage[] = [];
  const anchors: Record<string, AnchorPosition> = {};

  let current: Emitted[] = [];
  let pageNumber = 1;
  let globalLine = 0;

  const flush = () => {
    while (current.length && !current[current.length - 1]!.text.trim()) current.pop();
    const header = runningHeader(ctx, pageNumber);
    const footer = runningFooter(ctx, pageNumber);
    pages.push({
      number: pageNumber,
      lines: current.map((l) => l.text),
      header,
      footer,
    });
    current = [];
    pageNumber += 1;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;

    // Widow control: never leave a heading alone at the foot of a page.
    const needed = 1 + (line.keepWithNext ?? 0);
    if (current.length > 0 && current.length + needed > BODY_LINES) {
      flush();
      if (!line.text.trim()) continue;
    }

    if (line.anchor) {
      anchors[line.anchor] = {
        page: pageNumber,
        lineInPage: current.length,
        globalLine,
      };
    }
    current.push(line);
    globalLine += 1;

    if (current.length >= BODY_LINES) flush();
  }
  if (current.length) flush();
  if (!pages.length) flush();

  for (const page of pages) anchors[`page-${page.number}`] = {
    page: page.number,
    lineInPage: 0,
    globalLine: 0,
  };

  const total = pages.length;
  const text = pages
    .map((p) => {
      const body = [...p.lines];
      while (body.length < BODY_LINES) body.push('');
      const footer = p.footer.replace('[Page]', `[Page ${p.number}]`);
      return [p.header, '', ...body, '', footer].join('\n');
    })
    .join('\n\f\n');

  return { text: `${text}\n`, pages, anchors, totalPages: total };
}

function runningHeader(ctx: PlaintextContext, page: number): string {
  // The first page carries the identity block instead of a running header.
  if (page === 1) return '';
  return threeColumn(ctx.headerLeft, ctx.headerCenter, ctx.headerRight);
}

function runningFooter(ctx: PlaintextContext, page: number): string {
  return threeColumn(ctx.footerLeft, ctx.footerCenter, `[Page ${page}]`);
}

/* -------------------------------------------------------------------------- */
/* Text utilities                                                              */
/* -------------------------------------------------------------------------- */

export function wrap(text: string, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (!line) {
      line = word;
    } else if (line.length + 1 + word.length <= width) {
      line += ` ${word}`;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function pad(text: string, width: number, align: 'left' | 'center' | 'right'): string {
  const diff = Math.max(0, width - text.length);
  if (align === 'right') return ' '.repeat(diff) + text;
  if (align === 'center') {
    const l = Math.floor(diff / 2);
    return ' '.repeat(l) + text + ' '.repeat(diff - l);
  }
  return text + ' '.repeat(diff);
}

function twoColumn(left: string, right: string): string {
  const space = Math.max(1, PAGE_WIDTH - left.length - right.length);
  return (left + ' '.repeat(space) + right).slice(0, Math.max(PAGE_WIDTH, left.length + right.length + 1));
}

function threeColumn(left: string, center: string, right: string): string {
  const l = left.slice(0, 24);
  const r = right.slice(0, 24);
  const availableCenter = PAGE_WIDTH - l.length - r.length;
  const c = center.slice(0, Math.max(0, availableCenter - 2));
  const totalGap = PAGE_WIDTH - l.length - c.length - r.length;
  const leftGap = Math.max(1, Math.floor(totalGap / 2));
  const rightGap = Math.max(1, totalGap - leftGap);
  return l + ' '.repeat(leftGap) + c + ' '.repeat(rightGap) + r;
}

function centerBlock(text: string): string[] {
  return wrap(text, PAGE_WIDTH - 8).map((line) => {
    const padLeft = Math.max(0, Math.floor((PAGE_WIDTH - line.length) / 2));
    return ' '.repeat(padLeft) + line;
  });
}

/** Convenience for callers that need the flat list of section anchors. */
export function sectionPageMap(
  doc: ParsedDocument,
  render: PlaintextRender,
): Record<string, number> {
  const map: Record<string, number> = {};
  for (const s of flattenSections(doc.sections)) {
    map[s.anchor] = render.anchors[s.anchor]?.page ?? 1;
  }
  return map;
}

export function inlinePlain(inlines: Inline[]): string {
  return inlineText(inlines);
}
