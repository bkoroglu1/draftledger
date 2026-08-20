import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The worker and the migrate/seed entrypoints run under plain `node`, outside
 * the Next bundler, where importing `server-only` throws. Nothing reachable from
 * them may carry that guard — a regression here only shows up at container boot.
 */

const ROOT = resolve(import.meta.dirname, '../..');

function resolveSpecifier(specifier: string, fromFile: string): string | null {
  if (specifier.startsWith('#src/')) return resolve(ROOT, 'src', specifier.slice('#src/'.length));
  if (specifier.startsWith('#seed/')) return resolve(ROOT, 'seed', specifier.slice('#seed/'.length));
  if (specifier.startsWith('.')) return resolve(dirname(fromFile), specifier);
  return null; // a bare package specifier
}

function reachableFiles(entry: string): string[] {
  const seen = new Set<string>();
  const queue = [resolve(ROOT, entry)];

  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);

    let source: string;
    try {
      source = readFileSync(file, 'utf8');
    } catch {
      continue;
    }

    for (const match of source.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)) {
      const target = resolveSpecifier(match[1]!, file);
      if (target) queue.push(target);
    }
  }
  return [...seen];
}

const NODE_ENTRYPOINTS = [
  'src/jobs/worker-entry.ts',
  'scripts/migrate-and-seed.ts',
  'scripts/migrate.ts',
  'scripts/seed.ts',
];

describe('plain-node entrypoints', () => {
  it.each(NODE_ENTRYPOINTS)('%s pulls in nothing marked server-only', (entry) => {
    const offenders = reachableFiles(entry).filter((file) =>
      /^\s*import ['"]server-only['"]/m.test(readFileSync(file, 'utf8')),
    );
    expect(offenders.map((f) => f.slice(ROOT.length + 1))).toEqual([]);
  });

  it('resolves a realistic number of files, so the walk is not silently empty', () => {
    expect(reachableFiles('src/jobs/worker-entry.ts').length).toBeGreaterThan(10);
  });
});
