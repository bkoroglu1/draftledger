import { redirect } from 'next/navigation';
import { AppBar } from '#src/components/AppBar.tsx';
import { AdminNav } from '#src/components/AdminNav.tsx';
import { TeamEditor } from '#src/components/TeamEditor.tsx';
import { getActor } from '#src/services/auth.ts';
import { listPeople } from '#src/services/people.ts';
import { isAdmin } from '#src/services/rbac.ts';
import { listTeams } from '#src/services/teams.ts';

export const dynamic = 'force-dynamic';

export default async function TeamsPage() {
  const actor = await getActor();
  if (!actor) redirect('/login?next=/admin/teams');
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

  const [teams, people] = await Promise.all([listTeams(), listPeople()]);

  return (
    <>
      <AppBar actor={actor} />
      <div className="dl-app">
        <AdminNav active="teams" />
        <h1 className="dl-page-title">Teams</h1>
        <p className="dl-page-subtitle">
          Working groups, projects and teams, their charters and their membership. A team role
          applies to that team&apos;s documents; organization roles apply everywhere.
        </p>
        <TeamEditor
          teams={teams}
          people={people
            .filter((p) => !p.isExternal && p.isActive)
            .map((p) => ({ id: p.id, displayName: p.displayName, handle: p.handle }))}
        />
      </div>
    </>
  );
}
