import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactStorage } from '#src/lib/storage.ts';

/**
 * Route-level coverage for artifact delivery. Artifacts on a published public
 * document are readable anonymously, so an empty cookie jar is enough here.
 */
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
}));

/** Blob reads are funnelled through this so a test can make storage fail. */
let readBlob: (key: string) => Promise<Buffer>;

vi.mock('#src/lib/storage.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#src/lib/storage.ts')>();
  return {
    ...actual,
    storage: (): ArtifactStorage => {
      const real = actual.storage();
      return { ...real, get: (key: string) => readBlob(key) };
    },
  };
});

const PUBLISHED_REVISION = 'TEST-STD-0001-PUBLISHED';

async function get(revision: string, format: string): Promise<Response> {
  const { GET } = await import('#src/app/artifacts/[revision]/[format]/route.ts');
  return GET(new Request(`http://localhost/artifacts/${revision}/${format}`), {
    params: Promise.resolve({ revision, format }),
  });
}

beforeEach(async () => {
  const actual = await vi.importActual<typeof import('#src/lib/storage.ts')>('#src/lib/storage.ts');
  const real = actual.storage();
  readBlob = (key) => real.get(key);
});

describe('artifact delivery', () => {
  it('serves a stored artifact with its own content type', async () => {
    const response = await get(PUBLISHED_REVISION, 'txt');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/plain');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await response.text()).toContain('[Page 1]');
  });

  it('offers downloadable formats as an attachment', async () => {
    const response = await get(PUBLISHED_REVISION, 'pdf');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toBe(
      `attachment; filename="${PUBLISHED_REVISION}.pdf"`,
    );
  });

  it('reports an unknown format as not_found', async () => {
    const response = await get(PUBLISHED_REVISION, 'epub');
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: 'not_found' });
  });

  it('reports a recorded artifact whose blob is gone as not_synced', async () => {
    readBlob = () => Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    const response = await get(PUBLISHED_REVISION, 'txt');
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: string; message: string };
    expect(body.error).toBe('not_synced');
    expect(body.message).toContain('missing from storage');
  });
});
