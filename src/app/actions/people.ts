'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { db } from '#src/db/index.ts';
import { people } from '#src/db/schema.ts';
import { isAppError } from '#src/domain/errors.ts';
import { ORG_ROLE_RANK, type GroupRole, type OrgRole } from '#src/domain/types.ts';
import { config } from '#src/lib/config.ts';
import { mailConfigured, sendMail } from '#src/lib/mail.ts';
import { requireActor } from '#src/services/auth.ts';
import { recordAudit } from '#src/services/audit.ts';
import { assertAdmin } from '#src/services/rbac.ts';
import {
  generatePassword,
  issueToken,
  setPassword,
  type TokenKind,
} from '#src/services/people.ts';
import { createTeam, removeMembership, setMembership, updateTeam } from '#src/services/teams.ts';

/**
 * People and team administration. A generated password or link is returned in
 * `secret` exactly once — nothing here writes a plaintext credential to the
 * database, the audit trail or a log line.
 */
type State = {
  error?: string;
  message?: string;
  /** Shown once, then gone. The caller must not persist it. */
  secret?: { label: string; value: string; note: string };
} | null;

const HANDLE_RE = /^[a-z0-9]+(?:[-.][a-z0-9]+)*$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_VISIBILITIES = ['private', 'group', 'organization', 'public'];

function isOrgRole(value: string): value is OrgRole {
  return Object.hasOwn(ORG_ROLE_RANK, value);
}

export async function savePersonAction(_prev: State, formData: FormData): Promise<State> {
  try {
    const actor = await requireActor();
    assertAdmin(actor);

    const id = String(formData.get('personId') ?? '');
    const handle = String(formData.get('handle') ?? '').trim();
    const displayName = String(formData.get('displayName') ?? '').trim();
    const email = String(formData.get('email') ?? '').trim() || null;
    const emailVisibility = String(formData.get('emailVisibility') ?? 'organization');
    const affiliation = String(formData.get('affiliation') ?? '').trim() || null;
    const orgRole = String(formData.get('orgRole') ?? 'reader');
    const isActive = formData.get('isActive') === 'on';

    if (!HANDLE_RE.test(handle)) {
      return { error: 'The handle must be lower-case words joined by hyphens or dots.' };
    }
    if (!displayName) return { error: 'A display name is required.' };
    if (email && !EMAIL_RE.test(email)) return { error: 'That does not look like an email address.' };
    if (!isOrgRole(orgRole)) return { error: `Unknown organization role "${orgRole}".` };
    if (!EMAIL_VISIBILITIES.includes(emailVisibility)) {
      return { error: `Unknown email visibility "${emailVisibility}".` };
    }

    const previous = id ? (await db.select().from(people).where(eq(people.id, id)).limit(1))[0] : undefined;
    if (id && !previous) return { error: 'That person no longer exists.' };
    if (previous?.isExternal) {
      return { error: 'External identities are owned by their source and cannot be edited here.' };
    }

    const clash = (await db.select({ id: people.id }).from(people).where(eq(people.handle, handle)).limit(1))[0];
    if (clash && clash.id !== previous?.id) return { error: `The handle "${handle}" is already taken.` };

    // An admin must not be able to lock themselves out of the admin screens.
    if (previous?.id === actor.id && (orgRole !== 'admin' || !isActive)) {
      return { error: 'You cannot remove your own admin role or deactivate yourself.' };
    }

    const values = { handle, displayName, email, emailVisibility, affiliation, orgRole, isActive };
    const saved = previous
      ? (await db.update(people).set(values).where(eq(people.id, previous.id)).returning({ id: people.id }))[0]!
      : (await db.insert(people).values(values).returning({ id: people.id }))[0]!;

    await recordAudit({
      familyKey: `person:${handle}`,
      entityType: 'person',
      entityId: saved.id,
      action: previous ? 'person_updated' : 'person_created',
      summary: `${displayName} (${handle}) ${previous ? 'updated' : 'created'}`,
      changes: [
        { field: 'orgRole', before: previous?.orgRole ?? null, after: orgRole, sensitivity: 'internal' },
        { field: 'isActive', before: previous?.isActive ?? null, after: isActive, sensitivity: 'internal' },
      ],
      actorId: actor.id,
    });

    revalidatePath('/admin/people');
    return {
      message: previous
        ? `Updated ${displayName}.`
        : `Created ${displayName}. Issue an invite link so they can set a password.`,
    };
  } catch (err) {
    return { error: isAppError(err) ? err.message : 'Could not save the person.' };
  }
}

/** Sets a password an admin typed, or generates one and returns it once. */
export async function setPasswordAction(_prev: State, formData: FormData): Promise<State> {
  try {
    const actor = await requireActor();
    assertAdmin(actor);

    const personId = String(formData.get('personId') ?? '');
    const mode = String(formData.get('mode') ?? 'generate');
    const person = (await db.select().from(people).where(eq(people.id, personId)).limit(1))[0];
    if (!person) return { error: 'That person no longer exists.' };

    const password = mode === 'generate' ? generatePassword() : String(formData.get('password') ?? '');
    await setPassword(personId, password, actor);
    revalidatePath('/admin/people');

    if (mode !== 'generate') {
      return { message: `Password set for ${person.displayName}. Their sessions were signed out.` };
    }
    return {
      message: `Password generated for ${person.displayName}. Their sessions were signed out.`,
      secret: {
        label: `One-time password for ${person.displayName}`,
        value: password,
        note: 'Copy it now — it is not stored in readable form and will not be shown again.',
      },
    };
  } catch (err) {
    return { error: isAppError(err) ? err.message : 'Could not set the password.' };
  }
}

/**
 * Issues an invite or reset link. Either hands the link back for the admin to
 * deliver, or emails it — mailing requires both an address and a transport.
 */
export async function issueLinkAction(_prev: State, formData: FormData): Promise<State> {
  try {
    const actor = await requireActor();
    assertAdmin(actor);

    const personId = String(formData.get('personId') ?? '');
    const kind = String(formData.get('kind') ?? 'invite') as TokenKind;
    const deliver = String(formData.get('deliver') ?? 'link');
    if (kind !== 'invite' && kind !== 'reset') return { error: `Unknown link kind "${kind}".` };

    const person = (await db.select().from(people).where(eq(people.id, personId)).limit(1))[0];
    if (!person) return { error: 'That person no longer exists.' };
    if (person.isExternal) return { error: 'External identities cannot authenticate.' };
    if (!person.isActive) return { error: 'Reactivate the account before issuing a link.' };
    if (deliver === 'email') {
      if (!person.email) return { error: `${person.displayName} has no email address on file.` };
      if (!mailConfigured()) {
        return { error: 'No SMTP transport is configured. Set SMTP_HOST and SMTP_FROM, or copy the link instead.' };
      }
    }

    const issued = await issueToken(personId, kind, actor);
    const hours = Math.round((issued.expiresAt.getTime() - Date.now()) / 3_600_000);

    let delivered = false;
    if (deliver === 'email') {
      const result = await sendMail({
        to: [person.email!],
        subject:
          kind === 'invite'
            ? `You have been invited to ${config.app.brandName}`
            : `Reset your ${config.app.brandName} password`,
        text: [
          `Hello ${person.displayName},`,
          '',
          kind === 'invite'
            ? `An account has been created for you on ${config.app.brandName}. Set your password here:`
            : `A password reset was requested for your ${config.app.brandName} account. Set a new password here:`,
          '',
          issued.link,
          '',
          `This link works once and expires in about ${hours} hour${hours === 1 ? '' : 's'}.`,
          'If you were not expecting this, tell your administrator and ignore the link.',
        ].join('\n'),
      });
      if (result.status !== 'sent') {
        return { error: `The link was created but could not be emailed (${result.errorClass}). Copy it instead.` };
      }
      delivered = true;
    }

    await recordAudit({
      familyKey: `person:${person.handle}`,
      entityType: 'person',
      entityId: personId,
      action: kind === 'invite' ? 'invite_issued' : 'password_reset_issued',
      summary: `${kind === 'invite' ? 'Invite' : 'Reset'} link issued for ${person.displayName}${
        delivered ? ' and emailed' : ''
      }`,
      // The token itself never enters the audit payload.
      actorId: actor.id,
      visibility: 'restricted',
    });

    revalidatePath('/admin/people');
    if (delivered) {
      return { message: `Emailed a new ${kind} link to ${person.displayName}. It expires in about ${hours} hours.` };
    }
    return {
      message: `Created a new ${kind} link for ${person.displayName}.`,
      secret: {
        label: `${kind === 'invite' ? 'Invite' : 'Reset'} link for ${person.displayName}`,
        value: issued.link,
        note: `Works once, expires in about ${hours} hour${hours === 1 ? '' : 's'}. It is not shown again.`,
      },
    };
  } catch (err) {
    return { error: isAppError(err) ? err.message : 'Could not issue the link.' };
  }
}

export async function saveTeamAction(_prev: State, formData: FormData): Promise<State> {
  try {
    const actor = await requireActor();
    assertAdmin(actor);

    const id = String(formData.get('teamId') ?? '');
    const input = {
      name: String(formData.get('name') ?? '').trim(),
      kind: String(formData.get('kind') ?? 'working-group'),
      description: String(formData.get('description') ?? '').trim() || null,
      charter: String(formData.get('charter') ?? '').trim() || null,
      contactPolicy: String(formData.get('contactPolicy') ?? 'owners-only'),
    };

    if (id) {
      await updateTeam(id, input, actor);
    } else {
      await createTeam(String(formData.get('slug') ?? '').trim(), input, actor);
    }

    revalidatePath('/admin/teams');
    return { message: `${id ? 'Updated' : 'Created'} ${input.name}.` };
  } catch (err) {
    return { error: isAppError(err) ? err.message : 'Could not save the team.' };
  }
}

export async function membershipAction(_prev: State, formData: FormData): Promise<State> {
  try {
    const actor = await requireActor();
    assertAdmin(actor);

    const groupId = String(formData.get('teamId') ?? '');
    const personId = String(formData.get('personId') ?? '');
    const role = String(formData.get('role') ?? 'member');
    const intent = String(formData.get('intent') ?? 'add');

    if (intent === 'remove') {
      await removeMembership(groupId, personId, role, actor);
    } else {
      await setMembership(groupId, personId, role as GroupRole, actor);
    }

    revalidatePath('/admin/teams');
    return { message: intent === 'remove' ? 'Membership removed.' : 'Membership added.' };
  } catch (err) {
    return { error: isAppError(err) ? err.message : 'Could not change the membership.' };
  }
}
