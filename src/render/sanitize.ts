/**
 * Allowlist HTML sanitizer + tolerant HTML parser.
 *
 * Used for anything that did not come out of our own renderer — imported
 * upstream HTML above all. Unknown elements are unwrapped, unknown attributes
 * dropped, and only http(s)/mailto/#fragment URLs survive.
 */

import { decodeEntities } from '#src/parser/xml.ts';
import { escapeAttr, escapeHtml, safeHref } from './escape.ts';

export interface HtmlEl {
  type: 'element';
  name: string;
  attrs: Record<string, string>;
  children: HtmlNode[];
}
export interface HtmlText {
  type: 'text';
  text: string;
}
export type HtmlNode = HtmlEl | HtmlText;

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source',
  'track', 'wbr',
]);

/** Elements that are removed together with their content. */
const DROP_WITH_CONTENT = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'applet', 'noscript', 'template', 'form',
  'input', 'button', 'select', 'textarea', 'svg', 'math', 'link', 'meta', 'base',
]);

const ALLOWED: Record<string, string[]> = {
  a: ['href', 'title'],
  p: [], div: [], span: ['class'], br: [], hr: [],
  h1: ['id'], h2: ['id'], h3: ['id'], h4: ['id'], h5: ['id'], h6: ['id'],
  ul: [], ol: ['start'], li: [], dl: [], dt: [], dd: [],
  pre: ['class'], code: ['class'], samp: [], kbd: [], var: [],
  blockquote: [], aside: ['class'], figure: ['class'], figcaption: [],
  table: ['class'], thead: [], tbody: [], tfoot: [], tr: [], th: ['scope', 'colspan', 'rowspan'],
  td: ['colspan', 'rowspan'], caption: [],
  strong: [], b: [], em: [], i: [], u: [], sup: [], sub: [], small: [],
  section: ['id', 'class'], article: ['class'], nav: ['class'], header: ['class'], footer: ['class'],
  main: [], body: [], html: [], head: [], title: [],
  ins: [], del: [], mark: [], abbr: ['title'], time: ['datetime'],
};

export function parseHtml(source: string): HtmlEl {
  const root: HtmlEl = { type: 'element', name: '#root', attrs: {}, children: [] };
  const stack: HtmlEl[] = [root];
  let i = 0;
  const src = source;

  const top = () => stack[stack.length - 1]!;

  while (i < src.length) {
    if (src.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i);
      i = end === -1 ? src.length : end + 3;
      continue;
    }
    if (src.startsWith('<!', i) || src.startsWith('<?', i)) {
      const end = src.indexOf('>', i);
      i = end === -1 ? src.length : end + 1;
      continue;
    }
    if (src.startsWith('</', i)) {
      const end = src.indexOf('>', i);
      const name = src.slice(i + 2, end === -1 ? src.length : end).trim().toLowerCase();
      for (let d = stack.length - 1; d > 0; d -= 1) {
        if (stack[d]!.name === name) {
          stack.length = d;
          break;
        }
      }
      i = end === -1 ? src.length : end + 1;
      continue;
    }
    if (src[i] === '<' && /[a-zA-Z]/.test(src[i + 1] ?? '')) {
      const end = findTagEnd(src, i);
      if (end === -1) break;
      const body = src.slice(i + 1, end);
      const selfClosing = body.trimEnd().endsWith('/');
      const inner = selfClosing ? body.trimEnd().slice(0, -1) : body;
      const nameMatch = /^([a-zA-Z][\w:-]*)/.exec(inner);
      const name = (nameMatch?.[1] ?? '').toLowerCase();
      const el: HtmlEl = {
        type: 'element',
        name,
        attrs: parseAttrs(inner.slice(name.length)),
        children: [],
      };

      if (DROP_WITH_CONTENT.has(name)) {
        // Void elements carry no closing tag, so only the tag itself is
        // dropped; searching for a closing tag would swallow the rest of the
        // document.
        if (selfClosing || VOID_ELEMENTS.has(name)) {
          i = end + 1;
          continue;
        }
        // Otherwise skip the element together with everything it contains.
        const close = new RegExp(`</${name}\\s*>`, 'i');
        const rest = src.slice(end + 1);
        const m = close.exec(rest);
        i = m ? end + 1 + m.index + m[0].length : src.length;
        continue;
      }

      top().children.push(el);
      if (!selfClosing && !VOID_ELEMENTS.has(name)) stack.push(el);
      i = end + 1;
      continue;
    }

    const next = src.indexOf('<', i);
    const stop = next === -1 ? src.length : next;
    const text = decodeEntities(src.slice(i, stop));
    if (text) top().children.push({ type: 'text', text });
    i = stop;
  }

  return root;
}

function findTagEnd(src: string, start: number): number {
  let quote: string | null = null;
  for (let i = start + 1; i < src.length; i += 1) {
    const ch = src[i]!;
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '>') return i;
  }
  return -1;
}

function parseAttrs(input: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z_:][-\w:.]*)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    const key = m[1]!.toLowerCase();
    attrs[key] = decodeEntities(m[3] ?? m[4] ?? m[5] ?? '');
  }
  return attrs;
}

/** Returns a sanitized HTML string: allowlisted tags/attrs, safe URLs only. */
export function sanitizeHtml(source: string): string {
  const root = parseHtml(source);
  return serialize(root.children);
}

function serialize(nodes: HtmlNode[]): string {
  return nodes
    .map((node) => {
      if (node.type === 'text') return escapeHtml(node.text);
      const allowedAttrs = ALLOWED[node.name];
      const inner = serialize(node.children);
      if (!allowedAttrs) return inner; // unknown element: unwrap, keep content
      if (node.name === 'html' || node.name === 'body' || node.name === 'head') return inner;

      const attrs: string[] = [];
      for (const attr of allowedAttrs) {
        const value = node.attrs[attr];
        if (value === undefined) continue;
        if (attr === 'href') {
          const href = safeHref(value);
          if (!href) continue;
          attrs.push(`href="${escapeAttr(href)}" rel="noopener noreferrer nofollow"`);
          continue;
        }
        attrs.push(`${attr}="${escapeAttr(value)}"`);
      }
      const attrString = attrs.length ? ` ${attrs.join(' ')}` : '';
      if (VOID_ELEMENTS.has(node.name)) return `<${node.name}${attrString}>`;
      return `<${node.name}${attrString}>${inner}</${node.name}>`;
    })
    .join('');
}

export function htmlTextContent(node: HtmlNode): string {
  if (node.type === 'text') return node.text;
  return node.children.map(htmlTextContent).join('');
}
