import { escapeAttr, escapeHtml, safeHref } from './escape.ts';
import type { PlaintextRender } from './plaintext.ts';

/**
 * "HTMLize the plaintext": turns the canonical plaintext into one <pre> block
 * per page with stable page/section anchors and clickable references.
 *
 * Hard rules:
 *  - whitespace, newlines and indentation are preserved byte for byte;
 *  - linkification never changes a visible character or a line's width;
 *  - all text is escaped, and only <a>/<span> wrappers are introduced.
 */

export interface LinkContext {
  /** Anchors that exist in this revision (section-*, appendix-*, ref-*). */
  anchors: Set<string>;
  /** Citation key -> where the citation should point. */
  references: Record<string, { anchor: string; targetSlug?: string; targetUrl?: string }>;
  /** Document identifiers that already exist locally. */
  knownDocuments: Set<string>;
  /** `Go to reference section` vs `Go to linked document`. */
  citationMode: 'reference-section' | 'linked-document';
  /** Builds the internal reader path for a document identifier. */
  readerPath: (slug: string) => string;
  /** Anchor -> line index inside its page, so heading lines get an id. */
  anchorLines: Record<string, { page: number; lineInPage: number }>;
  /** This document's own identifier — never linked to itself. */
  selfDocument?: string;
}

export interface HtmlizedPage {
  number: number;
  html: string;
}

interface Match {
  start: number;
  end: number;
  render: (text: string) => string;
}

const SECTION_REF_RE = /\bSection\s+(\d+(?:\.\d+)*)\b/g;
const APPENDIX_REF_RE = /\bAppendix\s+([A-Z](?:\.\d+)*)\b/g;
const PAGE_REF_RE = /\[Page\s+(\d+)\]/g;
const CITATION_RE = /\[([A-Za-z][A-Za-z0-9._-]{1,60})\]/g;
const URL_RE = /https?:\/\/[^\s<>()"'\][]+/g;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const DOC_ID_RE = /\b([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d{3,5})\b/g;

export function htmlizePlaintext(render: PlaintextRender, ctx: LinkContext): HtmlizedPage[] {
  // page -> lineInPage -> anchors that start on that line
  const anchorsByLine = new Map<string, string[]>();
  for (const [anchor, pos] of Object.entries(ctx.anchorLines)) {
    if (anchor.startsWith('page-')) continue;
    const key = `${pos.page}:${pos.lineInPage}`;
    const list = anchorsByLine.get(key) ?? [];
    list.push(anchor);
    anchorsByLine.set(key, list);
  }

  return render.pages.map((page) => {
    const parts: string[] = [];
    parts.push(`<span class="dl-page-header">${linkifyLine(page.header, ctx)}</span>\n`);
    parts.push('\n');

    page.lines.forEach((line, idx) => {
      const anchors = anchorsByLine.get(`${page.number}:${idx}`) ?? [];
      const content = linkifyLine(line, ctx);
      if (anchors.length) {
        const ids = anchors
          .map((a, i) => (i === 0 ? '' : `<span id="${escapeAttr(a)}"></span>`))
          .join('');
        parts.push(
          `${ids}<span class="dl-heading" id="${escapeAttr(anchors[0]!)}">${content}</span>\n`,
        );
      } else {
        parts.push(`${content}\n`);
      }
    });

    parts.push('\n');
    parts.push(`<span class="dl-page-footer">${linkifyLine(page.footer, ctx)}</span>`);

    return {
      number: page.number,
      html:
        `<pre class="dl-page" id="page-${page.number}" data-page="${page.number}" ` +
        `aria-label="Page ${page.number}">${parts.join('')}</pre>`,
    };
  });
}

/**
 * Escapes one source line and wraps recognised tokens in anchors.
 * Returns HTML whose text content is identical to the input line.
 */
export function linkifyLine(line: string, ctx: LinkContext): string {
  const matches: Match[] = [];

  collect(line, PAGE_REF_RE, matches, (m) => {
    const page = m[1]!;
    return (text) => anchorHtml(`#page-${page}`, text, 'dl-link-page');
  });

  collect(line, SECTION_REF_RE, matches, (m) => {
    const anchor = `section-${m[1]}`;
    if (!ctx.anchors.has(anchor)) return null;
    return (text) => anchorHtml(`#${anchor}`, text, 'dl-link-section');
  });

  collect(line, APPENDIX_REF_RE, matches, (m) => {
    const anchor = `appendix-${m[1]!.toLowerCase()}`;
    if (!ctx.anchors.has(anchor)) return null;
    return (text) => anchorHtml(`#${anchor}`, text, 'dl-link-section');
  });

  collect(line, URL_RE, matches, (m) => {
    const href = safeHref(m[0]);
    if (!href) return null;
    return (text) => anchorHtml(href, text, 'dl-link-external', true);
  });

  collect(line, EMAIL_RE, matches, (m) => {
    const href = safeHref(`mailto:${m[0]}`);
    if (!href) return null;
    return (text) => anchorHtml(href, text, 'dl-link-mail');
  });

  collect(line, CITATION_RE, matches, (m) => {
    const key = m[1]!;
    if (/^Page$/i.test(key)) return null;
    const ref = ctx.references[key];
    if (!ref) return null;
    if (ctx.citationMode === 'linked-document' && ref.targetSlug) {
      return (text) => anchorHtml(ctx.readerPath(ref.targetSlug!), text, 'dl-link-citation');
    }
    if (ctx.anchors.has(ref.anchor)) {
      return (text) => anchorHtml(`#${ref.anchor}`, text, 'dl-link-citation');
    }
    if (ref.targetUrl) {
      const href = safeHref(ref.targetUrl);
      return href ? (text) => anchorHtml(href, text, 'dl-link-external', true) : null;
    }
    return null;
  });

  collect(line, DOC_ID_RE, matches, (m) => {
    const slug = m[1]!;
    if (slug === ctx.selfDocument) return null;
    return (text) =>
      anchorHtml(
        ctx.readerPath(slug),
        text,
        ctx.knownDocuments.has(slug) ? 'dl-link-doc' : 'dl-link-doc dl-link-unresolved',
      );
  });

  matches.sort((a, b) => a.start - b.start || b.end - a.end);

  const out: string[] = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.start < cursor) continue; // overlapping match: first one wins
    out.push(escapeHtml(line.slice(cursor, match.start)));
    out.push(match.render(escapeHtml(line.slice(match.start, match.end))));
    cursor = match.end;
  }
  out.push(escapeHtml(line.slice(cursor)));
  return out.join('');
}

function collect(
  line: string,
  re: RegExp,
  out: Match[],
  factory: (m: RegExpExecArray) => ((text: string) => string) | null,
): void {
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    const render = factory(m);
    if (!render) continue;
    out.push({ start: m.index, end: m.index + m[0].length, render });
  }
}

function anchorHtml(href: string, escapedText: string, cls: string, external = false): string {
  const rel = external ? ' rel="noopener noreferrer nofollow"' : '';
  const ext = external ? ' data-external="true"' : '';
  const sr = external ? '<span class="dl-sr-only"> (external link)</span>' : '';
  return `<a href="${escapeAttr(href)}" class="${cls}"${rel}${ext}>${escapedText}</a>${sr}`;
}
