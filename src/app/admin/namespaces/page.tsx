import { redirect } from 'next/navigation';
import { db } from '#src/db/index.ts';
import { namespaces, workflows } from '#src/db/schema.ts';
import { AppBar } from '#src/components/AppBar.tsx';
import { getActor } from '#src/services/auth.ts';
import { isAdmin } from '#src/services/rbac.ts';
import { AdminNav } from '#src/components/AdminNav.tsx';

export const dynamic = 'force-dynamic';

export default async function NamespacesPage() {
  const actor = await getActor();
  if (!actor) redirect('/login?next=/admin/namespaces');
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

  const rows = await db.select().from(namespaces);
  const workflowRows = await db.select().from(workflows);

  return (
    <>
      <AppBar actor={actor} />
      <div className="dl-app">
        <AdminNav active="namespaces" />
        <h1 className="dl-page-title">Namespaces &amp; numbering</h1>
        <p className="dl-page-subtitle">
          Document identity policy. Numbers are allocated atomically inside the publish transaction.
        </p>
        <div className="dl-table-scroll">
          <table className="dl-table">
            <thead>
              <tr>
                <th scope="col">Key</th>
                <th scope="col">Label</th>
                <th scope="col">Prefix</th>
                <th scope="col">Pattern</th>
                <th scope="col">Next sequence</th>
                <th scope="col">Draft prefix</th>
                <th scope="col">Workflow</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((ns) => (
                <tr key={ns.id}>
                  <td className="dl-mono">{ns.key}</td>
                  <td>{ns.label}</td>
                  <td className="dl-mono">{ns.prefix}</td>
                  <td className="dl-mono">{ns.numberPattern}</td>
                  <td>{ns.nextSequence}</td>
                  <td className="dl-mono">{ns.draftPrefix}</td>
                  <td>{workflowRows.find((w) => w.id === ns.workflowId)?.name ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="dl-notice">
          Namespaces are provisioned by migration or seed. Editing an allocated sequence by hand can
          produce duplicate identifiers, so it is deliberately not exposed as a form here.
        </p>
      </div>
    </>
  );
}
