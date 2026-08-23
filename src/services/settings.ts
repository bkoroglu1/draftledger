import { eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db, type DbOrTx } from '#src/db/index.ts';
import { settings as settingsTable } from '#src/db/schema.ts';
import { config, envIsSet } from '#src/lib/config.ts';
import { recordAudit } from './audit.ts';
import type { Actor } from './rbac.ts';

/**
 * Installation settings an administrator can change without a redeploy.
 *
 * Precedence is the whole design here, and it is deliberately not "whichever
 * was written last". An explicitly set environment variable always wins, and
 * the admin screen renders that field as managed rather than accepting an edit
 * that would silently do nothing. The mirror case is just as bad: an operator
 * who adds APP_ORG_NAME to their compose file must not be ignored because
 * somebody once typed a value into a form. Every value has exactly one owner
 * and the UI names it.
 *
 * Only presentation-level values are eligible. Secrets, connection strings and
 * upstream hosts stay in the environment where a database dump cannot reach
 * them, which is the rule SECURITY.md already states.
 */

export type SettingKey = 'brandName' | 'orgName' | 'bugReportUrl';

export type SettingSource = 'environment' | 'database' | 'default';

interface SettingDefinition {
  key: SettingKey;
  envVar: string;
  label: string;
  help: string;
  fallback: string;
  schema: z.ZodType<string>;
}

const name = z
  .string()
  .trim()
  .min(1, 'Cannot be empty')
  .max(120, 'Must be 120 characters or fewer');

const httpUrl = z
  .string()
  .trim()
  .max(500, 'Must be 500 characters or fewer')
  .refine((v) => {
    try {
      return ['http:', 'https:'].includes(new URL(v).protocol);
    } catch {
      return false;
    }
  }, 'Must be a valid http or https URL');

export const SETTING_DEFINITIONS: readonly SettingDefinition[] = [
  {
    key: 'brandName',
    envVar: 'APP_BRAND_NAME',
    label: 'Brand name',
    help: 'The badge in the application chrome and reader sidebar, and the name used in outgoing mail subjects.',
    fallback: config.app.brandName,
    schema: name,
  },
  {
    key: 'orgName',
    envVar: 'APP_ORG_NAME',
    label: 'Organization name',
    help: 'The publishing organization printed in the header of every rendered document. Already published revisions keep the name they were published under.',
    fallback: config.app.orgName,
    schema: name,
  },
  {
    key: 'bugReportUrl',
    envVar: 'BUG_REPORT_URL',
    label: 'Bug report URL',
    help: 'Where the reader sends people who report a problem with a document. Point this at your own tracker.',
    fallback: config.app.bugReportUrl,
    schema: httpUrl,
  },
] as const;

const BY_KEY = new Map(SETTING_DEFINITIONS.map((d) => [d.key, d]));

export type SettingValues = Record<SettingKey, string>;

export interface ResolvedSetting extends SettingDefinition {
  value: string;
  source: SettingSource;
  /** Env-managed settings are read-only until the variable is removed. */
  locked: boolean;
}

/* -------------------------------------------------------------------------- */

/**
 * Branding is read on nearly every render, so it is cached briefly rather than
 * queried each time. The window is short enough that an operator does not have
 * to wonder whether a change took, and a save clears it outright, so only the
 * worker ever waits for the TTL to lapse.
 */
const CACHE_TTL_MS = 10_000;
let cache: { at: number; values: Map<string, string> } | null = null;

export function clearSettingsCache(): void {
  cache = null;
}

async function storedValues(): Promise<Map<string, string>> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.values;
  try {
    const rows = await db
      .select({ key: settingsTable.key, value: settingsTable.value })
      .from(settingsTable)
      .where(inArray(settingsTable.key, [...BY_KEY.keys()]));
    const values = new Map(rows.map((r) => [r.key, r.value]));
    cache = { at: Date.now(), values };
    return values;
  } catch {
    // Branding must never be the reason a page fails to render. A database
    // that cannot answer falls back to the environment and the built-in
    // defaults, which is exactly the state a fresh installation starts in.
    return new Map();
  }
}

function resolveOne(def: SettingDefinition, stored: Map<string, string>): ResolvedSetting {
  if (envIsSet(def.envVar)) {
    return { ...def, value: process.env[def.envVar]!, source: 'environment', locked: true };
  }
  const fromDb = stored.get(def.key);
  if (fromDb !== undefined && fromDb !== '') {
    return { ...def, value: fromDb, source: 'database', locked: false };
  }
  return { ...def, value: def.fallback, source: 'default', locked: false };
}

/** Every setting with the value in force and where it came from. */
export async function resolveSettings(): Promise<ResolvedSetting[]> {
  const stored = await storedValues();
  return SETTING_DEFINITIONS.map((def) => resolveOne(def, stored));
}

/** Just the values, for the call sites that render them. */
export async function settingValues(): Promise<SettingValues> {
  const resolved = await resolveSettings();
  return Object.fromEntries(resolved.map((s) => [s.key, s.value])) as SettingValues;
}

/* -------------------------------------------------------------------------- */

export interface SaveSettingsResult {
  changed: SettingKey[];
  rejected: { key: SettingKey; reason: string }[];
}

/**
 * Writes the settings an administrator may actually change. Anything pinned by
 * the environment is refused rather than stored, so the database can never hold
 * a value that the UI claims is in force but the reader never sees.
 */
export async function saveSettings(
  actor: Actor,
  input: Partial<Record<SettingKey, string>>,
  tx: DbOrTx = db,
): Promise<SaveSettingsResult> {
  const stored = await storedValues();
  const changed: SettingKey[] = [];
  const rejected: { key: SettingKey; reason: string }[] = [];

  for (const [rawKey, rawValue] of Object.entries(input)) {
    const def = BY_KEY.get(rawKey as SettingKey);
    if (!def) {
      rejected.push({ key: rawKey as SettingKey, reason: 'Unknown setting' });
      continue;
    }
    if (envIsSet(def.envVar)) {
      rejected.push({ key: def.key, reason: `Managed by ${def.envVar} and cannot be edited here` });
      continue;
    }

    const parsed = def.schema.safeParse(rawValue ?? '');
    if (!parsed.success) {
      rejected.push({ key: def.key, reason: parsed.error.issues[0]?.message ?? 'Invalid value' });
      continue;
    }

    const before = resolveOne(def, stored).value;
    if (parsed.data === before) continue;

    await tx
      .insert(settingsTable)
      .values({ key: def.key, value: parsed.data, updatedBy: actor.id, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: settingsTable.key,
        set: { value: parsed.data, updatedBy: actor.id, updatedAt: new Date() },
      });

    await recordAudit(
      {
        familyKey: `setting:${def.key}`,
        entityType: 'setting',
        action: 'setting_changed',
        summary: `${def.label} changed to "${parsed.data}"`,
        changes: [{ field: def.key, before, after: parsed.data, sensitivity: 'internal' }],
        actorId: actor.id,
        visibility: 'restricted',
      },
      tx,
    );
    changed.push(def.key);
  }

  if (changed.length) clearSettingsCache();
  return { changed, rejected };
}

/** Drops a stored override so the setting falls back to its built-in default. */
export async function clearSetting(actor: Actor, key: SettingKey, tx: DbOrTx = db): Promise<void> {
  const def = BY_KEY.get(key);
  if (!def) return;
  const before = resolveOne(def, await storedValues()).value;
  await tx.delete(settingsTable).where(eq(settingsTable.key, key));
  await recordAudit(
    {
      familyKey: `setting:${key}`,
      entityType: 'setting',
      action: 'setting_cleared',
      summary: `${def.label} reset to the built-in default`,
      changes: [{ field: key, before, after: def.fallback, sensitivity: 'internal' }],
      actorId: actor.id,
      visibility: 'restricted',
    },
    tx,
  );
  clearSettingsCache();
}
