import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { config } from './config.ts';

/**
 * Artifact storage adapter. `local` writes to a persistent volume; the `s3`
 * shape is defined here so an S3-compatible backend can be dropped in without
 * touching call sites. Storage keys are content-addressed by revision.
 */

export interface StoredArtifact {
  storageKey: string;
  sha256: string;
  byteLength: number;
}

export interface ArtifactStorage {
  put(key: string, data: Buffer | string): Promise<StoredArtifact>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
}

function assertSafeKey(key: string): void {
  const normalized = normalize(key);
  if (normalized.startsWith('..') || normalized.includes(`..${sep}`) || normalized.startsWith(sep)) {
    throw new Error(`unsafe storage key: ${key}`);
  }
}

class LocalStorage implements ArtifactStorage {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private resolveKey(key: string): string {
    assertSafeKey(key);
    const full = resolve(join(this.root, key));
    if (!full.startsWith(this.root)) throw new Error(`storage key escapes root: ${key}`);
    return full;
  }

  async put(key: string, data: Buffer | string): Promise<StoredArtifact> {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
    const full = this.resolveKey(key);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, buffer);
    return {
      storageKey: key,
      sha256: createHash('sha256').update(buffer).digest('hex'),
      byteLength: buffer.byteLength,
    };
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.resolveKey(key));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.resolveKey(key));
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Placeholder for an S3-compatible backend. Kept explicit rather than silently
 * falling back to local storage, which would hide a misconfiguration.
 */
class S3Storage implements ArtifactStorage {
  async put(_key: string, _data: Buffer | string): Promise<StoredArtifact> {
    throw new Error(
      'ARTIFACT_STORAGE=s3 requires an S3 adapter build; set ARTIFACT_STORAGE=local or provide one.',
    );
  }
  async get(_key: string): Promise<Buffer> {
    throw new Error('ARTIFACT_STORAGE=s3 requires an S3 adapter build.');
  }
  async exists(_key: string): Promise<boolean> {
    return false;
  }
}

let instance: ArtifactStorage | null = null;

export function storage(): ArtifactStorage {
  if (!instance) {
    instance = config.storage.kind === 's3' ? new S3Storage() : new LocalStorage(config.storage.dir);
  }
  return instance;
}

export function artifactKey(revisionSlug: string, sha: string, format: string): string {
  const ext = format === 'html-with-errata' ? 'errata.html' : format;
  return `revisions/${revisionSlug}/${sha.slice(0, 12)}.${ext}`;
}

export function sourceKey(revisionSlug: string, sha: string, format: string): string {
  return `sources/${revisionSlug}/${sha.slice(0, 12)}.${format === 'rfcxml' ? 'xml' : 'md'}`;
}
