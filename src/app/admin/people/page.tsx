import { redirect } from 'next/navigation';
import { AppBar } from '#src/components/AppBar.tsx';
import { AdminNav } from '#src/components/AdminNav.tsx';
import { PeopleEditor } from '#src/components/PeopleEditor.tsx';
import { mailConfigured } from '#src/lib/mail.ts';
import { getActor } from '#src/services/auth.ts';
import { listPeople } from '#src/services/people.ts';
import { isAdmin } from '#src/services/rbac.ts';

export const dynamic = 'force-dynamic';

export default async function PeoplePage() {
  const actor = await getActor();
  if (!actor) redirect('/login?next=/admin/people');
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

  const people = await listPeople();

  return (
    <>
      <AppBar actor={actor} />
      <div className="dl-app">
        <AdminNav active="people" />
        <h1 className="dl-page-title">People</h1>
        <p className="dl-page-subtitle">
          Accounts, organization roles and credentials. A password is stored only as a hash, and a
          generated password or link is shown once at the moment it is created.
        </p>
        <PeopleEditor people={people} mailConfigured={mailConfigured()} />
      </div>
    </>
  );
}
