import { httpStatusFor, isAppError } from '#src/domain/errors.ts';
import { flattenSections } from '#src/parser/index.ts';
import { buildLinkContext, htmlizePlaintext, renderRevision } from '#src/render/index.ts';
import { requireActor } from '#src/services/auth.ts';
import { getDocumentContext } from '#src/services/documents.ts';
import { buildRenderContext } from '#src/services/revisions.ts';
import { requiredSectionDiagnostics } from '#src/parser/index.ts';
import { gateDefinitionsFor } from '#src/services/approvals.ts';
import { assertRead } from '#src/services/rbac.ts';

export const dynamic = 'force-dynamic';

/**
 * Live preview for the editor. Deliberately runs the *publishing* renderer, so
 * what an author sees is exactly what publication will produce — there is no
 * separate approximate preview path.
 */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const actor = await requireActor();
    const context = await getDocumentContext(decodeURIComponent(slug), actor);
    assertRead(actor, context.acl);

    const body = (await request.json()) as { source?: string };
    const source = typeof body.source === 'string' ? body.source : context.document.workingSource;

    const ctx = await buildRenderContext(context.document.id);
    const result = renderRevision(source, context.document.canonicalFormat, ctx);

    const gates = await gateDefinitionsFor(context.document.id);
    const required = gates.filter((g) => g.kind === 'required-sections').flatMap((g) => g.sections ?? []);
    const diagnostics = [...result.diagnostics, ...requiredSectionDiagnostics(result.doc, required)];

    const pages = htmlizePlaintext(
      result.plaintext,
      buildLinkContext(result.doc, result.plaintext, ctx, 'reference-section'),
    );

    return Response.json({
      pages: pages.map((p) => p.html),
      pageCount: result.pageCount,
      wordCount: result.wordCount,
      checksum: result.sourceSha256,
      outline: flattenSections(result.doc.sections).map((s) => ({
        anchor: s.anchor,
        number: s.number,
        title: s.title,
        depth: s.depth,
        line: s.sourceStart,
      })),
      references: result.doc.references.map((r) => ({ key: r.key, normative: r.normative })),
      diagnostics,
    });
  } catch (err) {
    return Response.json(
      isAppError(err) ? err.toJSON() : { error: 'internal', message: 'Preview failed' },
      { status: httpStatusFor(err) },
    );
  }
}
