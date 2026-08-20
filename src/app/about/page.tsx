import type { Metadata } from 'next';
import { config } from '#src/lib/config.ts';
import { AppBar } from '#src/components/AppBar.tsx';
import { getActor } from '#src/services/auth.ts';

export const metadata: Metadata = { title: 'About' };

export const dynamic = 'force-dynamic';

/**
 * AGPL-3.0 section 13 requires that anyone interacting with this instance over a
 * network can obtain its Corresponding Source. A licence file in the repository
 * does not satisfy that on its own — the running instance has to say where the
 * source is, so this page is reachable without signing in.
 */
export default async function AboutPage() {
  const actor = await getActor();
  return (
    <>
      <AppBar actor={actor} />
      <main className="dl-app">
        <h1>About this installation</h1>

        <p>
          This is an installation of <strong>DraftLedger</strong>, a self-hosted platform for
          writing, reviewing, publishing and reading an organization&rsquo;s own RFC-style
          technical standards.
        </p>

        <h2>Source code</h2>
        <p>
          DraftLedger is free software licensed under the{' '}
          <a href="https://www.gnu.org/licenses/agpl-3.0.html" rel="license noreferrer" target="_blank">
            GNU Affero General Public License, version 3
          </a>
          . You may use, study, share and modify it under those terms.
        </p>
        <p>
          The Corresponding Source for the version running here is available at:{' '}
          <a href={config.app.sourceUrl} rel="noreferrer" target="_blank">
            {config.app.sourceUrl}
          </a>
        </p>
        <p className="dl-muted">
          If this installation runs modified code, the operator is required to publish those
          modifications and point the link above at them.
        </p>

        <h2>Warranty</h2>
        <p className="dl-muted">
          DraftLedger is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY;
          without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
          See the GNU Affero General Public License for more details.
        </p>

        <h2>This installation</h2>
        <p className="dl-muted">
          Branding, document namespace and publication policy are configured by the operator of this
          instance and are not part of the upstream project. DraftLedger is not a copy of, or a
          client for, any external standards organization.
        </p>
      </main>
    </>
  );
}
