import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '#src/parser/index.ts';
import {
  PAGE_WIDTH,
  buildLinkContext,
  htmlizePlaintext,
  linkifyLine,
  renderPlaintext,
  renderRevision,
  sanitizeHtml,
  documentFromHtml,
  toPlaintextContext,
  type RenderContext,
} from '#src/render/index.ts';

const SOURCE = `---
title: Rendering Fixture Document
abbrev: Rendering Fixture
---

# Abstract

Fixture abstract text used by the renderer tests.

# Introduction

Cites [EXAMPLE-KEY] and refers to Section 2 and Appendix A. See
<https://example.invalid/spec> or mail ops@example.invalid.

# Grammar

\`\`\`abnf
value = 1*DIGIT      ; alignment    matters
\`\`\`

# Normative References

[EXAMPLE-KEY]  Example Org, "Referenced document", TEST-STD-0002, 2026.

# Appendix A: Notes

Appendix body.
`;

const CTX: RenderContext = {
  documentNumber: 'TEST-STD-0001',
  documentSlug: 'TEST-STD-0001',
  documentType: 'Standards Document',
  status: 'published',
  standardLevel: 'Standards Track',
  organization: 'Example Organization',
  brandName: 'Standards Vault',
  series: 'Example Standards Series',
  date: new Date('2026-08-18T00:00:00Z'),
  authors: [{ name: 'A. Author', organization: 'Example Organization' }],
  baseUrl: 'http://localhost:3000',
  knownDocuments: new Set(['TEST-STD-0002']),
};

describe('plaintext renderer', () => {
  const doc = parseMarkdown(SOURCE);
  const render = renderPlaintext(doc, toPlaintextContext(doc, CTX));

  it('paginates with page footers and form feeds', () => {
    expect(render.totalPages).toBeGreaterThanOrEqual(1);
    expect(render.text).toContain('[Page 1]');
    if (render.totalPages > 1) expect(render.text).toContain('\f');
  });

  it('keeps every rendered line within the page width where it can', () => {
    const overlong = render.pages
      .flatMap((p) => p.lines)
      .filter((line) => line.length > PAGE_WIDTH && !line.includes(';'));
    expect(overlong).toEqual([]);
  });

  it('never reflows artwork', () => {
    expect(render.text).toContain('value = 1*DIGIT      ; alignment    matters');
  });

  it('records an anchor position for every section', () => {
    expect(render.anchors['section-1']).toBeDefined();
    expect(render.anchors['appendix-a']).toBeDefined();
    expect(render.anchors['ref-example-key']).toBeDefined();
  });

  it('is deterministic for the same source', () => {
    const again = renderPlaintext(parseMarkdown(SOURCE), toPlaintextContext(doc, CTX));
    expect(again.text).toBe(render.text);
    expect(again.anchors).toEqual(render.anchors);
  });
});

describe('htmlization', () => {
  const doc = parseMarkdown(SOURCE);
  const plaintext = renderPlaintext(doc, toPlaintextContext(doc, CTX));
  const linkCtx = buildLinkContext(doc, plaintext, CTX, 'reference-section');
  const pages = htmlizePlaintext(plaintext, linkCtx);

  it('emits one pre block per page with a stable page anchor', () => {
    expect(pages).toHaveLength(plaintext.totalPages);
    expect(pages[0]!.html).toContain('id="page-1"');
    expect(pages[0]!.html.startsWith('<pre')).toBe(true);
  });

  it('does not change visible characters or line width', () => {
    const stripped = pages
      .map((p) =>
        p.html
          .replace(/^<pre[^>]*>/, '')
          .replace(/<\/pre>$/, '')
          .replace(/<span class="dl-sr-only">[^<]*<\/span>/g, '')
          .replace(/<[^>]+>/g, '')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/&amp;/g, '&'),
      )
      .join('');
    for (const line of plaintext.pages[0]!.lines) {
      if (line.trim()) expect(stripped).toContain(line);
    }
  });

  it('escapes html metacharacters in the source text', () => {
    const html = linkifyLine('<script>alert(1)</script> & "quoted"', linkCtx);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
  });

  it('links sections, pages, citations, urls and mail addresses', () => {
    const joined = pages.map((p) => p.html).join('');
    expect(joined).toContain('href="#section-2"');
    expect(joined).toContain('href="#page-1"');
    expect(joined).toContain('href="#ref-example-key"');
    expect(joined).toContain('https://example.invalid/spec');
    expect(joined).toContain('mailto:ops@example.invalid');
  });

  it('routes citations to the linked document when that preference is set', () => {
    const linked = buildLinkContext(doc, plaintext, CTX, 'linked-document');
    const html = htmlizePlaintext(plaintext, linked)
      .map((p) => p.html)
      .join('');
    expect(html).toContain('/doc/html/TEST-STD-0002');
  });

  it('never links a document to itself', () => {
    const joined = pages.map((p) => p.html).join('');
    expect(joined).not.toContain('href="/doc/html/TEST-STD-0001"');
  });
});

describe('artifact generation', () => {
  const result = renderRevision(SOURCE, 'markdown', CTX);

  it('produces txt, html, xml, source, bibtex and pdf artifacts', () => {
    expect(result.artifacts.map((a) => a.format).sort()).toEqual(
      ['bibtex', 'html', 'markdown', 'pdf', 'txt', 'xml'].sort(),
    );
  });

  it('produces a byte-identical result for the same input', () => {
    const again = renderRevision(SOURCE, 'markdown', CTX);
    expect(again.sourceSha256).toBe(result.sourceSha256);
    for (const [index, artifact] of result.artifacts.entries()) {
      expect(again.artifacts[index]!.data.equals(artifact.data)).toBe(true);
    }
  });

  it('emits a valid PDF header', () => {
    const pdf = result.artifacts.find((a) => a.format === 'pdf')!;
    expect(pdf.data.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.data.toString('latin1')).toContain('%%EOF');
  });

  it('records the section page map', () => {
    const intro = result.sections.find((s) => s.number === '1');
    expect(intro?.pageNumber).toBeGreaterThanOrEqual(1);
  });
});

describe('html sanitizer and plaintextify', () => {
  it('drops scripts, event handlers and javascript urls', () => {
    const dirty = `<div onclick="steal()"><script>alert(1)</script><a href="javascript:alert(2)">x</a><p>ok</p></div>`;
    const clean = sanitizeHtml(dirty);
    expect(clean).not.toContain('script');
    expect(clean).not.toContain('onclick');
    expect(clean).not.toContain('javascript:');
    expect(clean).toContain('<p>ok</p>');
  });

  it('keeps allowlisted markup and adds rel to external links', () => {
    const clean = sanitizeHtml('<a href="https://example.invalid">link</a>');
    expect(clean).toContain('rel="noopener noreferrer nofollow"');
  });

  it('converts sanitized html back into a document tree', () => {
    const rendered = renderRevision(SOURCE, 'markdown', CTX);
    const html = rendered.artifacts.find((a) => a.format === 'html')!.data.toString('utf8');
    const doc = documentFromHtml(sanitizeHtml(html));
    expect(doc.meta.title).toBe('Rendering Fixture Document');
    expect(doc.sections.length).toBeGreaterThan(0);
  });
});
