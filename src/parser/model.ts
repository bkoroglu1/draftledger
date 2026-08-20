/**
 * Normalized document tree. Both the Markdown and the RFCXML front-ends produce
 * this model, and every renderer consumes it, so a document renders identically
 * no matter which canonical authoring format it was written in.
 */

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'strong'; children: Inline[] }
  | { kind: 'em'; children: Inline[] }
  /** Normative keyword (MUST, SHOULD, MAY …) — highlighted, never reflowed. */
  | { kind: 'keyword'; text: string }
  /** Cross-reference to an anchor inside this document. */
  | { kind: 'xref'; target: string; text: string }
  /** Bibliographic citation such as [EXAMPLE-KEY]. */
  | { kind: 'citation'; key: string }
  | { kind: 'link'; href: string; text: string }
  | { kind: 'mailto'; address: string; text: string };

export type Block =
  | { kind: 'paragraph'; inlines: Inline[] }
  /** Preformatted region: whitespace is significant and never reflowed. */
  | { kind: 'artwork'; text: string; language?: string; name?: string }
  | { kind: 'list'; ordered: boolean; start?: number; items: Block[][] }
  | { kind: 'deflist'; items: Array<{ term: string; blocks: Block[] }> }
  | {
      kind: 'table';
      align: Array<'left' | 'center' | 'right'>;
      head: Inline[][];
      rows: Inline[][][];
      caption?: string;
    }
  | { kind: 'note'; label: string; blocks: Block[] }
  | { kind: 'blockquote'; blocks: Block[] };

export interface SectionNode {
  /** "1", "4.1.2", "A", "A.1"; null for unnumbered sections. */
  number: string | null;
  title: string;
  /** 1-based nesting level. */
  depth: number;
  /** Stable anchor: section-4.1.2 / appendix-a / slug for unnumbered. */
  anchor: string;
  isAppendix: boolean;
  numbered: boolean;
  blocks: Block[];
  children: SectionNode[];
  /** 1-based inclusive line range in the canonical source. */
  sourceStart: number;
  sourceEnd: number;
  /** Filled in by the paginator. */
  pageNumber?: number;
}

export interface ReferenceEntry {
  key: string;
  /** Rendered bibliographic line. */
  text: string;
  normative: boolean;
  /** Local document slug when the citation resolves inside this installation. */
  targetSlug?: string;
  targetUrl?: string;
  anchor: string;
}

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export interface Diagnostic {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  line?: number;
  column?: number;
  hint?: string;
}

export interface DocumentMeta {
  title: string;
  abstract: string | null;
  /** Free-form front-matter carried through to metadata screens. */
  keywords: string[];
  raw: Record<string, string>;
}

export interface ParsedDocument {
  meta: DocumentMeta;
  /** Abstract as blocks so it renders through the same pipeline as body text. */
  abstract: Block[];
  sections: SectionNode[];
  references: ReferenceEntry[];
  diagnostics: Diagnostic[];
  /** anchor -> section summary, deterministic for a given source. */
  anchorIndex: Record<string, { number: string | null; title: string; depth: number }>;
  wordCount: number;
}

/** Normative keywords per the classic requirement-language convention. */
export const NORMATIVE_KEYWORDS = [
  'MUST NOT',
  'MUST',
  'SHALL NOT',
  'SHALL',
  'SHOULD NOT',
  'SHOULD',
  'NOT RECOMMENDED',
  'RECOMMENDED',
  'REQUIRED',
  'OPTIONAL',
  'MAY',
];

export function flattenSections(sections: SectionNode[]): SectionNode[] {
  const out: SectionNode[] = [];
  const walk = (list: SectionNode[]) => {
    for (const s of list) {
      out.push(s);
      walk(s.children);
    }
  };
  walk(sections);
  return out;
}

export function inlineText(inlines: Inline[]): string {
  return inlines
    .map((i) => {
      switch (i.kind) {
        case 'text':
        case 'code':
        case 'keyword':
          return i.text;
        case 'strong':
        case 'em':
          return inlineText(i.children);
        case 'xref':
          return i.text;
        case 'citation':
          return `[${i.key}]`;
        case 'link':
          return i.text;
        case 'mailto':
          return i.text;
      }
    })
    .join('');
}

export function blockText(blocks: Block[]): string {
  const parts: string[] = [];
  const walk = (list: Block[]) => {
    for (const b of list) {
      switch (b.kind) {
        case 'paragraph':
          parts.push(inlineText(b.inlines));
          break;
        case 'artwork':
          parts.push(b.text);
          break;
        case 'list':
          b.items.forEach(walk);
          break;
        case 'deflist':
          b.items.forEach((i) => {
            parts.push(i.term);
            walk(i.blocks);
          });
          break;
        case 'table':
          parts.push(b.head.map(inlineText).join(' '));
          b.rows.forEach((r) => parts.push(r.map(inlineText).join(' ')));
          break;
        case 'note':
        case 'blockquote':
          walk(b.blocks);
          break;
      }
    }
  };
  walk(blocks);
  return parts.join('\n');
}
