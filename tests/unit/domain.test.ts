import { describe, expect, it } from 'vitest';
import { canTransition, LIFECYCLE_STATES } from '#src/domain/types.ts';
import { appError, httpStatusFor, isAppError } from '#src/domain/errors.ts';
import {
  DEFAULT_PREFS,
  normalizePrefs,
  parseRenderPrefsCookie,
  serializeRenderPrefsCookie,
} from '#src/lib/prefs.ts';
import { appendixLetter, dedupeAnchor, sectionAnchor, slugify } from '#src/parser/anchors.ts';
import { hashPassword, verifyPassword, sha256 } from '#src/lib/hash.ts';
import { artifactKey, sourceKey } from '#src/lib/storage.ts';
import { safeHref, escapeHtml } from '#src/render/escape.ts';

describe('lifecycle', () => {
  it('allows the documented transitions', () => {
    expect(canTransition('drafting', 'review')).toBe(true);
    expect(canTransition('review', 'changes-requested')).toBe(true);
    expect(canTransition('approved', 'publishing')).toBe(true);
    expect(canTransition('publishing', 'published')).toBe(true);
  });

  it('refuses to jump straight from drafting to published', () => {
    expect(canTransition('drafting', 'published')).toBe(false);
    expect(canTransition('published', 'drafting')).toBe(false);
  });

  it('treats historic as terminal', () => {
    expect(LIFECYCLE_STATES).toContain('historic');
    expect(canTransition('historic', 'drafting')).toBe(false);
  });
});

describe('typed errors', () => {
  it('maps codes to http statuses', () => {
    expect(httpStatusFor(appError('not_found'))).toBe(404);
    expect(httpStatusFor(appError('forbidden'))).toBe(403);
    expect(httpStatusFor(appError('stale_approval'))).toBe(409);
    expect(httpStatusFor(new Error('boom'))).toBe(500);
  });

  it('serializes to a stable json shape', () => {
    const error = appError('invalid_slug', 'bad slug', { slug: 'x' });
    expect(isAppError(error)).toBe(true);
    expect(error.toJSON()).toEqual({ error: 'invalid_slug', message: 'bad slug', details: { slug: 'x' } });
  });
});

describe('anchors', () => {
  it('produces stable section and appendix anchors', () => {
    expect(sectionAnchor('4.1.2', 'Validation', false)).toBe('section-4.1.2');
    expect(sectionAnchor('B', 'Extras', true)).toBe('appendix-b');
    expect(sectionAnchor(null, 'Free Standing Title', false)).toBe('sec-free-standing-title');
  });

  it('deduplicates deterministically', () => {
    const seen = new Set<string>();
    expect(dedupeAnchor('section-1', seen)).toBe('section-1');
    expect(dedupeAnchor('section-1', seen)).toBe('section-1-2');
    expect(dedupeAnchor('section-1', seen)).toBe('section-1-3');
  });

  it('counts appendix letters past Z', () => {
    expect(appendixLetter(1)).toBe('A');
    expect(appendixLetter(26)).toBe('Z');
    expect(appendixLetter(27)).toBe('AA');
  });

  it('slugifies unicode titles', () => {
    expect(slugify('Örnek Belge Başlığı')).toBe('ornek-belge-basligi');
  });
});

describe('reader preferences', () => {
  it('falls back to defaults on corrupt storage', () => {
    expect(normalizePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(normalizePrefs('nonsense')).toEqual(DEFAULT_PREFS);
    expect(normalizePrefs({ theme: 'neon', fontSizePt: 'x' }).theme).toBe('auto');
  });

  it('clamps the font size to the supported range', () => {
    expect(normalizePrefs({ fontSizePt: 2 }).fontSizePt).toBe(7);
    expect(normalizePrefs({ fontSizePt: 99 }).fontSizePt).toBe(16);
    expect(DEFAULT_PREFS.fontSizePt).toBe(12);
  });

  it('round-trips the render-affecting cookie', () => {
    const prefs = normalizePrefs({
      htmlization: 'plaintextify-html',
      citationLinks: 'linked-document',
      pageDependencies: 'reference',
    });
    const cookie = serializeRenderPrefsCookie(prefs);
    expect(parseRenderPrefsCookie(cookie)).toEqual({
      htmlization: 'plaintextify-html',
      citationLinks: 'linked-document',
      pageDependencies: 'reference',
    });
    expect(parseRenderPrefsCookie(undefined).htmlization).toBe('htmlize-plaintext');
  });
});

describe('credentials and checksums', () => {
  it('verifies its own password hashes', () => {
    const hash = hashPassword('correct horse');
    expect(verifyPassword('correct horse', hash)).toBe(true);
    expect(verifyPassword('wrong', hash)).toBe(false);
    expect(verifyPassword('correct horse', null)).toBe(false);
  });

  it('hashes sources deterministically', () => {
    expect(sha256('abc')).toBe(sha256('abc'));
    expect(sha256('abc')).not.toBe(sha256('abd'));
  });
});

describe('storage keys and url safety', () => {
  it('scopes artifacts by revision and checksum', () => {
    expect(artifactKey('TEST-STD-0001-PUBLISHED', 'a'.repeat(64), 'txt')).toBe(
      'revisions/TEST-STD-0001-PUBLISHED/aaaaaaaaaaaa.txt',
    );
    expect(sourceKey('DRAFT-X-00', 'b'.repeat(64), 'markdown')).toContain('sources/DRAFT-X-00/');
  });

  it('rejects dangerous urls', () => {
    expect(safeHref('https://example.invalid')).toBe('https://example.invalid');
    expect(safeHref('mailto:a@example.invalid')).toBe('mailto:a@example.invalid');
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('data:text/html,<script>')).toBeNull();
    expect(safeHref('//evil.invalid')).toBeNull();
  });

  it('escapes html metacharacters', () => {
    expect(escapeHtml('<a href="x">&</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
  });
});
