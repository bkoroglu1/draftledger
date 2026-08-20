import { PARSER_VERSION, RENDERER_VERSION, type ArtifactFormat, type CanonicalFormat } from '#src/domain/types.ts';
import { flattenSections, parseSource, type Diagnostic, type ParsedDocument } from '#src/parser/index.ts';
import { sha256 } from '#src/lib/hash.ts';
import { renderBibtex } from './bibtex.ts';
import { renderSemanticHtml } from './html.ts';
import { htmlizePlaintext, type HtmlizedPage, type LinkContext } from './htmlize.ts';
import { renderPdf } from './pdf.ts';
import { renderPlaintext, type PlaintextContext, type PlaintextRender } from './plaintext.ts';
import { renderRfcXml } from './rfcxml.ts';

export * from './escape.ts';
export * from './plaintext.ts';
export * from './htmlize.ts';
export * from './html.ts';
export * from './sanitize.ts';
export * from './plaintextify.ts';
export { renderBibtex } from './bibtex.ts';
export { renderRfcXml } from './rfcxml.ts';
export { renderPdf } from './pdf.ts';

export interface RenderContext {
  documentNumber: string;
  documentSlug: string;
  documentType: string;
  status: string;
  standardLevel: string;
  organization: string;
  brandName: string;
  series: string;
  date: Date;
  authors: Array<{ name: string; organization?: string; email?: string }>;
  obsoletes?: string[];
  updates?: string[];
  baseUrl: string;
  /** Document identifiers already present locally, for link styling. */
  knownDocuments?: Set<string>;
}

export interface RenderedSection {
  number: string | null;
  title: string;
  depth: number;
  anchor: string;
  pageNumber: number;
  sourceStart: number;
  sourceEnd: number;
  sortOrder: number;
  parentAnchor: string | null;
}

export interface RenderedArtifact {
  format: ArtifactFormat;
  data: Buffer;
  mimeType: string;
}

export interface RenderResult {
  doc: ParsedDocument;
  plaintext: PlaintextRender;
  pages: HtmlizedPage[];
  sections: RenderedSection[];
  artifacts: RenderedArtifact[];
  diagnostics: Diagnostic[];
  wordCount: number;
  pageCount: number;
  sourceSha256: string;
  parserVersion: string;
  rendererVersion: string;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function renderRevision(
  source: string,
  format: CanonicalFormat,
  ctx: RenderContext,
): RenderResult {
  const doc = parseSource(source, format);
  const plaintextCtx = toPlaintextContext(doc, ctx);
  const plaintext = renderPlaintext(doc, plaintextCtx);

  const linkCtx = buildLinkContext(doc, plaintext, ctx, 'reference-section');
  const pages = htmlizePlaintext(plaintext, linkCtx);

  const html = renderSemanticHtml(doc, {
    documentNumber: ctx.documentNumber,
    status: ctx.status,
    date: formatDate(ctx.date),
    organization: ctx.organization,
    authors: ctx.authors,
    brandName: ctx.brandName,
  });

  const xml = renderRfcXml(doc, {
    documentNumber: ctx.documentNumber,
    docName: ctx.documentSlug,
    category: ctx.standardLevel,
    ipr: 'org-managed',
    date: {
      year: String(ctx.date.getUTCFullYear()),
      month: MONTHS[ctx.date.getUTCMonth()] ?? 'January',
      day: String(ctx.date.getUTCDate()),
    },
    authors: ctx.authors.map((a) => ({
      name: a.name,
      surname: a.name.split(/\s+/).pop(),
      initials: a.name
        .split(/\s+/)
        .slice(0, -1)
        .map((p) => `${p.charAt(0)}.`)
        .join(''),
      organization: a.organization,
      email: a.email,
    })),
    organization: ctx.series,
  });

  const bibtex = renderBibtex({
    documentNumber: ctx.documentNumber,
    title: doc.meta.title,
    authors: ctx.authors.map((a) => a.name),
    year: ctx.date.getUTCFullYear(),
    month: MONTHS[ctx.date.getUTCMonth()] ?? 'January',
    organization: ctx.organization,
    series: ctx.series,
    url: `${ctx.baseUrl}/doc/${ctx.documentSlug}`,
    abstract: doc.meta.abstract,
  });

  const pdf = renderPdf({
    title: doc.meta.title,
    documentNumber: ctx.documentNumber,
    pages: plaintext.pages,
  });

  const sourceFormat: ArtifactFormat = format === 'rfcxml' ? 'xml' : 'markdown';
  const allArtifacts: RenderedArtifact[] = [
    { format: 'txt', data: Buffer.from(plaintext.text, 'utf8'), mimeType: 'text/plain; charset=utf-8' },
    { format: 'html', data: Buffer.from(html, 'utf8'), mimeType: 'text/html; charset=utf-8' },
    { format: 'xml', data: Buffer.from(xml, 'utf8'), mimeType: 'application/rfc+xml; charset=utf-8' },
    {
      format: sourceFormat,
      data: Buffer.from(source, 'utf8'),
      mimeType:
        format === 'rfcxml' ? 'application/rfc+xml; charset=utf-8' : 'text/markdown; charset=utf-8',
    },
    { format: 'bibtex', data: Buffer.from(bibtex, 'utf8'), mimeType: 'application/x-bibtex; charset=utf-8' },
    { format: 'pdf', data: pdf, mimeType: 'application/pdf' },
  ];
  // The canonical source of an RFCXML document is already the xml artifact.
  const artifacts = allArtifacts.filter(
    (a, i, list) => list.findIndex((x) => x.format === a.format) === i,
  );

  return {
    doc,
    plaintext,
    pages,
    sections: toSectionRows(doc, plaintext),
    artifacts,
    diagnostics: doc.diagnostics,
    wordCount: doc.wordCount,
    pageCount: plaintext.totalPages,
    sourceSha256: sha256(source),
    parserVersion: PARSER_VERSION,
    rendererVersion: RENDERER_VERSION,
  };
}

export function toPlaintextContext(doc: ParsedDocument, ctx: RenderContext): PlaintextContext {
  const shortTitle = doc.meta.raw.abbrev || abbreviate(doc.meta.title);
  return {
    headerLeft: ctx.series,
    headerCenter: shortTitle,
    headerRight: formatDate(ctx.date),
    footerLeft: ctx.authors.map((a) => surname(a.name)).join(', ') || ctx.organization,
    footerCenter: ctx.standardLevel,
    documentNumber: ctx.documentNumber,
    documentType: ctx.documentType,
    organization: ctx.organization,
    authors: ctx.authors,
    date: formatDate(ctx.date),
    status: ctx.standardLevel,
    obsoletes: ctx.obsoletes,
    updates: ctx.updates,
  };
}

export function buildLinkContext(
  doc: ParsedDocument,
  plaintext: PlaintextRender,
  ctx: RenderContext,
  citationMode: 'reference-section' | 'linked-document',
): LinkContext {
  const references: LinkContext['references'] = {};
  for (const ref of doc.references) {
    references[ref.key] = {
      anchor: ref.anchor,
      targetSlug: ref.targetSlug,
      targetUrl: ref.targetUrl,
    };
  }
  const anchorLines: LinkContext['anchorLines'] = {};
  for (const [anchor, pos] of Object.entries(plaintext.anchors)) {
    anchorLines[anchor] = { page: pos.page, lineInPage: pos.lineInPage };
  }
  return {
    anchors: new Set(Object.keys(plaintext.anchors)),
    references,
    knownDocuments: ctx.knownDocuments ?? new Set<string>(),
    citationMode,
    readerPath: (slug) => `/doc/html/${encodeURIComponent(slug)}`,
    anchorLines,
    selfDocument: ctx.documentNumber,
  };
}

function toSectionRows(doc: ParsedDocument, plaintext: PlaintextRender): RenderedSection[] {
  const parentByAnchor = new Map<string, string | null>();
  const assign = (nodes: ReturnType<typeof flattenSections>, parent: string | null) => {
    for (const node of nodes) {
      parentByAnchor.set(node.anchor, parent);
      assign(node.children, node.anchor);
    }
  };
  assign(doc.sections, null);

  return flattenSections(doc.sections).map((s, index) => ({
    number: s.number,
    title: s.title,
    depth: s.depth,
    anchor: s.anchor,
    pageNumber: plaintext.anchors[s.anchor]?.page ?? 1,
    sourceStart: s.sourceStart,
    sourceEnd: s.sourceEnd,
    sortOrder: index,
    parentAnchor: parentByAnchor.get(s.anchor) ?? null,
  }));
}

export function formatDate(date: Date): string {
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function surname(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts[parts.length - 1] ?? name;
}

function abbreviate(title: string): string {
  if (title.length <= 40) return title;
  const words = title.split(/\s+/);
  const out: string[] = [];
  let length = 0;
  for (const w of words) {
    if (length + w.length + 1 > 38) break;
    out.push(w);
    length += w.length + 1;
  }
  return out.join(' ');
}
