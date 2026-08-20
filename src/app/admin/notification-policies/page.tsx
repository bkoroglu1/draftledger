import { redirect } from 'next/navigation';
import { db } from '#src/db/index.ts';
import { documents } from '#src/db/schema.ts';
import { AppBar } from '#src/components/AppBar.tsx';
import { AdminNav } from '#src/components/AdminNav.tsx';
import { PolicyEditor } from '#src/components/PolicyEditor.tsx';
import { getActor } from '#src/services/auth.ts';
import { listEventCatalog, listPolicies } from '#src/services/notifications.ts';
import { isAdmin } from '#src/services/rbac.ts';
import { RECIPIENT_SELECTORS } from '#src/domain/types.ts';

export const dynamic = 'force-dynamic';

export default async function NotificationPoliciesPage() {
  const actor = await getActor();
  if (!actor) redirect('/login?next=/admin/notification-policies');
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

  const [catalog, policies, docs] = await Promise.all([
    listEventCatalog(),
    listPolicies(),
    db.select({ slug: documents.slug, title: documents.title }).from(documents).limit(200),
  ]);

  return (
    <>
      <AppBar actor={actor} />
      <div className="dl-app">
        <AdminNav active="notification-policies" />
        <h1 className="dl-page-title">Notification policies</h1>
        <p className="dl-page-subtitle">
          Event catalog, recipient selectors, precedence and previews. Saving creates a new policy
          version and an audit event; it never rewrites the previous one.
        </p>

        <PolicyEditor
          catalog={catalog}
          policies={policies.map((p) => ({
            id: p.id,
            scope: p.scope,
            scopeRef: p.scopeRef,
            eventKey: p.eventKey,
            channel: p.channel,
            enabled: p.enabled,
            precedence: p.precedence,
            to: p.toSelectors,
            cc: p.ccSelectors,
            suppress: p.suppressSelectors,
            version: p.version,
          }))}
          selectors={[...RECIPIENT_SELECTORS]}
          documents={docs}
        />
      </div>
    </>
  );
}
