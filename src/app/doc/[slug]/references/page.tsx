import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isAppError } from '#src/domain/errors.ts';
import { parseSource } from '#src/parser/index.ts';
import { AppBar } from '#src/components/AppBar.tsx';
import { getActor } from '#src/services/auth.ts';
import {
  currentReadableRevision,
  getDocumentContext,
  groupRelations,
  listRelations,
} from '#src/services/documents.ts';

export const dynamic = 'force-dynamic';

export default async function ReferencesPage({ params }: { params: Promise<{ slug: string }> }) {
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
  const revision = await currentReadableRevision(doc).catch(() => null);
  const parsed = revision ? parseSource(revision.source, revision.canonicalFormat) : null;
  const relations = groupRelations(await listRelations(doc.id));

  const normative = parsed?.references.filter((r) => r.normative) ?? [];
  const informative = parsed?.references.filter((r) => !r.normative) ?? [];

  return (
    <>
      <AppBar actor={actor} />
      <div className="dl-app">
        <h1 className="dl-page-title">References — {doc.title}</h1>
        <p className="dl-page-subtitle">
          {doc.documentNumber ?? doc.slug} · <Link href={`/doc/${doc.slug}`}>Back to status</Link>
        </p>

        <Section title="Normative references" entries={normative} />
        <Section title="Informative references" entries={informative} />

        <section className="dl-card">
          <h2>Declared relations</h2>
          {relations.normativeReferences.length || relations.informativeReferences.length ? (
            <ul>
              {[...relations.normativeReferences, ...relations.informativeReferences].map((r) => (
                <li key={`${r.type}-${r.targetSlug}`}>
                  <code className="dl-mono">{r.type}</code>{' '}
                  <Link href={`/doc/html/${r.targetSlug}`}>{r.targetNumber ?? r.targetSlug}</Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="dl-muted">No relation rows are recorded for this document.</p>
          )}
        </section>
      </div>
    </>
  );
}

function Section({
  title,
  entries,
}: {
  title: string;
  entries: Array<{ key: string; text: string; targetSlug?: string; targetUrl?: string; anchor: string }>;
}) {
  return (
    <section className="dl-card">
      <h2>{title}</h2>
      {entries.length ? (
        <dl>
          {entries.map((entry) => (
            <div key={entry.key} style={{ marginBottom: '0.6rem' }}>
              <dt className="dl-mono">
                <strong>[{entry.key}]</strong>
              </dt>
              <dd style={{ margin: '0 0 0 1rem' }}>
                {entry.text}
                <div style={{ fontSize: '0.8125rem' }}>
                  {entry.targetSlug ? (
                    <Link href={`/doc/html/${entry.targetSlug}`}>Open {entry.targetSlug}</Link>
                  ) : null}
                  {entry.targetUrl ? (
                    <>
                      {' '}
                      <a href={entry.targetUrl} rel="noopener noreferrer nofollow" target="_blank">
                        External source
                      </a>
                    </>
                  ) : null}
                </div>
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="dl-muted">None recorded in the current revision.</p>
      )}
    </section>
  );
}
