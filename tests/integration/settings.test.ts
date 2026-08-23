import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import { db, pool } from '#src/db/index.ts';
import { auditEvents, people, settings as settingsTable } from '#src/db/schema.ts';
import { toActor } from '#src/services/auth.ts';
import {
  clearSetting,
  clearSettingsCache,
  resolveSettings,
  saveSettings,
  settingValues,
} from '#src/services/settings.ts';
import type { Actor } from '#src/services/rbac.ts';

/**
 * Precedence is the contract worth pinning down here: an environment variable
 * must win over a stored value, and a stored value must win over the built-in
 * default. Requires the seeded database.
 */

let admin: Actor;
const ENV_VAR = 'APP_ORG_NAME';
let originalEnv: string | undefined;

beforeAll(async () => {
  const row = (await db.select().from(people).where(eq(people.handle, 'admin-1')).limit(1))[0]!;
  admin = await toActor(row);
  originalEnv = process.env[ENV_VAR];
});

beforeEach(async () => {
  await db.delete(settingsTable);
  clearSettingsCache();
});

afterEach(async () => {
  if (originalEnv === undefined) delete process.env[ENV_VAR];
  else process.env[ENV_VAR] = originalEnv;
  await db.delete(settingsTable);
  clearSettingsCache();
});

afterAll(async () => {
  await pool.end();
});

function envUnset() {
  delete process.env[ENV_VAR];
  clearSettingsCache();
}

describe('installation settings', () => {
  it('falls back to the built-in default when nothing is configured', async () => {
    envUnset();
    const resolved = (await resolveSettings()).find((s) => s.key === 'orgName')!;
    expect(resolved.source).toBe('default');
    expect(resolved.locked).toBe(false);
  });

  it('uses a stored value when the environment does not pin one', async () => {
    envUnset();
    await saveSettings(admin, { orgName: 'Stored Organization' });
    clearSettingsCache();

    const resolved = (await resolveSettings()).find((s) => s.key === 'orgName')!;
    expect(resolved.value).toBe('Stored Organization');
    expect(resolved.source).toBe('database');
    expect((await settingValues()).orgName).toBe('Stored Organization');
  });

  it('lets an explicitly set environment variable win over a stored value', async () => {
    envUnset();
    await saveSettings(admin, { orgName: 'Stored Organization' });

    process.env[ENV_VAR] = 'Environment Organization';
    clearSettingsCache();

    const resolved = (await resolveSettings()).find((s) => s.key === 'orgName')!;
    expect(resolved.value).toBe('Environment Organization');
    expect(resolved.source).toBe('environment');
    expect(resolved.locked).toBe(true);
  });

  it('refuses to store a value the environment already pins', async () => {
    process.env[ENV_VAR] = 'Environment Organization';
    clearSettingsCache();

    const result = await saveSettings(admin, { orgName: 'Attempted Override' });
    expect(result.changed).toEqual([]);
    expect(result.rejected[0]?.reason).toContain(ENV_VAR);

    // Nothing may reach the table: a stored value nothing reads is worse than
    // no value at all, because the next operator to remove the variable would
    // silently inherit it.
    const rows = await db.select().from(settingsTable).where(eq(settingsTable.key, 'orgName'));
    expect(rows).toHaveLength(0);
  });

  it('rejects an invalid value without writing it', async () => {
    envUnset();
    const empty = await saveSettings(admin, { orgName: '   ' });
    expect(empty.changed).toEqual([]);
    expect(empty.rejected).toHaveLength(1);

    const badUrl = await saveSettings(admin, { bugReportUrl: 'not-a-url' });
    expect(badUrl.changed).toEqual([]);
    expect(badUrl.rejected[0]?.reason).toContain('URL');

    expect(await db.select().from(settingsTable)).toHaveLength(0);
  });

  it('records an audit event naming the old and the new value', async () => {
    envUnset();
    await saveSettings(admin, { orgName: 'Audited Organization' });

    const events = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.familyKey, 'setting:orgName'))
      .orderBy(asc(auditEvents.createdAt));
    const latest = events.at(-1)!;
    expect(latest.action).toBe('setting_changed');
    expect(latest.actorId).toBe(admin.id);
    const change = (latest.changes as { field: string; after: unknown }[])[0]!;
    expect(change.field).toBe('orgName');
    expect(change.after).toBe('Audited Organization');
  });

  it('treats an empty environment variable as absent rather than as a value', async () => {
    await saveSettings(admin, { orgName: 'Stored Organization' });
    process.env[ENV_VAR] = '';
    clearSettingsCache();

    const resolved = (await resolveSettings()).find((s) => s.key === 'orgName')!;
    expect(resolved.source).toBe('database');
    expect(resolved.value).toBe('Stored Organization');
  });

  it('returns to the built-in default once a stored value is cleared', async () => {
    envUnset();
    await saveSettings(admin, { orgName: 'Temporary Organization' });
    await clearSetting(admin, 'orgName');

    const resolved = (await resolveSettings()).find((s) => s.key === 'orgName')!;
    expect(resolved.source).toBe('default');
  });

  it('ignores an unknown key instead of storing it', async () => {
    envUnset();
    const result = await saveSettings(admin, { sessionSecret: 'nope' } as never);
    expect(result.changed).toEqual([]);
    expect(result.rejected[0]?.reason).toBe('Unknown setting');
    expect(await db.select().from(settingsTable)).toHaveLength(0);
  });
});
