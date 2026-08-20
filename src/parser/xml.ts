/**
 * Minimal, dependency-free XML reader.
 *
 * Deliberately restricted: no DTD, no external entities, no processing beyond
 * the five predefined entities and numeric character references. Documents that
 * declare a DOCTYPE or an ENTITY are rejected outright (XXE defence).
 */

export interface XmlElement {
  type: 'element';
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  /** 1-based line of the opening tag, used for diagnostics. */
  line: number;
}

export interface XmlText {
  type: 'text';
  text: string;
  line: number;
}

export type XmlNode = XmlElement | XmlText;

export class XmlParseError extends Error {
  readonly line: number;
  readonly column: number;
  constructor(message: string, line: number, column: number) {
    super(message);
    this.name = 'XmlParseError';
    this.line = line;
    this.column = column;
  }
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

export function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9A-Fa-f]+|[A-Za-z][A-Za-z0-9]*);/g, (whole, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body] ?? whole;
  });
}

export function parseXml(source: string): XmlElement {
  const src = source.replace(/\r\n?/g, '\n');
  if (/<!DOCTYPE/i.test(src) || /<!ENTITY/i.test(src)) {
    throw new XmlParseError('DOCTYPE and ENTITY declarations are not accepted', 1, 1);
  }

  let i = 0;
  let line = 1;
  let column = 1;

  const advance = (n: number) => {
    for (let k = 0; k < n; k += 1) {
      if (src[i] === '\n') {
        line += 1;
        column = 1;
      } else {
        column += 1;
      }
      i += 1;
    }
  };

  const stack: XmlElement[] = [];
  let root: XmlElement | null = null;

  while (i < src.length) {
    if (src.startsWith('<?', i)) {
      const end = src.indexOf('?>', i);
      if (end === -1) throw new XmlParseError('Unterminated processing instruction', line, column);
      advance(end + 2 - i);
      continue;
    }
    if (src.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i);
      if (end === -1) throw new XmlParseError('Unterminated comment', line, column);
      advance(end + 3 - i);
      continue;
    }
    if (src.startsWith('<![CDATA[', i)) {
      const end = src.indexOf(']]>', i);
      if (end === -1) throw new XmlParseError('Unterminated CDATA section', line, column);
      const text = src.slice(i + 9, end);
      stack[stack.length - 1]?.children.push({ type: 'text', text, line });
      advance(end + 3 - i);
      continue;
    }
    if (src.startsWith('</', i)) {
      const end = src.indexOf('>', i);
      if (end === -1) throw new XmlParseError('Unterminated closing tag', line, column);
      const name = src.slice(i + 2, end).trim();
      const open = stack.pop();
      if (!open) throw new XmlParseError(`Unexpected closing tag </${name}>`, line, column);
      if (open.name !== name) {
        throw new XmlParseError(`Closing tag </${name}> does not match <${open.name}>`, line, column);
      }
      advance(end + 1 - i);
      continue;
    }
    if (src[i] === '<') {
      const end = findTagEnd(src, i);
      if (end === -1) throw new XmlParseError('Unterminated tag', line, column);
      const body = src.slice(i + 1, end);
      const selfClosing = body.trimEnd().endsWith('/');
      const inner = selfClosing ? body.trimEnd().slice(0, -1) : body;
      const nameMatch = /^([A-Za-z_][\w.:-]*)/.exec(inner.trim());
      if (!nameMatch) throw new XmlParseError('Malformed tag name', line, column);
      const name = nameMatch[1]!;
      const el: XmlElement = {
        type: 'element',
        name,
        attrs: parseAttributes(inner.slice(inner.indexOf(name) + name.length)),
        children: [],
        line,
      };
      if (stack.length === 0) {
        if (root) throw new XmlParseError('Multiple root elements', line, column);
        root = el;
      } else {
        stack[stack.length - 1]!.children.push(el);
      }
      if (!selfClosing) stack.push(el);
      advance(end + 1 - i);
      continue;
    }

    const next = src.indexOf('<', i);
    const stop = next === -1 ? src.length : next;
    const text = src.slice(i, stop);
    if (stack.length > 0) {
      stack[stack.length - 1]!.children.push({ type: 'text', text: decodeEntities(text), line });
    }
    advance(stop - i);
  }

  if (stack.length) {
    const open = stack[stack.length - 1]!;
    throw new XmlParseError(`Element <${open.name}> is never closed`, open.line, 1);
  }
  if (!root) throw new XmlParseError('Document has no root element', 1, 1);
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

function parseAttributes(input: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([A-Za-z_][\w.:-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    attrs[m[1]!] = decodeEntities(m[3] ?? m[4] ?? '');
  }
  return attrs;
}

/* -------------------------------- helpers -------------------------------- */

export function childElements(el: XmlElement, name?: string): XmlElement[] {
  return el.children.filter(
    (c): c is XmlElement => c.type === 'element' && (!name || c.name === name),
  );
}

export function firstChild(el: XmlElement, name: string): XmlElement | undefined {
  return childElements(el, name)[0];
}

export function textContent(node: XmlNode): string {
  if (node.type === 'text') return node.text;
  return node.children.map(textContent).join('');
}

export function escapeXml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
