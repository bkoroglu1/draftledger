import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db } from '#src/db/index.ts';
import { iprDisclosures } from '#src/db/schema.ts';
import { isAppError } from '#src/domain/errors.ts';
import { config } from '#src/lib/config.ts';
import { AppBar } from '#src/components/AppBar.tsx';
import { getActor } from '#src/services/auth.ts';
import { getDocumentContext } from '#src/services/documents.ts';

export const dynamic = 'force-dynamic';

export default async function IprPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const actor = await getActor();

  let context;
  try {
    context = await getDocumentContext(decodeURIComponent(slug), actor);
  } catch (err) {
    if (isAppError(err) && err.code === 'not_found') notFound();
    throw err;
  }

  const doc = context.document;
  const rows = await db.select().from(iprDisclosures).where(eq(iprDisclosures.documentId, doc.id));

  return (
    <>
      <AppBar actor={actor} />
      <div className="dl-app">
        <h1 className="dl-page-title">IPR disclosures — {doc.title}</h1>
        <p className="dl-page-subtitle">
          {doc.documentNumber ?? doc.slug} · <Link href={`/doc/${doc.slug}`}>Back to status</Link>
        </p>

        {rows.length ? (
          rows.map((row) => (
            <section className="dl-card" key={row.id}>
              <h2>{row.title}</h2>
              <p className="dl-muted">
                Holder: {row.holder} · Origin: {row.origin}
                {row.disclosedAt ? ` · Disclosed ${row.disclosedAt.toISOString().slice(0, 10)}` : ''}
              </p>
              <p>{row.statement}</p>
              {row.externalUrl ? (
                <p>
                  <a href={row.externalUrl} rel="noopener noreferrer nofollow" target="_blank">
                    Upstream disclosure record (external)
                  </a>
                </p>
              ) : null}
            </section>
          ))
        ) : (
          <p className="dl-notice">
            No local disclosure records exist for this document.
            {doc.origin !== 'local'
              ? ' This document was imported; upstream disclosure state is not mirrored.'
              : ''}
          </p>
        )}

        <p className="dl-muted" style={{ fontSize: '0.8125rem' }}>
          Disclosure policy is configured per installation. {config.app.orgName} owns these records;
          they are not synchronised with any external register.
        </p>
      </div>
    </>
  );
}
