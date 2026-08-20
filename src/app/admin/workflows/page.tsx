import { redirect } from 'next/navigation';
import { db } from '#src/db/index.ts';
import { workflows } from '#src/db/schema.ts';
import { AppBar } from '#src/components/AppBar.tsx';
import { AdminNav } from '#src/components/AdminNav.tsx';
import { getActor } from '#src/services/auth.ts';
import { isAdmin } from '#src/services/rbac.ts';

export const dynamic = 'force-dynamic';

export default async function WorkflowsPage() {
  const actor = await getActor();
  if (!actor) redirect('/login?next=/admin/workflows');
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

  const rows = await db.select().from(workflows);

  return (
    <>
      <AppBar actor={actor} />
      <div className="dl-app">
        <AdminNav active="workflows" />
        <h1 className="dl-page-title">Lifecycle &amp; approval gates</h1>
        <p className="dl-page-subtitle">
          States may be extended; the immutability of a published revision is not configurable.
        </p>
        {rows.map((workflow) => (
          <section className="dl-card" key={workflow.id}>
            <h2>{workflow.name}</h2>
            <p className="dl-muted">
              <code className="dl-mono">{workflow.key}</code>
            </p>
            <p>
              <strong>States:</strong> {workflow.states.join(' → ')}
            </p>
            <div className="dl-table-scroll">
              <table className="dl-table">
                <thead>
                  <tr>
                    <th scope="col">Gate</th>
                    <th scope="col">Kind</th>
                    <th scope="col">Required</th>
                    <th scope="col">Configuration</th>
                  </tr>
                </thead>
                <tbody>
                  {workflow.gates.map((gate) => (
                    <tr key={gate.key}>
                      <td>{gate.label}</td>
                      <td className="dl-mono">{gate.kind}</td>
                      <td>{gate.required ? 'yes' : 'advisory'}</td>
                      <td className="dl-mono" style={{ fontSize: '0.75rem' }}>
                        {[
                          gate.groupSlug ? `group=${gate.groupSlug}` : '',
                          gate.minApprovals ? `min=${gate.minApprovals}` : '',
                          gate.sections?.length ? `sections=${gate.sections.join('|')}` : '',
                        ]
                          .filter(Boolean)
                          .join(' ') || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
