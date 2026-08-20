import { NORMATIVE_KEYWORDS, type Inline } from './model.ts';

/**
 * Inline parser for RFC-flavoured Markdown. Deliberately small and explicit:
 * every construct maps onto one Inline node, and unknown syntax stays literal
 * text rather than becoming HTML.
 */

const KEYWORD_RE = new RegExp(`\\b(${NORMATIVE_KEYWORDS.join('|')})\\b`, 'g');

interface InlineOptions {
  /** When false, MUST/SHOULD are left as plain text (headings, table heads). */
  markKeywords?: boolean;
}

export function parseInlines(raw: string, opts: InlineOptions = {}): Inline[] {
  const markKeywords = opts.markKeywords !== false;
  const out: Inline[] = [];
  let buf = '';

  const flush = () => {
    if (!buf) return;
    if (markKeywords) out.push(...splitKeywords(buf));
    else out.push({ kind: 'text', text: buf });
    buf = '';
  };

  let i = 0;
  while (i < raw.length) {
    const rest = raw.slice(i);
    const ch = raw[i]!;

    // Escaped character
    if (ch === '\\' && i + 1 < raw.length) {
      buf += raw[i + 1];
      i += 2;
      continue;
    }

    // `code span`
    if (ch === '`') {
      const end = raw.indexOf('`', i + 1);
      if (end !== -1) {
        flush();
        out.push({ kind: 'code', text: raw.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    // {{anchor}} or {{anchor|label}} cross reference
    if (rest.startsWith('{{')) {
      const end = rest.indexOf('}}');
      if (end !== -1) {
        const body = rest.slice(2, end);
        const [target, label] = body.split('|');
        flush();
        out.push({
          kind: 'xref',
          target: (target ?? '').trim(),
          text: (label ?? target ?? '').trim(),
        });
        i += end + 2;
        continue;
      }
    }

    // **strong**
    if (rest.startsWith('**')) {
      const end = rest.indexOf('**', 2);
      if (end !== -1) {
        flush();
        out.push({ kind: 'strong', children: parseInlines(rest.slice(2, end), opts) });
        i += end + 2;
        continue;
      }
    }

    // *emphasis*
    if (ch === '*') {
      const end = raw.indexOf('*', i + 1);
      if (end !== -1 && end > i + 1) {
        flush();
        out.push({ kind: 'em', children: parseInlines(raw.slice(i + 1, end), opts) });
        i = end + 1;
        continue;
      }
    }

    // [text](href)
    if (ch === '[') {
      const close = findClosingBracket(raw, i);
      if (close !== -1 && raw[close + 1] === '(') {
        const parenEnd = raw.indexOf(')', close + 2);
        if (parenEnd !== -1) {
          const text = raw.slice(i + 1, close);
          const href = raw.slice(close + 2, parenEnd).trim();
          flush();
          out.push(linkNode(href, text));
          i = parenEnd + 1;
          continue;
        }
      }
      // [CITATION-KEY]
      if (close !== -1) {
        const key = raw.slice(i + 1, close);
        if (/^[A-Za-z][A-Za-z0-9._-]*$/.test(key)) {
          flush();
          out.push({ kind: 'citation', key });
          i = close + 1;
          continue;
        }
      }
    }

    // <https://…> / <mailto:…> / <user@example.invalid>
    if (ch === '<') {
      const end = raw.indexOf('>', i + 1);
      if (end !== -1) {
        const body = raw.slice(i + 1, end);
        if (/^(https?:\/\/|mailto:)/i.test(body) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body)) {
          flush();
          out.push(linkNode(body, body.replace(/^mailto:/i, '')));
          i = end + 1;
          continue;
        }
      }
    }

    // Bare URL
    if (rest.startsWith('http://') || rest.startsWith('https://')) {
      const m = /^https?:\/\/[^\s<>()"']+/.exec(rest);
      if (m) {
        flush();
        out.push(linkNode(m[0], m[0]));
        i += m[0].length;
        continue;
      }
    }

    buf += ch;
    i += 1;
  }

  flush();
  return out;
}

function findClosingBracket(raw: string, start: number): number {
  let depth = 0;
  for (let i = start; i < raw.length; i += 1) {
    if (raw[i] === '\\') {
      i += 1;
      continue;
    }
    if (raw[i] === '[') depth += 1;
    else if (raw[i] === ']') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Only http(s) and mailto survive; anything else degrades to literal text. */
function linkNode(href: string, text: string): Inline {
  const trimmed = href.trim();
  if (/^mailto:/i.test(trimmed)) {
    return { kind: 'mailto', address: trimmed.slice(7), text: text || trimmed.slice(7) };
  }
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return { kind: 'mailto', address: trimmed, text: text || trimmed };
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return { kind: 'link', href: trimmed, text: text || trimmed };
  }
  if (trimmed.startsWith('#')) {
    return { kind: 'xref', target: trimmed.slice(1), text: text || trimmed };
  }
  return { kind: 'text', text: text || trimmed };
}

function splitKeywords(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  KEYWORD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = KEYWORD_RE.exec(text)) !== null) {
    if (m.index > last) out.push({ kind: 'text', text: text.slice(last, m.index) });
    out.push({ kind: 'keyword', text: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out.length ? out : [{ kind: 'text', text }];
}

/** Collects every normative keyword occurrence for consistency diagnostics. */
export function countKeywords(text: string): Record<string, number> {
  const counts: Record<string, number> = {};
  KEYWORD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = KEYWORD_RE.exec(text)) !== null) {
    counts[m[0]] = (counts[m[0]] ?? 0) + 1;
  }
  return counts;
}
