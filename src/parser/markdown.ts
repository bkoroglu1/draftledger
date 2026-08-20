import { appendixLetter, dedupeAnchor, referenceAnchor, sectionAnchor } from './anchors.ts';
import { parseInlines } from './inline.ts';
import type {
  Block,
  Diagnostic,
  Inline,
  ParsedDocument,
  ReferenceEntry,
  SectionNode,
} from './model.ts';
import { blockText, flattenSections, inlineText } from './model.ts';

/**
 * RFC-flavoured Markdown front-end.
 *
 * Supported: front matter, ATX headings with `{#anchor}` / `{-}` modifiers,
 * fenced artwork, `:::note` callouts, pipe tables, ordered/bullet lists with
 * nesting, definition lists, block quotes and reference sections.
 */

const FENCE_RE = /^(```|~~~)\s*(.*)$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const TABLE_DELIM_RE = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;
const REFERENCE_RE = /^\s*\[([A-Za-z][A-Za-z0-9._-]*)\]\s+(.*)$/;

interface RawHeading {
  level: number;
  title: string;
  explicitAnchor?: string;
  unnumbered: boolean;
  line: number;
}

interface Chunk {
  heading?: RawHeading;
  blocks: Block[];
  start: number;
  end: number;
}

export function parseMarkdown(source: string): ParsedDocument {
  const diagnostics: Diagnostic[] = [];
  const lines = source.replace(/\r\n?/g, '\n').split('\n');

  const { meta, bodyStart } = parseFrontMatter(lines, diagnostics);
  const chunks = splitIntoChunks(lines, bodyStart, diagnostics);

  // The preamble (content before the first heading) is only allowed to be empty.
  const preamble = chunks[0]?.heading ? null : chunks.shift() ?? null;
  if (preamble && blockText(preamble.blocks).trim()) {
    diagnostics.push({
      severity: 'warning',
      code: 'content-before-first-heading',
      message: 'Text appears before the first heading and will not belong to any section.',
      line: preamble.start,
      hint: 'Move it into the front-matter abstract or under a heading.',
    });
  }

  let abstractBlocks: Block[] = [];
  const structural: Chunk[] = [];
  for (const chunk of chunks) {
    const title = chunk.heading?.title ?? '';
    if (chunk.heading?.level === 1 && /^abstract$/i.test(title) && structural.length === 0) {
      abstractBlocks = chunk.blocks;
      continue;
    }
    structural.push(chunk);
  }

  const sections = buildTree(structural, diagnostics);
  const references = collectReferences(sections, diagnostics);

  if (!abstractBlocks.length && meta.abstract) {
    abstractBlocks = [{ kind: 'paragraph', inlines: parseInlines(meta.abstract) }];
  }

  const anchorIndex: ParsedDocument['anchorIndex'] = {};
  for (const s of flattenSections(sections)) {
    anchorIndex[s.anchor] = { number: s.number, title: s.title, depth: s.depth };
  }
  for (const r of references) {
    anchorIndex[r.anchor] = { number: null, title: r.key, depth: 3 };
  }

  resolveXrefLabels(sections, anchorIndex);
  validateCrossReferences(sections, anchorIndex, references, diagnostics);

  const title = meta.title || sections[0]?.title || 'Untitled document';
  const bodyWords = `${blockText(abstractBlocks)}\n${sections
    .map((s) => sectionWords(s))
    .join('\n')}`;

  return {
    meta: {
      title,
      abstract: blockText(abstractBlocks).trim() || null,
      keywords: (meta.keywords ?? '')
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean),
      raw: meta,
    },
    abstract: abstractBlocks,
    sections,
    references,
    diagnostics,
    anchorIndex,
    wordCount: bodyWords.split(/\s+/).filter(Boolean).length,
  };
}

function sectionWords(s: SectionNode): string {
  return [s.title, blockText(s.blocks), ...s.children.map(sectionWords)].join('\n');
}

/* -------------------------------------------------------------------------- */
/* Front matter                                                                */
/* -------------------------------------------------------------------------- */

function parseFrontMatter(
  lines: string[],
  diagnostics: Diagnostic[],
): { meta: Record<string, string>; bodyStart: number } {
  const meta: Record<string, string> = {};
  if (lines[0]?.trim() !== '---') return { meta, bodyStart: 0 };

  let i = 1;
  let key: string | null = null;
  const buffer: string[] = [];

  const commit = () => {
    if (key) meta[key] = buffer.join('\n').trim();
    key = null;
    buffer.length = 0;
  };

  while (i < lines.length && lines[i]?.trim() !== '---') {
    const line = lines[i]!;
    const m = /^([A-Za-z][A-Za-z0-9_-]*):\s?(.*)$/.exec(line);
    if (m && !line.startsWith(' ')) {
      commit();
      key = m[1]!;
      const value = (m[2] ?? '').trim();
      if (value && value !== '|' && value !== '>') buffer.push(stripQuotes(value));
    } else if (key) {
      buffer.push(line.replace(/^\s{0,4}/, ''));
    }
    i += 1;
  }
  commit();

  if (i >= lines.length) {
    diagnostics.push({
      severity: 'error',
      code: 'unterminated-front-matter',
      message: 'Front matter block was opened with --- but never closed.',
      line: 1,
      hint: 'Close the block with a line containing only ---',
    });
    return { meta, bodyStart: 0 };
  }
  return { meta, bodyStart: i + 1 };
}

function stripQuotes(v: string): string {
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

/* -------------------------------------------------------------------------- */
/* Block scanning                                                              */
/* -------------------------------------------------------------------------- */

function splitIntoChunks(lines: string[], from: number, diagnostics: Diagnostic[]): Chunk[] {
  const chunks: Chunk[] = [];
  let current: Chunk = { blocks: [], start: from + 1, end: from + 1 };
  let pending: string[] = [];
  let pendingStart = from + 1;

  const flushPending = () => {
    if (!pending.length) return;
    current.blocks.push(...parseBlocks(pending, pendingStart, diagnostics));
    pending = [];
  };

  let i = from;
  while (i < lines.length) {
    const line = lines[i]!;
    const fence = FENCE_RE.exec(line);

    // Fenced regions are copied verbatim, headings inside them are not headings.
    if (fence) {
      const marker = fence[1]!;
      const info = (fence[2] ?? '').trim();
      const body: string[] = [];
      let j = i + 1;
      while (j < lines.length && lines[j]!.trimEnd() !== marker) {
        body.push(lines[j]!);
        j += 1;
      }
      if (j >= lines.length) {
        diagnostics.push({
          severity: 'error',
          code: 'unterminated-fence',
          message: `Code fence opened at line ${i + 1} is never closed.`,
          line: i + 1,
          hint: `Add a closing ${marker} line.`,
        });
      }
      flushPending();
      const [language, ...nameParts] = info.split(/\s+/);
      current.blocks.push({
        kind: 'artwork',
        text: body.join('\n'),
        language: language || undefined,
        name: nameParts.join(' ') || undefined,
      });
      i = j + 1;
      pendingStart = i + 1;
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      flushPending();
      current.end = i;
      if (current.heading || current.blocks.length) chunks.push(current);
      current = { heading: parseHeading(heading, i + 1), blocks: [], start: i + 1, end: i + 1 };
      i += 1;
      pendingStart = i + 1;
      continue;
    }

    pending.push(line);
    i += 1;
  }

  flushPending();
  current.end = lines.length;
  if (current.heading || current.blocks.length) chunks.push(current);
  return chunks;
}

function parseHeading(m: RegExpExecArray, line: number): RawHeading {
  let title = (m[2] ?? '').trim();
  let explicitAnchor: string | undefined;
  let unnumbered = false;

  const anchorMatch = /\{#([A-Za-z0-9._-]+)\}\s*$/.exec(title);
  if (anchorMatch) {
    explicitAnchor = anchorMatch[1];
    title = title.slice(0, anchorMatch.index).trim();
  }
  const unnumberedMatch = /\{(-|unnumbered)\}\s*$/.exec(title);
  if (unnumberedMatch) {
    unnumbered = true;
    title = title.slice(0, unnumberedMatch.index).trim();
  }
  return { level: (m[1] ?? '#').length, title, explicitAnchor, unnumbered, line };
}

export function parseBlocks(lines: string[], startLine: number, diagnostics: Diagnostic[]): Block[] {
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    if (!line.trim()) {
      i += 1;
      continue;
    }

    // ::: note Label … :::
    const callout = /^:::\s*(\w+)?\s*(.*)$/.exec(line);
    if (callout) {
      const body: string[] = [];
      let j = i + 1;
      while (j < lines.length && !/^:::\s*$/.test(lines[j]!)) {
        body.push(lines[j]!);
        j += 1;
      }
      const kind = (callout[1] ?? 'note').toLowerCase();
      const label = (callout[2] ?? '').trim() || kind.charAt(0).toUpperCase() + kind.slice(1);
      blocks.push({ kind: 'note', label, blocks: parseBlocks(body, startLine + i + 1, diagnostics) });
      i = j + 1;
      continue;
    }

    // Fenced artwork inside a nested context.
    const fence = FENCE_RE.exec(line);
    if (fence) {
      const marker = fence[1]!;
      const info = (fence[2] ?? '').trim();
      const body: string[] = [];
      let j = i + 1;
      while (j < lines.length && lines[j]!.trimEnd() !== marker) {
        body.push(lines[j]!);
        j += 1;
      }
      const [language, ...nameParts] = info.split(/\s+/);
      blocks.push({
        kind: 'artwork',
        text: body.join('\n'),
        language: language || undefined,
        name: nameParts.join(' ') || undefined,
      });
      i = j + 1;
      continue;
    }

    // Pipe table
    if (line.includes('|') && TABLE_DELIM_RE.test(lines[i + 1] ?? '')) {
      const tableLines: string[] = [];
      let j = i;
      while (j < lines.length && lines[j]!.trim() && lines[j]!.includes('|')) {
        tableLines.push(lines[j]!);
        j += 1;
      }
      blocks.push(parseTable(tableLines));
      i = j;
      continue;
    }

    // Block quote
    if (/^\s*>\s?/.test(line)) {
      const body: string[] = [];
      let j = i;
      while (j < lines.length && /^\s*>\s?/.test(lines[j]!)) {
        body.push(lines[j]!.replace(/^\s*>\s?/, ''));
        j += 1;
      }
      blocks.push({ kind: 'blockquote', blocks: parseBlocks(body, startLine + i, diagnostics) });
      i = j;
      continue;
    }

    // List
    if (LIST_RE.test(line)) {
      const { block, next } = parseList(lines, i, startLine, diagnostics);
      blocks.push(block);
      i = next;
      continue;
    }

    // Definition list: term line followed by ": definition"
    if (/^\s*: /.test(lines[i + 1] ?? '') && line.trim() && !line.startsWith(' ')) {
      const items: Array<{ term: string; blocks: Block[] }> = [];
      let j = i;
      while (j < lines.length && lines[j]!.trim() && /^\s*: /.test(lines[j + 1] ?? '')) {
        const term = lines[j]!.trim();
        const defLines: string[] = [];
        let k = j + 1;
        while (k < lines.length && /^\s*: /.test(lines[k]!)) {
          defLines.push(lines[k]!.replace(/^\s*: /, ''));
          k += 1;
        }
        items.push({ term, blocks: parseBlocks(defLines, startLine + j, diagnostics) });
        j = k;
        while (j < lines.length && !lines[j]!.trim()) j += 1;
      }
      blocks.push({ kind: 'deflist', items });
      i = j;
      continue;
    }

    // Indented artwork (4 spaces) when not continuing a list.
    if (/^ {4,}\S/.test(line)) {
      const body: string[] = [];
      let j = i;
      while (j < lines.length && (/^ {4,}/.test(lines[j]!) || !lines[j]!.trim())) {
        body.push(lines[j]!.slice(4));
        j += 1;
      }
      while (body.length && !body[body.length - 1]!.trim()) body.pop();
      blocks.push({ kind: 'artwork', text: body.join('\n') });
      i = j;
      continue;
    }

    // Paragraph
    const para: string[] = [];
    let j = i;
    while (
      j < lines.length &&
      lines[j]!.trim() &&
      !LIST_RE.test(lines[j]!) &&
      !FENCE_RE.test(lines[j]!) &&
      !/^:::/.test(lines[j]!) &&
      !/^\s*>\s?/.test(lines[j]!)
    ) {
      para.push(lines[j]!.trim());
      j += 1;
    }
    blocks.push({ kind: 'paragraph', inlines: parseInlines(para.join(' ')) });
    i = j;
  }

  return blocks;
}

function parseList(
  lines: string[],
  start: number,
  startLine: number,
  diagnostics: Diagnostic[],
): { block: Block; next: number } {
  const first = LIST_RE.exec(lines[start]!)!;
  const baseIndent = (first[1] ?? '').length;
  const ordered = /\d/.test(first[2] ?? '');
  const items: Block[][] = [];

  let i = start;
  let currentItem: string[] | null = null;

  const commit = () => {
    if (currentItem) items.push(parseBlocks(currentItem, startLine + i, diagnostics));
    currentItem = null;
  };

  while (i < lines.length) {
    const line = lines[i]!;
    const m = LIST_RE.exec(line);
    const indent = /^(\s*)/.exec(line)![1]!.length;

    if (m && indent === baseIndent) {
      commit();
      currentItem = [m[3] ?? ''];
      i += 1;
      continue;
    }
    if (!line.trim()) {
      const nextLine = lines[i + 1];
      if (nextLine && (LIST_RE.test(nextLine) || /^\s{2,}\S/.test(nextLine))) {
        currentItem?.push('');
        i += 1;
        continue;
      }
      break;
    }
    if (indent > baseIndent && currentItem) {
      currentItem.push(line.slice(Math.min(indent, baseIndent + 2)));
      i += 1;
      continue;
    }
    break;
  }
  commit();

  const startNum = ordered ? Number.parseInt(first[2] ?? '1', 10) : undefined;
  return { block: { kind: 'list', ordered, start: startNum, items }, next: i };
}

function parseTable(tableLines: string[]): Block {
  const cells = (line: string): string[] =>
    line
      .replace(/^\s*\|/, '')
      .replace(/\|\s*$/, '')
      .split('|')
      .map((c) => c.trim());

  const headCells = cells(tableLines[0] ?? '');
  const alignRow = cells(tableLines[1] ?? '');
  const align = alignRow.map((a) => {
    const left = a.startsWith(':');
    const right = a.endsWith(':');
    if (left && right) return 'center' as const;
    if (right) return 'right' as const;
    return 'left' as const;
  });
  const rows = tableLines.slice(2).map((l) => cells(l).map((c) => parseInlines(c)));
  return {
    kind: 'table',
    align,
    head: headCells.map((c) => parseInlines(c, { markKeywords: false })),
    rows,
  };
}

/* -------------------------------------------------------------------------- */
/* Section tree + numbering                                                    */
/* -------------------------------------------------------------------------- */

function buildTree(chunks: Chunk[], diagnostics: Diagnostic[]): SectionNode[] {
  const roots: SectionNode[] = [];
  const stack: SectionNode[] = [];
  const seenAnchors = new Set<string>();
  let bodyCounter = 0;
  let appendixCounter = 0;
  let inAppendices = false;

  for (const chunk of chunks) {
    const h = chunk.heading;
    if (!h) continue;

    if (h.level === 1 && /^appendix\b/i.test(h.title)) inAppendices = true;

    while (stack.length && stack[stack.length - 1]!.depth >= h.level) stack.pop();
    const parent = stack[stack.length - 1];

    if (h.level > 1 && !parent) {
      diagnostics.push({
        severity: 'warning',
        code: 'orphan-heading',
        message: `Heading "${h.title}" is nested under no parent section.`,
        line: h.line,
        hint: 'Add a parent heading one level higher, or promote this heading.',
      });
    }

    const isAppendix = inAppendices && (h.level === 1 || Boolean(parent?.isAppendix));
    let number: string | null = null;

    if (!h.unnumbered && !(parent && !parent.numbered)) {
      if (h.level === 1) {
        if (isAppendix) {
          appendixCounter += 1;
          number = appendixLetter(appendixCounter);
        } else {
          bodyCounter += 1;
          number = String(bodyCounter);
        }
      } else if (parent?.number) {
        const siblingCount = parent.children.filter((c) => c.number).length + 1;
        number = `${parent.number}.${siblingCount}`;
      }
    }

    const baseAnchor = h.explicitAnchor ?? sectionAnchor(number, h.title, isAppendix);
    const anchor = dedupeAnchor(baseAnchor, seenAnchors);
    if (h.explicitAnchor && anchor !== h.explicitAnchor) {
      diagnostics.push({
        severity: 'error',
        code: 'duplicate-anchor',
        message: `Explicit anchor "${h.explicitAnchor}" is used more than once.`,
        line: h.line,
        hint: 'Anchors must be unique inside a document.',
      });
    }

    // The title cleaned of the redundant "Appendix A." prefix authors often type.
    const cleanTitle = h.title.replace(/^appendix\s+[A-Z]+[.:]?\s*/i, '').trim() || h.title;

    const node: SectionNode = {
      number,
      title: isAppendix ? cleanTitle : h.title,
      depth: h.level,
      anchor,
      isAppendix,
      numbered: Boolean(number),
      blocks: chunk.blocks,
      children: [],
      sourceStart: chunk.start,
      sourceEnd: chunk.end,
    };

    if (parent) parent.children.push(node);
    else roots.push(node);
    stack.push(node);
  }

  return roots;
}

/* -------------------------------------------------------------------------- */
/* References                                                                  */
/* -------------------------------------------------------------------------- */

function collectReferences(sections: SectionNode[], diagnostics: Diagnostic[]): ReferenceEntry[] {
  const entries: ReferenceEntry[] = [];
  const seenKeys = new Set<string>();

  for (const section of flattenSections(sections)) {
    if (!/references$/i.test(section.title)) continue;
    const normative = !/informative/i.test(section.title);

    for (const block of section.blocks) {
      const lines =
        block.kind === 'paragraph'
          ? [inlineText(block.inlines)]
          : block.kind === 'list'
            ? block.items.map((item) =>
                item.map((b) => (b.kind === 'paragraph' ? inlineText(b.inlines) : '')).join(' '),
              )
            : block.kind === 'deflist'
              ? block.items.map((it) => `${it.term} ${blockText(it.blocks)}`)
              : [];

      for (const raw of lines) {
        const m = REFERENCE_RE.exec(raw);
        if (!m) continue;
        const key = m[1]!;
        if (seenKeys.has(key)) {
          diagnostics.push({
            severity: 'warning',
            code: 'duplicate-reference',
            message: `Reference [${key}] is listed more than once.`,
            line: section.sourceStart,
          });
          continue;
        }
        seenKeys.add(key);
        const text = (m[2] ?? '').trim();
        const urlMatch = /<(https?:\/\/[^>]+)>|(https?:\/\/\S+)/.exec(text);
        const localMatch = /\b([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d{3,})\b/.exec(text);
        entries.push({
          key,
          text,
          normative,
          anchor: referenceAnchor(key),
          targetUrl: urlMatch ? (urlMatch[1] ?? urlMatch[2]) : undefined,
          targetSlug: localMatch ? localMatch[1] : undefined,
        });
      }
    }
  }
  return entries;
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                  */
/* -------------------------------------------------------------------------- */

function validateCrossReferences(
  sections: SectionNode[],
  anchorIndex: ParsedDocument['anchorIndex'],
  references: ReferenceEntry[],
  diagnostics: Diagnostic[],
): void {
  const refKeys = new Set(references.map((r) => r.key));
  const usedCitations = new Set<string>();

  const walkInline = (inlines: unknown[], line: number) => {
    for (const raw of inlines) {
      const inline = raw as { kind: string; [k: string]: unknown };
      if (inline.kind === 'xref') {
        const target = String(inline.target);
        if (!anchorIndex[target]) {
          diagnostics.push({
            severity: 'error',
            code: 'broken-xref',
            message: `Cross-reference {{${target}}} does not resolve to any anchor in this document.`,
            line,
            hint: 'Use an existing section anchor such as section-2 or appendix-a.',
          });
        }
      } else if (inline.kind === 'citation') {
        const key = String(inline.key);
        usedCitations.add(key);
        if (!refKeys.has(key)) {
          diagnostics.push({
            severity: 'error',
            code: 'broken-citation',
            message: `Citation [${key}] has no matching entry in the references sections.`,
            line,
            hint: `Add "[${key}]  Author, "Title", date." under Normative or Informative References.`,
          });
        }
      } else if (inline.kind === 'strong' || inline.kind === 'em') {
        walkInline(inline.children as unknown[], line);
      }
    }
  };

  const walkBlocks = (blocks: Block[], line: number) => {
    for (const b of blocks) {
      switch (b.kind) {
        case 'paragraph':
          walkInline(b.inlines, line);
          break;
        case 'list':
          b.items.forEach((item) => walkBlocks(item, line));
          break;
        case 'deflist':
          b.items.forEach((item) => walkBlocks(item.blocks, line));
          break;
        case 'table':
          b.head.forEach((c) => walkInline(c, line));
          b.rows.forEach((r) => r.forEach((c) => walkInline(c, line)));
          break;
        case 'note':
        case 'blockquote':
          walkBlocks(b.blocks, line);
          break;
        default:
          break;
      }
    }
  };

  for (const s of flattenSections(sections)) walkBlocks(s.blocks, s.sourceStart);

  for (const ref of references) {
    if (!usedCitations.has(ref.key)) {
      diagnostics.push({
        severity: 'warning',
        code: 'unused-reference',
        message: `Reference [${ref.key}] is listed but never cited in the body.`,
        hint: 'Cite it with [KEY] or remove the entry.',
      });
    }
  }
}

/**
 * Rewrites `{{anchor}}` cross references that carry no explicit label into a
 * readable "Section 2.1" / "Appendix A" form, so plaintext output reads like
 * prose rather than exposing anchor ids.
 */
export function resolveXrefLabels(
  sections: SectionNode[],
  anchorIndex: ParsedDocument['anchorIndex'],
): void {
  const label = (target: string): string | null => {
    const entry = anchorIndex[target];
    if (!entry) return null;
    if (target.startsWith('appendix-') && entry.number) return `Appendix ${entry.number}`;
    if (entry.number) return `Section ${entry.number}`;
    return entry.title;
  };

  const walkInlines = (inlines: Inline[]) => {
    for (const inline of inlines) {
      if (inline.kind === 'xref' && inline.text === inline.target) {
        const resolved = label(inline.target);
        if (resolved) inline.text = resolved;
      } else if (inline.kind === 'strong' || inline.kind === 'em') {
        walkInlines(inline.children);
      }
    }
  };

  const walkBlocks = (blocks: Block[]) => {
    for (const b of blocks) {
      switch (b.kind) {
        case 'paragraph':
          walkInlines(b.inlines);
          break;
        case 'list':
          b.items.forEach(walkBlocks);
          break;
        case 'deflist':
          b.items.forEach((i) => walkBlocks(i.blocks));
          break;
        case 'table':
          b.head.forEach(walkInlines);
          b.rows.forEach((r) => r.forEach(walkInlines));
          break;
        case 'note':
        case 'blockquote':
          walkBlocks(b.blocks);
          break;
        default:
          break;
      }
    }
  };

  for (const s of flattenSections(sections)) walkBlocks(s.blocks);
}
