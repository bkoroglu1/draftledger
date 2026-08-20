import { sectionAnchor, dedupeAnchor } from '#src/parser/anchors.ts';
import { parseInlines } from '#src/parser/inline.ts';
import type { Block, Inline, ParsedDocument, SectionNode } from '#src/parser/index.ts';
import { htmlTextContent, parseHtml, type HtmlEl, type HtmlNode } from './sanitize.ts';

/**
 * "Plaintextify the HTML": reads an HTML artifact (ours or an imported one),
 * sanitizes it and converts it back into the normalized document tree so the
 * regular monospace/paginated reader can render it. Section and citation links
 * keep working because anchors are recovered from the heading structure.
 */

export function documentFromHtml(source: string): ParsedDocument {
  const root = parseHtml(source);
  const title = findTitle(root);
  const seen = new Set<string>();

  const sections: SectionNode[] = [];
  const stack: SectionNode[] = [];
  let abstract: Block[] = [];
  let pending: Block[] = [];
  let bodyCounter = 0;
  let inAbstract = false;

  const attach = (blocks: Block[]) => {
    if (!blocks.length) return;
    if (inAbstract) abstract.push(...blocks);
    else if (stack.length) stack[stack.length - 1]!.blocks.push(...blocks);
  };

  const walk = (node: HtmlNode) => {
    if (node.type === 'text') {
      if (node.text.trim()) pending.push({ kind: 'paragraph', inlines: [{ kind: 'text', text: node.text.trim() }] });
      return;
    }

    const heading = /^h([1-6])$/.exec(node.name);
    if (heading) {
      attach(pending);
      pending = [];
      const text = htmlTextContent(node).replace(/^#\s*/, '').trim();
      const level = Number(heading[1]);
      if (/^abstract$/i.test(text)) {
        inAbstract = true;
        return;
      }
      if (/^table of contents$/i.test(text)) {
        inAbstract = false;
        return;
      }
      inAbstract = false;

      const cleaned = text.replace(/^(?:Appendix\s+)?[A-Z0-9]+(?:\.\d+)*\.\s*/i, '').trim() || text;
      const isAppendix = /^appendix\b/i.test(text);
      while (stack.length && stack[stack.length - 1]!.depth >= level) stack.pop();
      const parent = stack[stack.length - 1];

      let number: string | null = null;
      if (level === 1 || !parent) {
        bodyCounter += 1;
        number = String(bodyCounter);
      } else if (parent.number) {
        number = `${parent.number}.${parent.children.length + 1}`;
      }

      const explicit = node.attrs.id;
      const anchor = dedupeAnchor(explicit || sectionAnchor(number, cleaned, isAppendix), seen);
      const section: SectionNode = {
        number,
        title: cleaned,
        depth: level,
        anchor,
        isAppendix,
        numbered: Boolean(number),
        blocks: [],
        children: [],
        sourceStart: 0,
        sourceEnd: 0,
      };
      if (parent) parent.children.push(section);
      else sections.push(section);
      stack.push(section);
      return;
    }

    const block = blockFromElement(node);
    if (block) {
      pending.push(block);
      attach(pending);
      pending = [];
      return;
    }
    for (const child of node.children) walk(child);
  };

  for (const child of root.children) walk(child);
  attach(pending);

  const anchorIndex: ParsedDocument['anchorIndex'] = {};
  const flatten = (list: SectionNode[]) => {
    for (const s of list) {
      anchorIndex[s.anchor] = { number: s.number, title: s.title, depth: s.depth };
      flatten(s.children);
    }
  };
  flatten(sections);

  const wordSource = [title, ...Object.values(anchorIndex).map((a) => a.title)].join(' ');
  return {
    meta: { title: title || 'Imported document', abstract: null, keywords: [], raw: {} },
    abstract,
    sections,
    references: [],
    diagnostics: [],
    anchorIndex,
    wordCount: wordSource.split(/\s+/).filter(Boolean).length,
  };
}

function findTitle(root: HtmlEl): string {
  const search = (node: HtmlNode): string | null => {
    if (node.type === 'text') return null;
    if (node.name === 'title' || node.name === 'h1') return htmlTextContent(node).trim();
    for (const child of node.children) {
      const found = search(child);
      if (found) return found;
    }
    return null;
  };
  return search(root) ?? '';
}

function blockFromElement(el: HtmlEl): Block | null {
  switch (el.name) {
    case 'p':
      return { kind: 'paragraph', inlines: inlinesFrom(el) };
    case 'pre':
      return { kind: 'artwork', text: htmlTextContent(el).replace(/^\n/, '').replace(/\n$/, '') };
    case 'ul':
    case 'ol':
      return {
        kind: 'list',
        ordered: el.name === 'ol',
        start: el.attrs.start ? Number(el.attrs.start) : undefined,
        items: el.children
          .filter((c): c is HtmlEl => c.type === 'element' && c.name === 'li')
          .map((li) => [{ kind: 'paragraph', inlines: inlinesFrom(li) } as Block]),
      };
    case 'dl': {
      const items: Array<{ term: string; blocks: Block[] }> = [];
      let term = '';
      for (const child of el.children) {
        if (child.type !== 'element') continue;
        if (child.name === 'dt') term = htmlTextContent(child).trim();
        else if (child.name === 'dd')
          items.push({ term, blocks: [{ kind: 'paragraph', inlines: inlinesFrom(child) }] });
      }
      return { kind: 'deflist', items };
    }
    case 'table': {
      const rows: Inline[][][] = [];
      let head: Inline[][] = [];
      const walkRows = (node: HtmlNode) => {
        if (node.type !== 'element') return;
        if (node.name === 'tr') {
          const cells = node.children.filter(
            (c): c is HtmlEl => c.type === 'element' && (c.name === 'td' || c.name === 'th'),
          );
          const isHead = cells.every((c) => c.name === 'th');
          const parsed = cells.map((c) => inlinesFrom(c));
          if (isHead && !head.length) head = parsed;
          else rows.push(parsed);
          return;
        }
        node.children.forEach(walkRows);
      };
      el.children.forEach(walkRows);
      return { kind: 'table', align: head.map(() => 'left' as const), head, rows };
    }
    case 'blockquote':
      return { kind: 'blockquote', blocks: [{ kind: 'paragraph', inlines: inlinesFrom(el) }] };
    case 'aside':
      return {
        kind: 'note',
        label: 'Note',
        blocks: [{ kind: 'paragraph', inlines: inlinesFrom(el) }],
      };
    default:
      return null;
  }
}

function inlinesFrom(el: HtmlEl): Inline[] {
  const out: Inline[] = [];
  const walk = (node: HtmlNode) => {
    if (node.type === 'text') {
      out.push(...parseInlines(node.text.replace(/\s+/g, ' ')));
      return;
    }
    switch (node.name) {
      case 'code':
      case 'samp':
      case 'kbd':
        out.push({ kind: 'code', text: htmlTextContent(node) });
        return;
      case 'strong':
      case 'b': {
        const children: Inline[] = [];
        node.children.forEach((c) => children.push(...inlinesFrom({ ...node, children: [c] })));
        out.push({ kind: 'strong', children });
        return;
      }
      case 'em':
      case 'i': {
        const children: Inline[] = [];
        node.children.forEach((c) => children.push(...inlinesFrom({ ...node, children: [c] })));
        out.push({ kind: 'em', children });
        return;
      }
      case 'a': {
        const href = node.attrs.href ?? '';
        const text = htmlTextContent(node).trim();
        if (href.startsWith('#')) out.push({ kind: 'xref', target: href.slice(1), text });
        else if (/^mailto:/i.test(href)) out.push({ kind: 'mailto', address: href.slice(7), text });
        else if (/^https?:/i.test(href)) out.push({ kind: 'link', href, text });
        else out.push({ kind: 'text', text });
        return;
      }
      case 'br':
        out.push({ kind: 'text', text: ' ' });
        return;
      default:
        node.children.forEach(walk);
    }
  };
  el.children.forEach(walk);
  return out.length ? out : [{ kind: 'text', text: '' }];
}
