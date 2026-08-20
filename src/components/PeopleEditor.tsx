'use client';

import { useActionState, useState } from 'react';
import { issueLinkAction, savePersonAction, setPasswordAction } from '#src/app/actions/people.ts';
import { SecretReveal } from './SecretReveal.tsx';
import { EMAIL_VISIBILITIES, ORG_ROLES } from '#src/domain/types.ts';
import type { PersonRow } from '#src/services/people.ts';

export function PeopleEditor({
  people,
  mailConfigured,
}: {
  people: PersonRow[];
  mailConfigured: boolean;
}) {
  const [saveState, saveAction, savePending] = useActionState(savePersonAction, null);
  const [credState, credAction, credPending] = useActionState(setPasswordAction, null);
  const [linkState, linkAction, linkPending] = useActionState(issueLinkAction, null);
  const [selected, setSelected] = useState<PersonRow | null>(null);

  const target = selected ? people.find((p) => p.id === selected.id) ?? selected : null;

  return (
    <>
      <section className="dl-card">
        <h2>People</h2>
        <div className="dl-table-scroll">
          <table className="dl-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Handle</th>
                <th scope="col">Org role</th>
                <th scope="col">Teams</th>
                <th scope="col">Password</th>
                <th scope="col">Status</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {people.map((person) => (
                <tr key={person.id}>
                  <td>{person.displayName}</td>
                  <td className="dl-mono">{person.handle}</td>
                  <td>{person.orgRole}</td>
                  <td style={{ fontSize: '0.8125rem' }}>
                    {person.groups.length
                      ? person.groups.map((g) => `${g.slug}:${g.role}`).join(', ')
                      : '—'}
                  </td>
                  <td>{person.hasPassword ? 'set' : 'not set'}</td>
                  <td>
                    {person.isExternal ? 'external' : person.isActive ? 'active' : 'deactivated'}
                  </td>
                  <td>
                    {person.isExternal ? null : (
                      <button type="button" className="dl-button" onClick={() => setSelected(person)}>
                        Manage
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {target ? (
        <section className="dl-card">
          <h2>Credentials — {target.displayName}</h2>
          {credState?.error ? <p className="dl-error">{credState.error}</p> : null}
          {credState?.message ? <p className="dl-notice">{credState.message}</p> : null}
          {credState?.secret ? <SecretReveal {...credState.secret} /> : null}
          {linkState?.error ? <p className="dl-error">{linkState.error}</p> : null}
          {linkState?.message ? <p className="dl-notice">{linkState.message}</p> : null}
          {linkState?.secret ? <SecretReveal {...linkState.secret} /> : null}

          <p className="dl-muted" style={{ fontSize: '0.8125rem' }}>
            Setting a password or redeeming a link signs the account out everywhere. Generated
            values are shown once and stored only as a hash.
          </p>

          <form action={credAction} className="dl-form-grid" style={{ alignItems: 'end' }}>
            <input type="hidden" name="personId" value={target.id} />
            <input type="hidden" name="mode" value="generate" />
            <div className="dl-actions" style={{ marginTop: 0 }}>
              <button className="dl-button dl-button-primary" type="submit" disabled={credPending}>
                Generate a password
              </button>
            </div>
          </form>

          <form action={credAction} className="dl-form-grid" style={{ alignItems: 'end', marginTop: '0.75rem' }}>
            <input type="hidden" name="personId" value={target.id} />
            <input type="hidden" name="mode" value="explicit" />
            <label className="dl-field">
              <span>Or set one directly (12 characters minimum)</span>
              <input name="password" type="password" autoComplete="new-password" minLength={12} required />
            </label>
            <div className="dl-actions" style={{ marginTop: 0 }}>
              <button className="dl-button" type="submit" disabled={credPending}>
                Set password
              </button>
            </div>
          </form>

          <h3 style={{ marginTop: '1rem' }}>Invite and reset links</h3>
          <p className="dl-muted" style={{ fontSize: '0.8125rem' }}>
            {mailConfigured
              ? 'Email delivery is configured; you can also copy the link and deliver it yourself.'
              : 'No SMTP transport is configured, so links can only be copied. Set SMTP_HOST and SMTP_FROM to enable email.'}
            {target.email ? '' : ' This person has no email address on file.'}
          </p>
          <div className="dl-form-grid">
            {(['invite', 'reset'] as const).map((kind) => (
              <form action={linkAction} key={kind} className="dl-actions" style={{ marginTop: 0 }}>
                <input type="hidden" name="personId" value={target.id} />
                <input type="hidden" name="kind" value={kind} />
                <button className="dl-button" type="submit" name="deliver" value="link" disabled={linkPending}>
                  Copy {kind} link
                </button>
                <button
                  className="dl-button"
                  type="submit"
                  name="deliver"
                  value="email"
                  disabled={linkPending || !mailConfigured || !target.email}
                >
                  Email {kind}
                </button>
              </form>
            ))}
          </div>
        </section>
      ) : null}

      <form action={saveAction} className="dl-card" key={target?.id ?? 'new'}>
        <h2>{target ? `Edit ${target.displayName}` : 'New person'}</h2>
        {saveState?.error ? <p className="dl-error">{saveState.error}</p> : null}
        {saveState?.message ? <p className="dl-notice">{saveState.message}</p> : null}
        <input type="hidden" name="personId" value={target?.id ?? ''} />
        <div className="dl-form-grid">
          <label className="dl-field">
            <span>Display name</span>
            <input name="displayName" defaultValue={target?.displayName ?? ''} required />
          </label>
          <label className="dl-field">
            <span>Handle</span>
            <input
              name="handle"
              defaultValue={target?.handle ?? ''}
              pattern="[a-z0-9]+([-.][a-z0-9]+)*"
              placeholder="author-3"
              required
            />
          </label>
          <label className="dl-field">
            <span>Email</span>
            <input name="email" type="email" defaultValue={target?.email ?? ''} />
          </label>
          <label className="dl-field">
            <span>Email visibility</span>
            <select name="emailVisibility" defaultValue={target?.emailVisibility ?? 'organization'}>
              {EMAIL_VISIBILITIES.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="dl-field">
            <span>Organization role</span>
            <select name="orgRole" defaultValue={target?.orgRole ?? 'reader'}>
              {ORG_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label className="dl-field">
            <span>Affiliation</span>
            <input name="affiliation" defaultValue={target?.affiliation ?? ''} />
          </label>
          <label className="dl-field">
            <span>Active</span>
            <input name="isActive" type="checkbox" defaultChecked={target?.isActive ?? true} />
          </label>
        </div>
        <p className="dl-muted" style={{ fontSize: '0.8125rem' }}>
          Deactivating keeps the person on every document they authored; it only stops them signing
          in. Team membership is managed under <a href="/admin/teams">Teams</a>.
        </p>
        <div className="dl-actions">
          <button className="dl-button dl-button-primary" type="submit" disabled={savePending}>
            {savePending ? 'Saving…' : target ? 'Save changes' : 'Create person'}
          </button>
          {target ? (
            <button type="button" className="dl-button" onClick={() => setSelected(null)}>
              Start a new person
            </button>
          ) : null}
        </div>
      </form>
    </>
  );
}
