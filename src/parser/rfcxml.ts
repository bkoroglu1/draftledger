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
import { blockText, flattenSections } from './model.ts';
import { resolveXrefLabels } from './markdown.ts';
import {
  childElements,
  firstChild,
  parseXml,
  textContent,
  XmlParseError,
  type XmlElement,
  type XmlNode,
} from './xml.ts';

/**
 * RFCXML front-end covering the subset DraftLedger authors and emits:
 * front/middle/back, section, t, ul/ol/dl, artwork, sourcecode, table, xref,
 * eref, references and reference.
 */

export function parseRfcXml(source: string): ParsedDocument {
  const diagnostics: Diagnostic[] = [];
  let root: XmlElement;
  try {
    root = parseXml(source);
  } catch (err) {
    if (err instanceof XmlParseError) {
      return failed(
        {
          severity: 'error',
          code: 'xml-parse-error',
          message: err.message,
          line: err.line,
          column: err.column,
          hint: 'Fix the XML syntax; the document cannot be rendered until it parses.',
        },
        diagnostics,
      );
    }
    throw err;
  }

  if (root.name !== 'rfc') {
    return failed(
      {
        severity: 'error',
        code: 'unexpected-root',
        message: `Expected <rfc> as the root element, found <${root.name}>.`,
        line: root.line,
      },
      diagnostics,
    );
  }

  const front = firstChild(root, 'front');
  const middle = firstChild(root, 'middle');
  const back = firstChild(root, 'back');

  const title = front ? textContent(firstChild(front, 'title') ?? emptyEl()).trim() : '';
  const abstractEl = front ? firstChild(front, 'abstract') : undefined;
  const abstract = abstractEl ? parseContent(abstractEl, diagnostics) : [];
  const keywords = front
    ? childElements(front, 'keyword').map((k) => textContent(k).trim()).filter(Boolean)
    : [];

  const seenAnchors = new Set<string>();
  const sections: SectionNode[] = [];

  let bodyCounter = 0;
  for (const el of middle ? childElements(middle, 'section') : []) {
    bodyCounter += 1;
    sections.push(buildSection(el, String(bodyCounter), 1, false, seenAnchors, diagnostics));
  }

  const references: ReferenceEntry[] = [];
  if (back) {
    for (const refsEl of childElements(back, 'references')) {
      const name = textContent(firstChild(refsEl, 'name') ?? emptyEl()).trim() || 'References';
      const normative = !/informative/i.test(name);
      bodyCounter += 1;
      const node = makeSection(name, String(bodyCounter), 1, false, seenAnchors, refsEl.line);
      node.blocks = [];
      for (const ref of childElements(refsEl, 'reference')) {
        const entry = parseReference(ref, normative);
        references.push(entry);
        node.blocks.push({
          kind: 'paragraph',
          inlines: [{ kind: 'text', text: `[${entry.key}]  ${entry.text}` }],
        });
      }
      sections.push(node);
    }

    let appendixCounter = 0;
    for (const el of childElements(back, 'section')) {
      appendixCounter += 1;
      sections.push(
        buildSection(el, appendixLetter(appendixCounter), 1, true, seenAnchors, diagnostics),
      );
    }
  }

  const anchorIndex: ParsedDocument['anchorIndex'] = {};
  for (const s of flattenSections(sections)) {
    anchorIndex[s.anchor] = { number: s.number, title: s.title, depth: s.depth };
  }
  for (const r of references) anchorIndex[r.anchor] = { number: null, title: r.key, depth: 3 };

  resolveXrefLabels(sections, anchorIndex);
  validateXrefs(sections, anchorIndex, references, diagnostics);

  const words = [
    blockText(abstract),
    ...flattenSections(sections).map((s) => `${s.title}\n${blockText(s.blocks)}`),
  ].join('\n');

  return {
    meta: {
      title: title || 'Untitled document',
      abstract: blockText(abstract).trim() || null,
      keywords,
      raw: {
        docName: root.attrs.docName ?? '',
        category: root.attrs.category ?? '',
        ipr: root.attrs.ipr ?? '',
        version: root.attrs.version ?? '3',
      },
    },
    abstract,
    sections,
    references,
    diagnostics,
    anchorIndex,
    wordCount: words.split(/\s+/).filter(Boolean).length,
  };
}

function failed(d: Diagnostic, diagnostics: Diagnostic[]): ParsedDocument {
  diagnostics.push(d);
  return {
    meta: { title: 'Unparsed document', abstract: null, keywords: [], raw: {} },
    abstract: [],
    sections: [],
    references: [],
    diagnostics,
    anchorIndex: {},
    wordCount: 0,
  };
}

function emptyEl(): XmlElement {
  return { type: 'element', name: '#empty', attrs: {}, children: [], line: 0 };
}

function makeSection(
  title: string,
  number: string | null,
  depth: number,
  isAppendix: boolean,
  seen: Set<string>,
  line: number,
  explicitAnchor?: string,
): SectionNode {
  const anchor = dedupeAnchor(
    explicitAnchor ?? sectionAnchor(number, title, isAppendix),
    seen,
  );
  return {
    number,
    title,
    depth,
    anchor,
    isAppendix,
    numbered: Boolean(number),
    blocks: [],
    children: [],
    sourceStart: line,
    sourceEnd: line,
  };
}

function buildSection(
  el: XmlElement,
  number: string | null,
  depth: number,
  isAppendix: boolean,
  seen: Set<string>,
  diagnostics: Diagnostic[],
): SectionNode {
  const title =
    textContent(firstChild(el, 'name') ?? emptyEl()).trim() || el.attrs.title || 'Untitled section';
  const node = makeSection(title, number, depth, isAppendix, seen, el.line, el.attrs.anchor);
  node.blocks = parseContent(el, diagnostics, /* skipSections */ true);

  let child = 0;
  for (const sub of childElements(el, 'section')) {
    child += 1;
    const childNumber = number ? `${number}.${child}` : null;
    node.children.push(buildSection(sub, childNumber, depth + 1, isAppendix, seen, diagnostics));
  }
  node.sourceEnd = lastLine(el);
  return node;
}

function lastLine(el: XmlElement): number {
  let max = el.line;
  for (const c of el.children) {
    if (c.type === 'element') max = Math.max(max, lastLine(c));
    else max = Math.max(max, c.line + c.text.split('\n').length - 1);
  }
  return max;
}

function parseContent(el: XmlElement, diagnostics: Diagnostic[], skipSections = false): Block[] {
  const blocks: Block[] = [];
  for (const child of el.children) {
    if (child.type !== 'element') continue;
    if (skipSections && child.name === 'section') continue;
    const block = parseBlockElement(child, diagnostics);
    if (block) blocks.push(...block);
  }
  return blocks;
}

function parseBlockElement(el: XmlElement, diagnostics: Diagnostic[]): Block[] | null {
  switch (el.name) {
    case 'name':
      return null;
    case 't':
      return [{ kind: 'paragraph', inlines: parseXmlInlines(el) }];
    case 'artwork':
      return [{ kind: 'artwork', text: trimArtwork(textContent(el)), name: el.attrs.name }];
    case 'sourcecode':
      return [
        {
          kind: 'artwork',
          text: trimArtwork(textContent(el)),
          language: el.attrs.type,
          name: el.attrs.name,
        },
      ];
    case 'ul':
    case 'ol':
      return [
        {
          kind: 'list',
          ordered: el.name === 'ol',
          start: el.attrs.start ? Number(el.attrs.start) : undefined,
          items: childElements(el, 'li').map((li) => parseListItem(li, diagnostics)),
        },
      ];
    case 'dl':
      return [{ kind: 'deflist', items: parseDefinitionList(el, diagnostics) }];
    case 'table':
      return [parseTableElement(el)];
    case 'aside':
    case 'note':
      return [
        {
          kind: 'note',
          label: textContent(firstChild(el, 'name') ?? emptyEl()).trim() || 'Note',
          blocks: parseContent(el, diagnostics),
        },
      ];
    case 'blockquote':
      return [{ kind: 'blockquote', blocks: parseContent(el, diagnostics) }];
    case 'figure':
      return parseContent(el, diagnostics);
    default:
      diagnostics.push({
        severity: 'info',
        code: 'unsupported-element',
        message: `<${el.name}> is not part of the supported RFCXML subset and was skipped.`,
        line: el.line,
      });
      return null;
  }
}

function parseListItem(li: XmlElement, diagnostics: Diagnostic[]): Block[] {
  const blocks = parseContent(li, diagnostics);
  if (blocks.length) return blocks;
  return [{ kind: 'paragraph', inlines: parseXmlInlines(li) }];
}

function parseDefinitionList(
  el: XmlElement,
  diagnostics: Diagnostic[],
): Array<{ term: string; blocks: Block[] }> {
  const items: Array<{ term: string; blocks: Block[] }> = [];
  let pendingTerm: string | null = null;
  for (const child of childElements(el)) {
    if (child.name === 'dt') pendingTerm = textContent(child).trim();
    else if (child.name === 'dd') {
      const blocks = parseContent(child, diagnostics);
      items.push({
        term: pendingTerm ?? '',
        blocks: blocks.length ? blocks : [{ kind: 'paragraph', inlines: parseXmlInlines(child) }],
      });
      pendingTerm = null;
    }
  }
  return items;
}

function parseTableElement(el: XmlElement): Block {
  const thead = firstChild(el, 'thead');
  const tbody = firstChild(el, 'tbody');
  const headRow = thead ? childElements(thead, 'tr')[0] : undefined;
  const head = headRow ? childElements(headRow, 'th').map((c) => parseXmlInlines(c)) : [];
  const rows = (tbody ? childElements(tbody, 'tr') : childElements(el, 'tr')).map((tr) =>
    childElements(tr).map((td) => parseXmlInlines(td)),
  );
  const align = head.map(() => 'left' as const);
  return {
    kind: 'table',
    align,
    head,
    rows,
    caption: textContent(firstChild(el, 'name') ?? emptyEl()).trim() || undefined,
  };
}

function parseXmlInlines(el: XmlElement): Inline[] {
  const out: Inline[] = [];
  for (const node of el.children) {
    out.push(...inlineFromNode(node));
  }
  return out.length ? out : [{ kind: 'text', text: '' }];
}

function inlineFromNode(node: XmlNode): Inline[] {
  if (node.type === 'text') {
    return parseInlines(node.text.replace(/\s+/g, ' '));
  }
  switch (node.name) {
    case 'xref':
      return [
        {
          kind: 'xref',
          target: node.attrs.target ?? '',
          text: textContent(node).trim() || node.attrs.target || '',
        },
      ];
    case 'eref': {
      const href = node.attrs.target ?? '';
      const text = textContent(node).trim() || href;
      if (/^mailto:/i.test(href)) {
        return [{ kind: 'mailto', address: href.slice(7), text }];
      }
      if (/^https?:\/\//i.test(href)) return [{ kind: 'link', href, text }];
      return [{ kind: 'text', text }];
    }
    case 'tt':
    case 'code':
      return [{ kind: 'code', text: textContent(node) }];
    case 'strong':
    case 'bcp14':
      return node.name === 'bcp14'
        ? [{ kind: 'keyword', text: textContent(node).trim() }]
        : [{ kind: 'strong', children: node.children.flatMap(inlineFromNode) }];
    case 'em':
      return [{ kind: 'em', children: node.children.flatMap(inlineFromNode) }];
    case 'br':
      return [{ kind: 'text', text: ' ' }];
    default:
      return node.children.flatMap(inlineFromNode);
  }
}

function parseReference(el: XmlElement, normative: boolean): ReferenceEntry {
  const key = el.attrs.anchor ?? 'UNKNOWN';
  const front = firstChild(el, 'front');
  const title = front ? textContent(firstChild(front, 'title') ?? emptyEl()).trim() : '';
  const authors = front
    ? childElements(front, 'author')
        .map((a) => a.attrs.fullname ?? a.attrs.surname ?? '')
        .filter(Boolean)
    : [];
  const dateEl = front ? firstChild(front, 'date') : undefined;
  const date = dateEl ? [dateEl.attrs.month, dateEl.attrs.year].filter(Boolean).join(' ') : '';
  const seriesInfo = childElements(el, 'seriesInfo')
    .map((s) => [s.attrs.name, s.attrs.value].filter(Boolean).join(' '))
    .filter(Boolean);
  const target = el.attrs.target;

  const text = [
    authors.join(', '),
    title ? `"${title}"` : '',
    seriesInfo.join(', '),
    date,
  ]
    .filter(Boolean)
    .join(', ');

  return {
    key,
    text: text || key,
    normative,
    anchor: referenceAnchor(key),
    targetUrl: target && /^https?:\/\//i.test(target) ? target : undefined,
    targetSlug: seriesInfo.length ? seriesInfo[0]!.split(/\s+/).pop() : undefined,
  };
}

function trimArtwork(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  while (lines.length && !lines[0]!.trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1]!.trim()) lines.pop();
  const indents = lines.filter((l) => l.trim()).map((l) => /^(\s*)/.exec(l)![1]!.length);
  const common = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(common)).join('\n');
}

function validateXrefs(
  sections: SectionNode[],
  anchorIndex: ParsedDocument['anchorIndex'],
  references: ReferenceEntry[],
  diagnostics: Diagnostic[],
): void {
  const known = new Set([...Object.keys(anchorIndex), ...references.map((r) => r.key)]);
  const walk = (blocks: Block[], line: number) => {
    for (const b of blocks) {
      if (b.kind === 'paragraph') {
        for (const inline of b.inlines) {
          if (inline.kind === 'xref' && !known.has(inline.target)) {
            diagnostics.push({
              severity: 'error',
              code: 'broken-xref',
              message: `<xref target="${inline.target}"> does not resolve inside this document.`,
              line,
              hint: 'Point it at an existing section anchor or reference anchor.',
            });
          }
        }
      } else if (b.kind === 'list') b.items.forEach((i) => walk(i, line));
      else if (b.kind === 'deflist') b.items.forEach((i) => walk(i.blocks, line));
      else if (b.kind === 'note' || b.kind === 'blockquote') walk(b.blocks, line);
    }
  };
  for (const s of flattenSections(sections)) walk(s.blocks, s.sourceStart);
}
