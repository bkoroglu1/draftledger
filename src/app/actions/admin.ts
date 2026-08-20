'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { db } from '#src/db/index.ts';
import { notificationPolicies, templates } from '#src/db/schema.ts';
import { isAppError } from '#src/domain/errors.ts';
import { requireActor } from '#src/services/auth.ts';
import { recordAudit } from '#src/services/audit.ts';
import { expandRecipients, namespaceKeyFor } from '#src/services/notifications.ts';
import { getDocumentContext } from '#src/services/documents.ts';
import { assertAdmin } from '#src/services/rbac.ts';

type State = { error?: string; message?: string; preview?: string } | null;

const SELECTOR_RE = /^([a-z]+\.[a-z]+|person:[A-Za-z0-9._-]+|group:[A-Za-z0-9._-]+)$/;
const TEMPLATE_KEY_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function parseSelectors(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Policies are versioned: an update supersedes rather than mutates. */
export async function savePolicyAction(_prev: State, formData: FormData): Promise<State> {
  try {
    const actor = await requireActor();
    assertAdmin(actor);

    const to = parseSelectors(String(formData.get('to') ?? ''));
    const cc = parseSelectors(String(formData.get('cc') ?? ''));
    const suppress = parseSelectors(String(formData.get('suppress') ?? ''));
    const invalid = [...to, ...cc, ...suppress].filter((s) => !SELECTOR_RE.test(s));
    if (invalid.length) {
      return { error: `Invalid recipient selector(s): ${invalid.join(', ')}` };
    }

    const id = String(formData.get('policyId') ?? '');
    const eventKey = String(formData.get('eventKey') ?? '');
    const scope = String(formData.get('scope') ?? 'global');
    const scopeRef = String(formData.get('scopeRef') ?? '') || null;
    const enabled = formData.get('enabled') === 'on';
    const precedence = Number(formData.get('precedence') ?? 0) || 0;

    const previous = id
      ? (await db.select().from(notificationPolicies).where(eq(notificationPolicies.id, id)).limit(1))[0]
      : undefined;

    const inserted = await db
      .insert(notificationPolicies)
      .values({
        scope,
        scopeRef,
        eventKey,
        channel: String(formData.get('channel') ?? 'email'),
        enabled,
        precedence,
        toSelectors: to,
        ccSelectors: cc,
        suppressSelectors: suppress,
        template: String(formData.get('template') ?? '') || null,
        version: (previous?.version ?? 0) + 1,
        isActive: true,
        createdBy: actor.id,
      })
      .returning({ id: notificationPolicies.id });

    if (previous) {
      await db
        .update(notificationPolicies)
        .set({ isActive: false, supersededById: inserted[0]!.id })
        .where(eq(notificationPolicies.id, previous.id));
    }

    await recordAudit({
      familyKey: `policy:${eventKey}`,
      entityType: 'notification_policy',
      entityId: inserted[0]!.id,
      action: 'notification_policy_changed',
      summary: `Policy for ${eventKey} (${scope}) saved as version ${(previous?.version ?? 0) + 1}`,
      changes: [
        { field: 'toSelectors', before: previous?.toSelectors ?? null, after: to, sensitivity: 'internal' },
        { field: 'ccSelectors', before: previous?.ccSelectors ?? null, after: cc, sensitivity: 'internal' },
        { field: 'enabled', before: previous?.enabled ?? null, after: enabled, sensitivity: 'internal' },
      ],
      actorId: actor.id,
    });

    revalidatePath('/admin/notification-policies');
    return { message: `Saved version ${(previous?.version ?? 0) + 1} of the ${eventKey} policy.` };
  } catch (err) {
    return { error: isAppError(err) ? err.message : 'Could not save the policy.' };
  }
}

/** Computes the expansion for a document/event without sending anything. */
export async function previewExpansionAction(_prev: State, formData: FormData): Promise<State> {
  try {
    const actor = await requireActor();
    assertAdmin(actor);

    const slug = String(formData.get('documentSlug') ?? '');
    const eventKey = String(formData.get('eventKey') ?? '');
    const context = await getDocumentContext(slug, actor);
    const subject = await namespaceKeyFor(context.document.id);
    const result = await expandRecipients(eventKey, subject, context.acl, actor);

    const lines = [
      `Event: ${result.eventLabel} (${result.eventKey}) on ${result.channel}`,
      `Enabled: ${result.enabled ? 'yes' : 'no'}`,
      `To: ${result.to.map((r) => r.displayName).join(', ') || '(none)'}`,
      `Cc: ${result.cc.map((r) => r.displayName).join(', ') || '(none)'}`,
      ...result.warnings.map((w) => `Warning: ${w.message}`),
      'No message was sent — this is a preview only.',
    ];
    return { preview: lines.join('\n') };
  } catch (err) {
    return { error: isAppError(err) ? err.message : 'Preview failed.' };
  }
}

/**
 * Creates or updates a document template. Unlike a notification policy a
 * template is not versioned: it seeds new drafts at creation time and is never
 * consulted again, so an edit cannot change a document that already exists.
 * Required sections deliberately live on the workflow gate, not here.
 */
export async function saveTemplateAction(_prev: State, formData: FormData): Promise<State> {
  try {
    const actor = await requireActor();
    assertAdmin(actor);

    const id = String(formData.get('templateId') ?? '');
    const key = String(formData.get('key') ?? '').trim();
    const name = String(formData.get('name') ?? '').trim();
    const description = String(formData.get('description') ?? '').trim() || null;
    const canonicalFormat = String(formData.get('canonicalFormat') ?? 'markdown');
    const body = String(formData.get('body') ?? '').replace(/\r\n/g, '\n');

    if (!TEMPLATE_KEY_RE.test(key)) {
      return { error: 'The key must be lower-case words joined by hyphens, for example "standards-track-default".' };
    }
    if (!name) return { error: 'A name is required.' };
    if (!body.trim()) return { error: 'The template body cannot be empty.' };
    if (canonicalFormat !== 'markdown' && canonicalFormat !== 'rfcxml') {
      return { error: `Unknown canonical format "${canonicalFormat}".` };
    }

    const previous = id
      ? (await db.select().from(templates).where(eq(templates.id, id)).limit(1))[0]
      : undefined;
    if (id && !previous) return { error: 'That template no longer exists.' };

    // The key is unique; report the clash rather than surfacing a driver error.
    const clash = (await db.select({ id: templates.id }).from(templates).where(eq(templates.key, key)).limit(1))[0];
    if (clash && clash.id !== previous?.id) {
      return { error: `The key "${key}" is already used by another template.` };
    }

    const values = { key, name, description, canonicalFormat, body } as const;
    const saved = previous
      ? (await db.update(templates).set(values).where(eq(templates.id, previous.id)).returning({ id: templates.id }))[0]!
      : (await db.insert(templates).values(values).returning({ id: templates.id }))[0]!;

    await recordAudit({
      familyKey: `template:${key}`,
      entityType: 'template',
      entityId: saved.id,
      action: previous ? 'template_updated' : 'template_created',
      summary: `Template ${name} (${key}) ${previous ? 'updated' : 'created'}`,
      changes: [
        { field: 'key', before: previous?.key ?? null, after: key, sensitivity: 'internal' },
        { field: 'name', before: previous?.name ?? null, after: name, sensitivity: 'internal' },
        { field: 'canonicalFormat', before: previous?.canonicalFormat ?? null, after: canonicalFormat, sensitivity: 'internal' },
        { field: 'body', before: previous?.body ?? null, after: body, sensitivity: 'internal' },
      ],
      actorId: actor.id,
    });

    revalidatePath('/admin/templates');
    // The creation wizard offers this list, so it has to pick the change up too.
    revalidatePath('/drafts/new');
    return { message: `${previous ? 'Updated' : 'Created'} the ${name} template.` };
  } catch (err) {
    return { error: isAppError(err) ? err.message : 'Could not save the template.' };
  }
}

/**
 * Removes a template. Nothing references it: `createDraft` copies the body into
 * the first revision, so a document created from a template keeps working after
 * the template is gone.
 */
export async function deleteTemplateAction(_prev: State, formData: FormData): Promise<State> {
  try {
    const actor = await requireActor();
    assertAdmin(actor);

    const id = String(formData.get('templateId') ?? '');
    const existing = (await db.select().from(templates).where(eq(templates.id, id)).limit(1))[0];
    if (!existing) return { error: 'That template no longer exists.' };

    await db.delete(templates).where(eq(templates.id, id));

    await recordAudit({
      familyKey: `template:${existing.key}`,
      entityType: 'template',
      entityId: existing.id,
      action: 'template_deleted',
      summary: `Template ${existing.name} (${existing.key}) deleted`,
      changes: [{ field: 'key', before: existing.key, after: null, sensitivity: 'internal' }],
      actorId: actor.id,
    });

    revalidatePath('/admin/templates');
    revalidatePath('/drafts/new');
    return { message: `Deleted the ${existing.name} template.` };
  } catch (err) {
    return { error: isAppError(err) ? err.message : 'Could not delete the template.' };
  }
}
