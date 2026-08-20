import { notFound, redirect } from 'next/navigation';
import { db } from '#src/db/index.ts';
import { groups } from '#src/db/schema.ts';
import { isAppError } from '#src/domain/errors.ts';
import { AppBar } from '#src/components/AppBar.tsx';
import { DraftNav } from '#src/components/DraftNav.tsx';
import { SettingsForm } from '#src/components/SettingsForm.tsx';
import { getActor } from '#src/services/auth.ts';
import { getDocumentContext, groupRelations, listRelations } from '#src/services/documents.ts';
import { canEditDraft } from '#src/services/rbac.ts';

export const dynamic = 'force-dynamic';

export default async function SettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const actor = await getActor();
  if (!actor) redirect(`/login?next=/drafts/${slug}/settings`);

  let context;
  try {
    context = await getDocumentContext(decodeURIComponent(slug), actor);
  } catch (err) {
    if (isAppError(err) && err.code === 'not_found') notFound();
    throw err;
  }

  const doc = context.document;
  const groupRows = await db.select().from(groups);
  const relations = groupRelations(await listRelations(doc.id));

  return (
    <>
      <AppBar actor={actor} />
      <div className="dl-app">
        <DraftNav slug={doc.slug} title={doc.title} status={doc.status} active="settings" />

        <SettingsForm
          slug={doc.slug}
          title={doc.title}
          abstract={doc.abstract ?? ''}
          visibility={doc.visibility}
          intendedStatus={doc.intendedStatus ?? 'standards-track'}
          type={doc.type}
          groupSlug={context.group?.slug ?? ''}
          groups={groupRows.map((g) => ({ slug: g.slug, name: g.name }))}
          canEdit={canEditDraft(actor, context.acl)}
        />

        <section className="dl-card">
          <h2>Access</h2>
          <dl>
            <div className="dl-info-row">
              <dt>Owner</dt>
              <dd>{context.owner?.displayName ?? '—'}</dd>
            </div>
            <div className="dl-info-row">
              <dt>Authors</dt>
              <dd>{context.authors.filter((a) => a.role === 'author').map((a) => a.displayName).join(', ') || '—'}</dd>
            </div>
            <div className="dl-info-row">
              <dt>Editors</dt>
              <dd>{context.authors.filter((a) => a.role === 'editor').map((a) => a.displayName).join(', ') || '—'}</dd>
            </div>
            <div className="dl-info-row">
              <dt>Namespace</dt>
              <dd>{context.namespace?.label ?? '—'}</dd>
            </div>
            <div className="dl-info-row">
              <dt>Licence profile</dt>
              <dd>{context.license?.name ?? '—'}</dd>
            </div>
          </dl>
        </section>

        <section className="dl-card">
          <h2>Relations</h2>
          <ul>
            {[
              ['updates', relations.updates],
              ['obsoletes', relations.obsoletes],
              ['replaces', relations.replaces],
              ['derived-from', relations.derivedFrom],
              ['normative-reference', relations.normativeReferences],
            ].map(([label, list]) => (
              <li key={label as string}>
                <code className="dl-mono">{label as string}</code>:{' '}
                {(list as typeof relations.updates).length
                  ? (list as typeof relations.updates).map((r) => r.targetSlug).join(', ')
                  : '—'}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
