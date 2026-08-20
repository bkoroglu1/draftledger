/**
 * Reader preferences.
 *
 * Two storage locations on purpose:
 *  - localStorage holds everything (versioned, migrated, corruption-tolerant);
 *  - a cookie mirrors only the two prefs that change server rendering, so the
 *    first paint from the server already matches the user's choice.
 */

export const PREFS_STORAGE_KEY = 'draftledger.reader.prefs';
export const PREFS_VERSION = 2;
export const RENDER_PREFS_COOKIE = 'dl_render_prefs';

export type ThemeChoice = 'light' | 'dark' | 'auto';
export type HtmlizationMode = 'htmlize-plaintext' | 'plaintextify-html';
export type CitationMode = 'reference-section' | 'linked-document';
export type PageDependencies = 'inline' | 'reference';
export type SidebarTab = 'info' | 'contents' | 'prefs';

export interface ReaderPrefs {
  version: number;
  theme: ThemeChoice;
  /** Desktop default is yes, mobile default is no, until the user chooses. */
  showSidebar: boolean | null;
  defaultTab: 'info' | 'contents';
  htmlization: HtmlizationMode;
  fontSizePt: number;
  pageDependencies: PageDependencies;
  citationLinks: CitationMode;
}

export const DEFAULT_PREFS: ReaderPrefs = {
  version: PREFS_VERSION,
  theme: 'auto',
  showSidebar: null,
  defaultTab: 'info',
  htmlization: 'htmlize-plaintext',
  fontSizePt: 12,
  pageDependencies: 'inline',
  citationLinks: 'reference-section',
};

export const MIN_FONT_PT = 7;
export const MAX_FONT_PT = 16;

const THEMES: ThemeChoice[] = ['light', 'dark', 'auto'];
const HTMLIZATIONS: HtmlizationMode[] = ['htmlize-plaintext', 'plaintextify-html'];
const CITATIONS: CitationMode[] = ['reference-section', 'linked-document'];
const DEPENDENCIES: PageDependencies[] = ['inline', 'reference'];

/** Never throws: unknown or corrupted values fall back to the safe default. */
export function normalizePrefs(input: unknown): ReaderPrefs {
  if (!input || typeof input !== 'object') return { ...DEFAULT_PREFS };
  const raw = input as Partial<ReaderPrefs>;
  const font = Number(raw.fontSizePt);
  return {
    version: PREFS_VERSION,
    theme: THEMES.includes(raw.theme as ThemeChoice) ? (raw.theme as ThemeChoice) : DEFAULT_PREFS.theme,
    showSidebar: typeof raw.showSidebar === 'boolean' ? raw.showSidebar : null,
    defaultTab: raw.defaultTab === 'contents' ? 'contents' : 'info',
    htmlization: HTMLIZATIONS.includes(raw.htmlization as HtmlizationMode)
      ? (raw.htmlization as HtmlizationMode)
      : DEFAULT_PREFS.htmlization,
    fontSizePt: Number.isFinite(font)
      ? Math.min(MAX_FONT_PT, Math.max(MIN_FONT_PT, Math.round(font)))
      : DEFAULT_PREFS.fontSizePt,
    pageDependencies: DEPENDENCIES.includes(raw.pageDependencies as PageDependencies)
      ? (raw.pageDependencies as PageDependencies)
      : DEFAULT_PREFS.pageDependencies,
    citationLinks: CITATIONS.includes(raw.citationLinks as CitationMode)
      ? (raw.citationLinks as CitationMode)
      : DEFAULT_PREFS.citationLinks,
  };
}

export interface RenderPrefs {
  htmlization: HtmlizationMode;
  citationLinks: CitationMode;
  pageDependencies: PageDependencies;
}

export function parseRenderPrefsCookie(value: string | undefined): RenderPrefs {
  if (!value) {
    return {
      htmlization: DEFAULT_PREFS.htmlization,
      citationLinks: DEFAULT_PREFS.citationLinks,
      pageDependencies: DEFAULT_PREFS.pageDependencies,
    };
  }
  const parts = new Map(
    value.split('|').map((chunk) => {
      const [k, v] = chunk.split(':');
      return [k ?? '', v ?? ''] as const;
    }),
  );
  const htmlization = parts.get('h') === 'p' ? 'plaintextify-html' : 'htmlize-plaintext';
  const citationLinks = parts.get('c') === 'd' ? 'linked-document' : 'reference-section';
  const pageDependencies = parts.get('d') === 'r' ? 'reference' : 'inline';
  return { htmlization, citationLinks, pageDependencies };
}

export function serializeRenderPrefsCookie(prefs: ReaderPrefs): string {
  return [
    `h:${prefs.htmlization === 'plaintextify-html' ? 'p' : 'h'}`,
    `c:${prefs.citationLinks === 'linked-document' ? 'd' : 'r'}`,
    `d:${prefs.pageDependencies === 'reference' ? 'r' : 'i'}`,
  ].join('|');
}

/** Inlined into the document head so theme/font never flash on hydration. */
export const PREFS_BOOT_SCRIPT = `
(function () {
  try {
    var raw = localStorage.getItem(${JSON.stringify(PREFS_STORAGE_KEY)});
    var p = raw ? JSON.parse(raw) : null;
    if (!p || p.version !== ${PREFS_VERSION}) p = null;
    var root = document.documentElement;
    root.dataset.theme = (p && ['light','dark','auto'].indexOf(p.theme) >= 0) ? p.theme : 'auto';
    var size = p && Number(p.fontSizePt);
    if (size >= ${MIN_FONT_PT} && size <= ${MAX_FONT_PT}) {
      root.style.setProperty('--dl-reader-font-size', size + 'pt');
    }
    var wide = window.matchMedia('(min-width: 768px)').matches;
    var show = (p && typeof p.showSidebar === 'boolean') ? p.showSidebar : wide;
    root.dataset.sidebarBoot = show ? 'open' : 'closed';
  } catch (e) {
    document.documentElement.dataset.theme = 'auto';
  }
})();
`;
