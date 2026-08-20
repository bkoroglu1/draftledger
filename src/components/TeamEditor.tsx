'use client';

import { useActionState, useState } from 'react';
import { membershipAction, saveTeamAction } from '#src/app/actions/people.ts';
import { CONTACT_POLICIES, GROUP_KINDS, GROUP_ROLES } from '#src/domain/types.ts';
import type { TeamRow } from '#src/services/teams.ts';

export function TeamEditor({
  teams,
  people,
}: {
  teams: TeamRow[];
  people: Array<{ id: string; displayName: string; handle: string }>;
}) {
  const [saveState, saveAction, savePending] = useActionState(saveTeamAction, null);
  const [memberState, memberAction, memberPending] = useActionState(membershipAction, null);
  const [selected, setSelected] = useState<TeamRow | null>(null);

  const target = selected ? teams.find((t) => t.id === selected.id) ?? selected : null;

  return (
    <>
      <section className="dl-card">
        <h2>Teams</h2>
        <div className="dl-table-scroll">
          <table className="dl-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Slug</th>
                <th scope="col">Kind</th>
                <th scope="col">Members</th>
                <th scope="col">Documents</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {teams.map((team) => (
                <tr key={team.id}>
                  <td>{team.name}</td>
                  <td className="dl-mono">{team.slug}</td>
                  <td>{team.kind}</td>
                  <td>{team.members.length}</td>
                  <td>{team.documentCount}</td>
                  <td>
                    <button type="button" className="dl-button" onClick={() => setSelected(team)}>
                      Manage
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {target ? (
        <section className="dl-card">
          <h2>Membership — {target.name}</h2>
          {memberState?.error ? <p className="dl-error">{memberState.error}</p> : null}
          {memberState?.message ? <p className="dl-notice">{memberState.message}</p> : null}
          <p className="dl-muted" style={{ fontSize: '0.8125rem' }}>
            A team role grants its permission on this team&apos;s documents only. Someone can hold
            more than one role. Organization-wide roles are set under <a href="/admin/people">People</a>.
          </p>
          <div className="dl-table-scroll">
            <table className="dl-table">
              <thead>
                <tr>
                  <th scope="col">Member</th>
                  <th scope="col">Role</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {target.members.map((member) => (
                  <tr key={`${member.personId}-${member.role}`}>
                    <td>{member.displayName}</td>
                    <td>{member.role}</td>
                    <td>
                      <form action={memberAction}>
                        <input type="hidden" name="teamId" value={target.id} />
                        <input type="hidden" name="personId" value={member.personId} />
                        <input type="hidden" name="role" value={member.role} />
                        <input type="hidden" name="intent" value="remove" />
                        <button className="dl-button" type="submit" disabled={memberPending}>
                          Remove
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
                {target.members.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="dl-muted">
                      No members yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <form action={memberAction} className="dl-form-grid" style={{ alignItems: 'end', marginTop: '0.75rem' }}>
            <input type="hidden" name="teamId" value={target.id} />
            <input type="hidden" name="intent" value="add" />
            <label className="dl-field">
              <span>Person</span>
              <select name="personId">
                {people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.displayName} ({person.handle})
                  </option>
                ))}
              </select>
            </label>
            <label className="dl-field">
              <span>Role</span>
              <select name="role">
                {GROUP_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
            </label>
            <div className="dl-actions" style={{ marginTop: 0 }}>
              <button className="dl-button" type="submit" disabled={memberPending}>
                Add member
              </button>
            </div>
          </form>
        </section>
      ) : null}

      <form action={saveAction} className="dl-card" key={target?.id ?? 'new'}>
        <h2>{target ? `Edit ${target.name}` : 'New team'}</h2>
        {saveState?.error ? <p className="dl-error">{saveState.error}</p> : null}
        {saveState?.message ? <p className="dl-notice">{saveState.message}</p> : null}
        <input type="hidden" name="teamId" value={target?.id ?? ''} />
        <div className="dl-form-grid">
          <label className="dl-field">
            <span>Name</span>
            <input name="name" defaultValue={target?.name ?? ''} required />
          </label>
          <label className="dl-field">
            <span>Slug</span>
            {target ? (
              <input value={target.slug} readOnly aria-describedby="dl-slug-note" />
            ) : (
              <input name="slug" pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="ledger-interchange" required />
            )}
          </label>
          <label className="dl-field">
            <span>Kind</span>
            <select name="kind" defaultValue={target?.kind ?? 'working-group'}>
              {GROUP_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {kind}
                </option>
              ))}
            </select>
          </label>
          <label className="dl-field">
            <span>Contact policy</span>
            <select name="contactPolicy" defaultValue={target?.contactPolicy ?? 'owners-only'}>
              {CONTACT_POLICIES.map((policy) => (
                <option key={policy} value={policy}>
                  {policy}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="dl-field" style={{ marginTop: '0.75rem' }}>
          <span>Description</span>
          <textarea name="description" rows={3} defaultValue={target?.description ?? ''} />
        </label>
        <label className="dl-field" style={{ marginTop: '0.75rem' }}>
          <span>Charter</span>
          <textarea name="charter" rows={4} defaultValue={target?.charter ?? ''} />
        </label>
        <p className="dl-muted" style={{ fontSize: '0.8125rem' }} id="dl-slug-note">
          The slug is part of the team&apos;s permanent address at <code className="dl-mono">/groups/&lt;slug&gt;</code>,
          so it is fixed once the team exists. Everything else can change.
        </p>
        <div className="dl-actions">
          <button className="dl-button dl-button-primary" type="submit" disabled={savePending}>
            {savePending ? 'Saving…' : target ? 'Save changes' : 'Create team'}
          </button>
          {target ? (
            <button type="button" className="dl-button" onClick={() => setSelected(null)}>
              Start a new team
            </button>
          ) : null}
        </div>
      </form>
    </>
  );
}
