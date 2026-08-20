import { describe, expect, it } from 'vitest';
import { flattenSections, parseMarkdown, parseRfcXml, parseSource } from '#src/parser/index.ts';

const SAMPLE = `---
title: Example Structural Document
abbrev: Structural
---

# Abstract

An abstract with a MUST keyword.

# Introduction

Refers to {{section-2.1}} and cites [EXAMPLE-KEY].

# Body

## First Child

### Deep Child

#### Deeper Child

Text.

## Second Child

\`\`\`abnf
rule = 1*DIGIT   ; two   spaces   preserved
    indented = "x"
\`\`\`

| A | B |
|---|--:|
| 1 | 2 |

# Normative References

[EXAMPLE-KEY]  Example Org, "Referenced", TEST-STD-0002, 2026.

# Appendix A: Extra

Appendix text.
`;

describe('markdown parser', () => {
  const doc = parseMarkdown(SAMPLE);

  it('extracts title, abstract and keywords', () => {
    expect(doc.meta.title).toBe('Example Structural Document');
    expect(doc.meta.abstract).toContain('An abstract');
    expect(doc.abstract.length).toBeGreaterThan(0);
  });

  it('numbers sections and appendices separately', () => {
    const flat = flattenSections(doc.sections);
    const numbers = flat.map((s) => `${s.isAppendix ? 'A:' : ''}${s.number}`);
    expect(numbers).toContain('1');
    expect(numbers).toContain('2.1');
    expect(numbers).toContain('A:A');
  });

  it('supports at least four heading levels with stable anchors', () => {
    const flat = flattenSections(doc.sections);
    const deep = flat.find((s) => s.title === 'Deeper Child');
    expect(deep?.depth).toBe(4);
    expect(deep?.anchor).toBe('section-2.1.1.1');
  });

  it('produces the same anchors on a second parse', () => {
    const again = parseMarkdown(SAMPLE);
    expect(Object.keys(again.anchorIndex)).toEqual(Object.keys(doc.anchorIndex));
  });

  it('preserves artwork whitespace byte for byte', () => {
    const flat = flattenSections(doc.sections);
    const artwork = flat
      .flatMap((s) => s.blocks)
      .find((b) => b.kind === 'artwork');
    expect(artwork).toBeDefined();
    expect(artwork && artwork.kind === 'artwork' ? artwork.text : '').toBe(
      'rule = 1*DIGIT   ; two   spaces   preserved\n    indented = "x"',
    );
  });

  it('parses tables with alignment', () => {
    const table = flattenSections(doc.sections)
      .flatMap((s) => s.blocks)
      .find((b) => b.kind === 'table');
    expect(table && table.kind === 'table' ? table.align : []).toEqual(['left', 'right']);
  });

  it('collects references and resolves the citation', () => {
    expect(doc.references.map((r) => r.key)).toEqual(['EXAMPLE-KEY']);
    expect(doc.references[0]?.targetSlug).toBe('TEST-STD-0002');
    expect(doc.diagnostics.filter((d) => d.code === 'broken-citation')).toHaveLength(0);
  });

  it('rewrites bare cross references into readable labels', () => {
    const intro = flattenSections(doc.sections).find((s) => s.title === 'Introduction');
    const paragraph = intro?.blocks.find((b) => b.kind === 'paragraph');
    const xref =
      paragraph && paragraph.kind === 'paragraph'
        ? paragraph.inlines.find((i) => i.kind === 'xref')
        : undefined;
    expect(xref && xref.kind === 'xref' ? xref.text : '').toBe('Section 2.1');
  });
});

describe('markdown diagnostics', () => {
  it('reports broken cross references with a line and a hint', () => {
    const doc = parseMarkdown(`# One\n\nSee {{section-99}}.\n`);
    const diagnostic = doc.diagnostics.find((d) => d.code === 'broken-xref');
    expect(diagnostic).toBeDefined();
    expect(diagnostic?.severity).toBe('error');
    expect(diagnostic?.line).toBeGreaterThan(0);
    expect(diagnostic?.hint).toBeTruthy();
  });

  it('reports broken citations', () => {
    const doc = parseMarkdown(`# One\n\nSee [MISSING].\n`);
    expect(doc.diagnostics.some((d) => d.code === 'broken-citation')).toBe(true);
  });

  it('reports unterminated fences', () => {
    const doc = parseMarkdown('# One\n\n```\nunclosed\n');
    expect(doc.diagnostics.some((d) => d.code === 'unterminated-fence')).toBe(true);
  });

  it('rejects duplicate explicit anchors', () => {
    const doc = parseMarkdown('# One {#dup}\n\n# Two {#dup}\n');
    expect(doc.diagnostics.some((d) => d.code === 'duplicate-anchor')).toBe(true);
  });
});

describe('rfcxml parser', () => {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<rfc version="3" docName="example" category="std">
  <front>
    <title>XML Sourced Document</title>
    <abstract><t>Abstract text.</t></abstract>
  </front>
  <middle>
    <section anchor="section-1"><name>Introduction</name>
      <t>See <xref target="section-2">the next part</xref>.</t>
      <sourcecode type="abnf"><![CDATA[rule =  1*DIGIT]]></sourcecode>
    </section>
    <section anchor="section-2"><name>Body</name><t>Body text with <bcp14>MUST</bcp14>.</t></section>
  </middle>
  <back/>
</rfc>`;

  it('converts to the same normalized model', () => {
    const doc = parseRfcXml(xml);
    expect(doc.meta.title).toBe('XML Sourced Document');
    expect(flattenSections(doc.sections).map((s) => s.number)).toEqual(['1', '2']);
    expect(doc.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
  });

  it('rejects DOCTYPE declarations', () => {
    const doc = parseRfcXml('<!DOCTYPE rfc [<!ENTITY x "y">]><rfc/>');
    expect(doc.diagnostics[0]?.code).toBe('xml-parse-error');
  });

  it('reports malformed xml with a line and column', () => {
    const doc = parseSource('<rfc><front></rfc>', 'rfcxml');
    const diagnostic = doc.diagnostics[0];
    expect(diagnostic?.code).toBe('xml-parse-error');
    expect(diagnostic?.line).toBeGreaterThan(0);
    expect(diagnostic?.column).toBeGreaterThan(0);
  });
});
