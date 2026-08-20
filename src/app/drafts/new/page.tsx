import { redirect } from 'next/navigation';
import { db } from '#src/db/index.ts';
import { groups, licenseProfiles, namespaces, people, templates } from '#src/db/schema.ts';
import { AppBar } from '#src/components/AppBar.tsx';
import { NewDraftForm } from '#src/components/NewDraftForm.tsx';
import { getActor } from '#src/services/auth.ts';
import { searchDocuments } from '#src/services/documents.ts';
import { canCreateDraft } from '#src/services/rbac.ts';

export const dynamic = 'force-dynamic';

export default async function NewDraftPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; source?: string }>;
}) {
  const { mode, source } = await searchParams;
  const actor = await getActor();
  if (!actor) redirect('/login?next=/drafts/new');

  if (!canCreateDraft(actor)) {
    return (
      <>
        <AppBar actor={actor} />
        <div className="dl-app">
          <h1 className="dl-page-title">New document</h1>
          <p className="dl-error">Your role ({actor.orgRole}) cannot create documents.</p>
        </div>
      </>
    );
  }

  const [templateRows, namespaceRows, groupRows, licenseRows, peopleRows, existing] =
    await Promise.all([
      db.select().from(templates),
      db.select().from(namespaces),
      db.select().from(groups),
      db.select().from(licenseProfiles),
      db.select({ handle: people.handle, displayName: people.displayName }).from(people),
      searchDocuments({ limit: 200 }, actor),
    ]);

  return (
    <>
      <AppBar actor={actor} />
      <div className="dl-app">
        <h1 className="dl-page-title">New document</h1>
        <p className="dl-page-subtitle">
          A draft identifier is assigned now; the published number is allocated atomically at publish
          time.
        </p>
        <NewDraftForm
          defaultMode={(mode as string) ?? 'blank'}
          defaultSource={source ?? ''}
          actorHandle={actor.handle}
          templates={templateRows.map((t) => ({ key: t.key, name: t.name }))}
          namespaces={namespaceRows.map((n) => ({ key: n.key, label: n.label }))}
          groups={groupRows.map((g) => ({ slug: g.slug, name: g.name }))}
          licenses={licenseRows.map((l) => ({ key: l.key, name: l.name }))}
          people={peopleRows}
          documents={existing.items.map((d) => ({
            slug: d.slug,
            label: `${d.documentNumber ?? d.slug} — ${d.title}`,
          }))}
        />
      </div>
    </>
  );
}
