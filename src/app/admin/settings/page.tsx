import { redirect } from 'next/navigation';
import { AppBar } from '#src/components/AppBar.tsx';
import { AdminNav } from '#src/components/AdminNav.tsx';
import { SettingsEditor } from '#src/components/SettingsEditor.tsx';
import { getActor } from '#src/services/auth.ts';
import { isAdmin } from '#src/services/rbac.ts';
import { resolveSettings } from '#src/services/settings.ts';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const actor = await getActor();
  if (!actor) redirect('/login?next=/admin/settings');
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

  const settings = await resolveSettings();

  return (
    <>
      <AppBar actor={actor} />
      <div className="dl-app">
        <AdminNav active="settings" />
        <h1 className="dl-page-title">Installation settings</h1>
        <p className="dl-page-subtitle">
          Presentation values for this installation. Secrets, database credentials and upstream
          hosts are not editable here and stay in the environment.
        </p>

        <SettingsEditor
          settings={settings.map((s) => ({
            key: s.key,
            label: s.label,
            help: s.help,
            value: s.value,
            source: s.source,
            envVar: s.envVar,
            locked: s.locked,
          }))}
        />

        <p className="dl-notice">
          Changing the organization name does not rewrite documents that are already published.
          A published revision keeps the name it carried at publication, because its rendered
          artifacts are immutable. Drafts pick up the new value the next time they render.
        </p>
      </div>
    </>
  );
}
