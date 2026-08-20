import { eq } from 'drizzle-orm';
import { db } from '#src/db/index.ts';
import { documentAuthors, people } from '#src/db/schema.ts';
import { httpStatusFor, isAppError } from '#src/domain/errors.ts';
import { config } from '#src/lib/config.ts';
import { renderBibtex } from '#src/render/bibtex.ts';
import { getActor } from '#src/services/auth.ts';
import { getDocumentContext } from '#src/services/documents.ts';

export const dynamic = 'force-dynamic';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** BibTeX generated from local metadata, served as text/plain for copy/paste. */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const actor = await getActor();
    const context = await getDocumentContext(decodeURIComponent(slug), actor);
    const doc = context.document;

    const authors = await db
      .select({ name: people.displayName })
      .from(documentAuthors)
      .innerJoin(people, eq(documentAuthors.personId, people.id))
      .where(eq(documentAuthors.documentId, doc.id))
      .orderBy(documentAuthors.position);

    const date = doc.publishedAt ?? doc.createdAt;
    const body = renderBibtex({
      documentNumber: doc.documentNumber ?? doc.slug,
      title: doc.title,
      authors: authors.map((a) => a.name),
      year: date.getUTCFullYear(),
      month: MONTHS[date.getUTCMonth()] ?? 'January',
      organization: config.app.orgName,
      series: context.namespace?.label ?? config.documents.defaultNamespace,
      url: `${config.app.baseUrl}/doc/${doc.slug}`,
      abstract: doc.abstract,
    });

    return new Response(body, {
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'content-disposition': `inline; filename="${doc.slug}.bib"`,
        'cache-control': 'no-store',
      },
    });
  } catch (err) {
    return Response.json(
      isAppError(err) ? err.toJSON() : { error: 'internal', message: 'Unexpected failure' },
      { status: httpStatusFor(err) },
    );
  }
}
