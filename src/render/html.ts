import type { Block, Inline, ParsedDocument, SectionNode } from '#src/parser/index.ts';
import { escapeAttr, escapeHtml, safeHref } from './escape.ts';

/**
 * Semantic HTML artifact generated from the document tree. This is the stored
 * `html` artifact — a structured, accessible rendering that is also the input
 * for the reader's "Plaintextify the HTML" mode.
 */

export interface HtmlRenderContext {
  documentNumber: string;
  status: string;
  date: string;
  organization: string;
  authors: Array<{ name: string; organization?: string }>;
  brandName: string;
}

export function renderSemanticHtml(doc: ParsedDocument, ctx: HtmlRenderContext): string {
  const parts: string[] = [];
  parts.push('<!DOCTYPE html>');
  parts.push('<html lang="en"><head><meta charset="utf-8">');
  parts.push(`<title>${escapeHtml(doc.meta.title)}</title>`);
  parts.push(`<meta name="dl-document-number" content="${escapeAttr(ctx.documentNumber)}">`);
  parts.push(`<meta name="dl-status" content="${escapeAttr(ctx.status)}">`);
  parts.push('</head><body>');
  parts.push('<article class="dl-document">');
  parts.push('<header class="dl-front">');
  parts.push(`<h1>${escapeHtml(doc.meta.title)}</h1>`);
  parts.push(
    `<p class="dl-identity">${escapeHtml(ctx.documentNumber)} — ${escapeHtml(ctx.status)} — ${escapeHtml(ctx.date)}</p>`,
  );
  parts.push(
    `<p class="dl-authors">${doc.meta.keywords.length ? '' : ''}${ctx.authors
      .map((a) => escapeHtml(a.organization ? `${a.name} (${a.organization})` : a.name))
      .join(', ')}</p>`,
  );
  parts.push('</header>');

  if (doc.abstract.length) {
    parts.push('<section id="section-abstract" class="dl-abstract"><h2>Abstract</h2>');
    parts.push(renderBlocks(doc.abstract));
    parts.push('</section>');
  }

  parts.push('<nav id="section-toc" class="dl-toc" aria-label="Table of contents">');
  parts.push('<h2>Table of Contents</h2>');
  parts.push(renderToc(doc.sections));
  parts.push('</nav>');

  for (const section of doc.sections) parts.push(renderSection(section));

  parts.push('</article></body></html>');
  return parts.join('\n');
}

function renderToc(sections: SectionNode[]): string {
  if (!sections.length) return '';
  const items = sections
    .map(
      (s) =>
        `<li><a href="#${escapeAttr(s.anchor)}">` +
        `${s.number ? `<span class="dl-toc-number">${escapeHtml(s.isAppendix ? `Appendix ${s.number}` : s.number)}.</span> ` : ''}` +
        `<span class="dl-toc-title">${escapeHtml(s.title)}</span></a>${renderToc(s.children)}</li>`,
    )
    .join('');
  return `<ul>${items}</ul>`;
}

function renderSection(section: SectionNode): string {
  const level = Math.min(6, section.depth + 1);
  const label = section.number
    ? `${section.isAppendix ? 'Appendix ' : ''}${section.number}. `
    : '';
  return [
    `<section id="${escapeAttr(section.anchor)}" class="dl-section" data-depth="${section.depth}">`,
    `<h${level}><a class="dl-permalink" href="#${escapeAttr(section.anchor)}" aria-label="Permalink to ${escapeAttr(section.title)}">#</a>${escapeHtml(label)}${escapeHtml(section.title)}</h${level}>`,
    renderBlocks(section.blocks),
    section.children.map(renderSection).join('\n'),
    '</section>',
  ].join('\n');
}

export function renderBlocks(blocks: Block[]): string {
  return blocks.map(renderBlock).join('\n');
}

function renderBlock(block: Block): string {
  switch (block.kind) {
    case 'paragraph':
      return `<p>${renderInlines(block.inlines)}</p>`;
    case 'artwork': {
      const cls = block.language ? ` class="language-${escapeAttr(block.language)}"` : '';
      const caption = block.name ? `<figcaption>${escapeHtml(block.name)}</figcaption>` : '';
      return `<figure class="dl-artwork">${caption}<pre${cls}>${escapeHtml(block.text)}</pre></figure>`;
    }
    case 'list': {
      const tag = block.ordered ? 'ol' : 'ul';
      const start = block.ordered && block.start && block.start !== 1 ? ` start="${block.start}"` : '';
      return `<${tag}${start}>${block.items.map((i) => `<li>${renderBlocks(i)}</li>`).join('')}</${tag}>`;
    }
    case 'deflist':
      return `<dl>${block.items
        .map((i) => `<dt>${escapeHtml(i.term)}</dt><dd>${renderBlocks(i.blocks)}</dd>`)
        .join('')}</dl>`;
    case 'table': {
      const head = block.head.length
        ? `<thead><tr>${block.head
            .map((c, i) => `<th scope="col" style="text-align:${block.align[i] ?? 'left'}">${renderInlines(c)}</th>`)
            .join('')}</tr></thead>`
        : '';
      const body = `<tbody>${block.rows
        .map(
          (r) =>
            `<tr>${r
              .map((c, i) => `<td style="text-align:${block.align[i] ?? 'left'}">${renderInlines(c)}</td>`)
              .join('')}</tr>`,
        )
        .join('')}</tbody>`;
      const caption = block.caption ? `<caption>${escapeHtml(block.caption)}</caption>` : '';
      return `<table class="dl-table">${caption}${head}${body}</table>`;
    }
    case 'note':
      return `<aside class="dl-note" role="note"><p class="dl-note-label">${escapeHtml(block.label)}</p>${renderBlocks(block.blocks)}</aside>`;
    case 'blockquote':
      return `<blockquote>${renderBlocks(block.blocks)}</blockquote>`;
  }
}

export function renderInlines(inlines: Inline[]): string {
  return inlines.map(renderInline).join('');
}

function renderInline(inline: Inline): string {
  switch (inline.kind) {
    case 'text':
      return escapeHtml(inline.text);
    case 'code':
      return `<code>${escapeHtml(inline.text)}</code>`;
    case 'strong':
      return `<strong>${renderInlines(inline.children)}</strong>`;
    case 'em':
      return `<em>${renderInlines(inline.children)}</em>`;
    case 'keyword':
      return `<span class="dl-keyword">${escapeHtml(inline.text)}</span>`;
    case 'xref':
      return `<a class="dl-xref" href="#${escapeAttr(inline.target)}">${escapeHtml(inline.text)}</a>`;
    case 'citation':
      return `<a class="dl-citation" href="#ref-${escapeAttr(inline.key.toLowerCase())}">[${escapeHtml(inline.key)}]</a>`;
    case 'link': {
      const href = safeHref(inline.href);
      if (!href) return escapeHtml(inline.text);
      return `<a class="dl-external" rel="noopener noreferrer nofollow" href="${escapeAttr(href)}">${escapeHtml(inline.text)}</a>`;
    }
    case 'mailto': {
      const href = safeHref(`mailto:${inline.address}`);
      if (!href) return escapeHtml(inline.text);
      return `<a class="dl-mail" href="${escapeAttr(href)}">${escapeHtml(inline.text)}</a>`;
    }
  }
}
