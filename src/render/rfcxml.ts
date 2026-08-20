import type { Block, Inline, ParsedDocument, SectionNode } from '#src/parser/index.ts';
import { escapeXml } from '#src/parser/xml.ts';

/**
 * Normalized RFCXML emitter. Publishing always produces this artifact, so a
 * Markdown-authored document and an RFCXML-authored one converge on one
 * machine-readable representation. The conversion is deterministic; the parser
 * and renderer versions are recorded on the revision.
 */

export interface RfcXmlContext {
  documentNumber: string;
  docName: string;
  category: string;
  ipr: string;
  date: { year: string; month: string; day?: string };
  authors: Array<{ name: string; initials?: string; surname?: string; organization?: string; email?: string }>;
  organization: string;
}

export function renderRfcXml(doc: ParsedDocument, ctx: RfcXmlContext): string {
  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="utf-8"?>');
  out.push(
    `<rfc version="3" docName="${escapeXml(ctx.docName)}" number="${escapeXml(ctx.documentNumber)}" ` +
      `category="${escapeXml(ctx.category)}" ipr="${escapeXml(ctx.ipr)}" submissionType="independent">`,
  );

  out.push('  <front>');
  out.push(`    <title>${escapeXml(doc.meta.title)}</title>`);
  out.push(`    <seriesInfo name="${escapeXml(ctx.organization)}" value="${escapeXml(ctx.documentNumber)}"/>`);
  for (const a of ctx.authors) {
    const attrs = [
      `fullname="${escapeXml(a.name)}"`,
      a.initials ? `initials="${escapeXml(a.initials)}"` : '',
      a.surname ? `surname="${escapeXml(a.surname)}"` : '',
    ]
      .filter(Boolean)
      .join(' ');
    out.push(`    <author ${attrs}>`);
    if (a.organization) out.push(`      <organization>${escapeXml(a.organization)}</organization>`);
    if (a.email) {
      out.push('      <address><email>' + escapeXml(a.email) + '</email></address>');
    }
    out.push('    </author>');
  }
  out.push(
    `    <date year="${escapeXml(ctx.date.year)}" month="${escapeXml(ctx.date.month)}"` +
      (ctx.date.day ? ` day="${escapeXml(ctx.date.day)}"` : '') +
      '/>',
  );
  for (const kw of doc.meta.keywords) out.push(`    <keyword>${escapeXml(kw)}</keyword>`);
  if (doc.abstract.length) {
    out.push('    <abstract>');
    out.push(blocksToXml(doc.abstract, 6));
    out.push('    </abstract>');
  }
  out.push('  </front>');

  const body = doc.sections.filter((s) => !s.isAppendix && !/references$/i.test(s.title));
  const refs = doc.sections.filter((s) => /references$/i.test(s.title));
  const appendices = doc.sections.filter((s) => s.isAppendix);

  out.push('  <middle>');
  for (const s of body) out.push(sectionToXml(s, 4));
  out.push('  </middle>');

  out.push('  <back>');
  for (const group of refs) {
    out.push(`    <references><name>${escapeXml(group.title)}</name>`);
    for (const ref of doc.references.filter((r) => r.normative === !/informative/i.test(group.title))) {
      out.push(`      <reference anchor="${escapeXml(ref.key)}"${ref.targetUrl ? ` target="${escapeXml(ref.targetUrl)}"` : ''}>`);
      out.push(`        <front><title>${escapeXml(ref.text)}</title></front>`);
      if (ref.targetSlug) {
        out.push(`        <seriesInfo name="${escapeXml(ctx.organization)}" value="${escapeXml(ref.targetSlug)}"/>`);
      }
      out.push('      </reference>');
    }
    out.push('    </references>');
  }
  for (const s of appendices) out.push(sectionToXml(s, 4));
  out.push('  </back>');
  out.push('</rfc>');
  return out.join('\n');
}

function sectionToXml(section: SectionNode, indent: number): string {
  const pad = ' '.repeat(indent);
  const lines: string[] = [];
  lines.push(`${pad}<section anchor="${escapeXml(section.anchor)}"${section.numbered ? '' : ' numbered="false"'}>`);
  lines.push(`${pad}  <name>${escapeXml(section.title)}</name>`);
  lines.push(blocksToXml(section.blocks, indent + 2));
  for (const child of section.children) lines.push(sectionToXml(child, indent + 2));
  lines.push(`${pad}</section>`);
  return lines.filter((l) => l.trim()).join('\n');
}

function blocksToXml(blocks: Block[], indent: number): string {
  const pad = ' '.repeat(indent);
  const out: string[] = [];
  for (const block of blocks) {
    switch (block.kind) {
      case 'paragraph':
        out.push(`${pad}<t>${inlinesToXml(block.inlines)}</t>`);
        break;
      case 'artwork':
        out.push(
          block.language
            ? `${pad}<sourcecode type="${escapeXml(block.language)}"${block.name ? ` name="${escapeXml(block.name)}"` : ''}><![CDATA[\n${block.text}\n]]></sourcecode>`
            : `${pad}<artwork${block.name ? ` name="${escapeXml(block.name)}"` : ''}><![CDATA[\n${block.text}\n]]></artwork>`,
        );
        break;
      case 'list': {
        const tag = block.ordered ? 'ol' : 'ul';
        out.push(`${pad}<${tag}${block.ordered && block.start ? ` start="${block.start}"` : ''}>`);
        for (const item of block.items) {
          out.push(`${pad}  <li>`);
          out.push(blocksToXml(item, indent + 4));
          out.push(`${pad}  </li>`);
        }
        out.push(`${pad}</${tag}>`);
        break;
      }
      case 'deflist':
        out.push(`${pad}<dl>`);
        for (const item of block.items) {
          out.push(`${pad}  <dt>${escapeXml(item.term)}</dt>`);
          out.push(`${pad}  <dd>`);
          out.push(blocksToXml(item.blocks, indent + 4));
          out.push(`${pad}  </dd>`);
        }
        out.push(`${pad}</dl>`);
        break;
      case 'table': {
        out.push(`${pad}<table>`);
        if (block.caption) out.push(`${pad}  <name>${escapeXml(block.caption)}</name>`);
        if (block.head.length) {
          out.push(`${pad}  <thead><tr>${block.head.map((c) => `<th>${inlinesToXml(c)}</th>`).join('')}</tr></thead>`);
        }
        out.push(
          `${pad}  <tbody>${block.rows
            .map((r) => `<tr>${r.map((c) => `<td>${inlinesToXml(c)}</td>`).join('')}</tr>`)
            .join('')}</tbody>`,
        );
        out.push(`${pad}</table>`);
        break;
      }
      case 'note':
        out.push(`${pad}<aside><name>${escapeXml(block.label)}</name>`);
        out.push(blocksToXml(block.blocks, indent + 2));
        out.push(`${pad}</aside>`);
        break;
      case 'blockquote':
        out.push(`${pad}<blockquote>`);
        out.push(blocksToXml(block.blocks, indent + 2));
        out.push(`${pad}</blockquote>`);
        break;
    }
  }
  return out.filter((l) => l.trim()).join('\n');
}

function inlinesToXml(inlines: Inline[]): string {
  return inlines
    .map((i) => {
      switch (i.kind) {
        case 'text':
          return escapeXml(i.text);
        case 'code':
          return `<tt>${escapeXml(i.text)}</tt>`;
        case 'strong':
          return `<strong>${inlinesToXml(i.children)}</strong>`;
        case 'em':
          return `<em>${inlinesToXml(i.children)}</em>`;
        case 'keyword':
          return `<bcp14>${escapeXml(i.text)}</bcp14>`;
        case 'xref':
          return `<xref target="${escapeXml(i.target)}">${escapeXml(i.text)}</xref>`;
        case 'citation':
          return `<xref target="${escapeXml(i.key)}"/>`;
        case 'link':
          return `<eref target="${escapeXml(i.href)}">${escapeXml(i.text)}</eref>`;
        case 'mailto':
          return `<eref target="mailto:${escapeXml(i.address)}">${escapeXml(i.text)}</eref>`;
      }
    })
    .join('');
}
