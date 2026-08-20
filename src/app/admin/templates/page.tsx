import { redirect } from 'next/navigation';
import { asc } from 'drizzle-orm';
import { db } from '#src/db/index.ts';
import { templates } from '#src/db/schema.ts';
import { AppBar } from '#src/components/AppBar.tsx';
import { AdminNav } from '#src/components/AdminNav.tsx';
import { TemplateEditor } from '#src/components/TemplateEditor.tsx';
import { getActor } from '#src/services/auth.ts';
import { isAdmin } from '#src/services/rbac.ts';

export const dynamic = 'force-dynamic';

export default async function TemplatesPage() {
  const actor = await getActor();
  if (!actor) redirect('/login?next=/admin/templates');
  if (!isAdmin(actor)) {
    return (
      <>
        <AppBar actor={actor} />
        <div className="dl-app">
          <p className="dl-error">Admin role required.</p>
        </div>
      </>
    );
  }

  const rows = await db.select().from(templates).orderBy(asc(templates.name));

  return (
    <>
      <AppBar actor={actor} />
      <div className="dl-app">
        <AdminNav active="templates" />
        <h1 className="dl-page-title">Document templates</h1>
        <p className="dl-page-subtitle">
          Skeletons offered in the creation wizard. A template seeds the source of a new draft and is
          not consulted afterwards, so editing one never changes an existing document.
        </p>

        <TemplateEditor
          templates={rows.map((t) => ({
            id: t.id,
            key: t.key,
            name: t.name,
            description: t.description,
            canonicalFormat: t.canonicalFormat,
            body: t.body,
          }))}
        />
      </div>
    </>
  );
}
