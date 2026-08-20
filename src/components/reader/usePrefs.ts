'use client';

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import {
  DEFAULT_PREFS,
  PREFS_STORAGE_KEY,
  RENDER_PREFS_COOKIE,
  normalizePrefs,
  serializeRenderPrefsCookie,
  type ReaderPrefs,
} from '#src/lib/prefs.ts';

/**
 * Persisted reader preferences. Storage is versioned and corruption-tolerant:
 * an unreadable or outdated payload falls back to defaults instead of throwing.
 */
/**
 * Storage-backed preference store. Reading through `useSyncExternalStore`
 * keeps the server render on defaults and swaps in the stored values after
 * hydration, without a cascading setState-in-effect.
 */
const listeners = new Set<() => void>();
let cachedRaw: string | null = null;
let cachedPrefs: ReaderPrefs = DEFAULT_PREFS;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

function readSnapshot(): ReaderPrefs {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(PREFS_STORAGE_KEY);
  } catch {
    raw = null;
  }
  // Cached so the snapshot is referentially stable between renders.
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    try {
      cachedPrefs = raw ? normalizePrefs(JSON.parse(raw)) : DEFAULT_PREFS;
    } catch {
      cachedPrefs = DEFAULT_PREFS;
    }
  }
  return cachedPrefs;
}

function serverSnapshot(): ReaderPrefs {
  return DEFAULT_PREFS;
}

export function usePrefs(): {
  prefs: ReaderPrefs;
  ready: boolean;
  update: (patch: Partial<ReaderPrefs>) => ReaderPrefs;
} {
  const prefs = useSyncExternalStore(subscribe, readSnapshot, serverSnapshot);
  const hydrated = useRef(false);
  useEffect(() => {
    hydrated.current = true;
  }, []);

  const update = useCallback(
    (patch: Partial<ReaderPrefs>) => {
      const next = normalizePrefs({ ...readSnapshot(), ...patch });
      try {
        window.localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Private mode or full storage: preferences stay session-only.
        cachedRaw = JSON.stringify(next);
        cachedPrefs = next;
      }
      // Mirror the render-affecting prefs so SSR agrees with the client.
      document.cookie = `${RENDER_PREFS_COOKIE}=${encodeURIComponent(
        serializeRenderPrefsCookie(next),
      )}; path=/; max-age=31536000; samesite=lax`;
      for (const listener of listeners) listener();
      return next;
    },
    [],
  );

  return { prefs, ready: true, update };
}

/** Applies theme + font size to the document element. */
export function useAppliedPrefs(prefs: ReaderPrefs, ready: boolean): void {
  useEffect(() => {
    if (!ready) return;
    const root = document.documentElement;
    root.dataset.theme = prefs.theme;
    root.style.setProperty('--dl-reader-font-size', `${prefs.fontSizePt}pt`);
  }, [prefs.theme, prefs.fontSizePt, ready]);

  // `auto` must follow live OS changes, not just the value at load time.
  useEffect(() => {
    if (prefs.theme !== 'auto') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const sync = () => {
      document.documentElement.dataset.theme = 'auto';
    };
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, [prefs.theme]);
}
