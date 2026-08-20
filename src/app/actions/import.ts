'use server';

import { redirect } from 'next/navigation';
import { isAppError } from '#src/domain/errors.ts';
import { config } from '#src/lib/config.ts';
import { requireActor } from '#src/services/auth.ts';
import { hasOrgRole } from '#src/services/rbac.ts';
import { importExternalDocument, normalizeExternalRef } from '#src/adapters/external.ts';

export async function importUpstreamAction(_prev: { error?: string } | null, formData: FormData) {
  let slug: string;
  try {
    const actor = await requireActor();
    if (!config.external.enabled) return { error: 'External import is disabled on this installation.' };
    if (!hasOrgRole(actor, 'editor')) return { error: 'Your role cannot import upstream documents.' };

    const ref = normalizeExternalRef(String(formData.get('ref') ?? ''));
    const result = await importExternalDocument(ref);
    slug = result.slug;
  } catch (err) {
    return { error: isAppError(err) ? err.message : 'Import failed.' };
  }
  redirect(`/doc/html/${slug}`);
}
