'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import type { ReaderPrefs, SidebarTab } from '#src/lib/prefs.ts';
import { ContentsTree, type ContentsItem } from './ContentsTree.tsx';
import { PrefsPanel } from './PrefsPanel.tsx';
import { ThemeMenu } from './ThemeMenu.tsx';
import { useAppliedPrefs, usePrefs } from './usePrefs.ts';

const TABS: Array<{ id: SidebarTab; label: string }> = [
  { id: 'info', label: 'Info' },
  { id: 'contents', label: 'Contents' },
  { id: 'prefs', label: 'Prefs' },
];

export interface ReaderShellProps {
  brandName: string;
  documentLabel: string;
  documentHref: string;
  statusLabel: string;
  statusState: string;
  pages: string[];
  contents: ContentsItem[];
  info: React.ReactNode;
  htmlAvailable: boolean;
  /** Modes that changed server-side output need a refresh to take effect. */
  activeHtmlization: ReaderPrefs['htmlization'];
  activeCitationMode: ReaderPrefs['citationLinks'];
  bugReportUrl: string;
}

export function ReaderShell(props: ReaderShellProps) {
  const router = useRouter();
  const { prefs, ready, update } = usePrefs();
  useAppliedPrefs(prefs, ready);

  const [sidebarOverride, setSidebarOverride] = useState<boolean | null>(null);
  const [tabOverride, setTabOverride] = useState<SidebarTab | null>(null);
  const [activeAnchor, setActiveAnchor] = useState<string | null>(null);
  const isNarrow = useIsNarrow();

  const toggleRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const panelId = useId();

  // Precedence: this session's toggle, then the stored preference, then the
  // device default (open on desktop, closed on narrow screens).
  const open = sidebarOverride ?? prefs.showSidebar ?? !isNarrow;
  const tab = tabOverride ?? prefs.defaultTab;
  const setSidebarOpen = useCallback(
    (next: boolean | ((current: boolean) => boolean)) =>
      setSidebarOverride((current) => {
        const resolved = current ?? prefs.showSidebar ?? !isNarrow;
        return typeof next === 'function' ? next(resolved) : next;
      }),
    [prefs.showSidebar, isNarrow],
  );
  const setTab = useCallback((next: SidebarTab) => setTabOverride(next), []);

  // Active section tracking. Headings are spans inside the <pre> page blocks.
  // The observer reacts to crossings; a throttled scroll/resize recompute keeps
  // the state correct when no heading happens to sit inside the band.
  useEffect(() => {
    const anchors = props.contents.map((c) => c.anchor);
    if (!anchors.length) return;
    const elements = anchors
      .map((anchor) => document.getElementById(anchor))
      .filter((el): el is HTMLElement => Boolean(el));
    if (!elements.length) return;

    const recompute = () => {
      let best: HTMLElement | null = null;
      for (const el of elements) {
        const top = el.getBoundingClientRect().top;
        if (top <= 96) best = el;
        else break;
      }
      const next = best ?? elements[0]!;
      setActiveAnchor((current) => (current === next.id ? current : next.id));
    };

    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        recompute();
      });
    };

    const observer = new IntersectionObserver(schedule, {
      rootMargin: '-8% 0px -70% 0px',
      threshold: [0, 1],
    });
    for (const el of elements) observer.observe(el);

    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    recompute();

    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [props.contents]);

  // Keep the active entry visible without hijacking manual panel scrolling.
  const contentsScrollRef = useRef<HTMLDivElement>(null);
  const lastUserScroll = useRef(0);
  useEffect(() => {
    if (tab !== 'contents' || !activeAnchor) return;
    if (Date.now() - lastUserScroll.current < 1500) return;
    const container = contentsScrollRef.current;
    const target = container?.querySelector<HTMLElement>(`[data-anchor="${CSS.escape(activeAnchor)}"]`);
    if (!container || !target) return;
    const top = target.offsetTop;
    const bottom = top + target.offsetHeight;
    if (top < container.scrollTop || bottom > container.scrollTop + container.clientHeight) {
      target.scrollIntoView({ block: 'nearest' });
    }
  }, [activeAnchor, tab]);

  // Drawer behaviour on narrow screens: focus trap, Escape, focus return.
  useEffect(() => {
    if (!isNarrow || !open) return;
    const node = sidebarRef.current;
    if (!node) return;
    const focusables = () =>
      Array.from(
        node.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      );
    focusables()[0]?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSidebarOpen(false);
        toggleRef.current?.focus();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (!items.length) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isNarrow, open, setSidebarOpen]);

  const onPrefsChange = useCallback(
    (patch: Partial<ReaderPrefs>) => {
      const next = update(patch);
      // Only these two change what the server renders.
      if (
        (patch.htmlization && patch.htmlization !== props.activeHtmlization) ||
        (patch.citationLinks && patch.citationLinks !== props.activeCitationMode)
      ) {
        const anchor = window.location.hash;
        router.refresh();
        if (anchor) {
          window.setTimeout(() => {
            document.getElementById(anchor.slice(1))?.scrollIntoView({ block: 'start' });
          }, 250);
        }
      }
    },
    [update, router, props.activeHtmlization, props.activeCitationMode],
  );

  const onTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const keys: Record<string, number> = {
      ArrowRight: index + 1,
      ArrowLeft: index - 1,
      Home: 0,
      End: TABS.length - 1,
    };
    const nextIndex = keys[event.key];
    if (nextIndex === undefined) return;
    event.preventDefault();
    const wrapped = (nextIndex + TABS.length) % TABS.length;
    setTab(TABS[wrapped]!.id);
    tabRefs.current[wrapped]?.focus();
  };

  const contents = useMemo(() => props.contents, [props.contents]);

  return (
    <div className="dl-reader" data-sidebar={open ? 'open' : 'closed'}>
      <a className="dl-skip-link" href="#dl-document">
        Skip to document text
      </a>

      <div className="dl-toolbar dl-no-print">
        <ThemeMenu value={prefs.theme} onChange={(theme) => onPrefsChange({ theme })} />
        <button
          ref={toggleRef}
          type="button"
          className="dl-button"
          aria-expanded={open}
          aria-controls={panelId}
          aria-pressed={open}
          title={open ? 'Hide document metadata' : 'Show document metadata'}
          onClick={() => setSidebarOpen((v) => !v)}
        >
          <span aria-hidden="true">☰</span>
          <span className="dl-sr-only">
            {open ? 'Hide document metadata panel' : 'Show document metadata panel'}
          </span>
        </button>
      </div>

      <main className="dl-reader-main" id="dl-document">
        <div className="dl-pages">
          {props.pages.map((html, index) => (
            // Page markup is produced by our own HTMLizer: text is escaped and
            // only anchors/spans are added.
            <div key={index} dangerouslySetInnerHTML={{ __html: html }} />
          ))}
        </div>
      </main>

      {open && isNarrow ? (
        <button
          type="button"
          className="dl-backdrop dl-no-print"
          aria-label="Close metadata panel"
          onClick={() => {
            setSidebarOpen(false);
            toggleRef.current?.focus();
          }}
        />
      ) : null}

      {open ? (
        <aside
          ref={sidebarRef}
          id={panelId}
          className="dl-sidebar"
          aria-label="Document metadata"
          role={isNarrow ? 'dialog' : undefined}
          aria-modal={isNarrow ? true : undefined}
        >
          <div className="dl-sidebar-header">
            <div className="dl-sidebar-identity">
              <a className="dl-badge" href={props.documentHref}>
                {props.brandName}
              </a>
              <a className="dl-doc-id" href={props.documentHref}>
                {props.documentLabel}
              </a>
              <span className={`dl-status-chip dl-state-${props.statusState}`}>
                {props.statusLabel}
              </span>
            </div>
            <div className="dl-tablist" role="tablist" aria-label="Document metadata sections">
              {TABS.map((t, index) => (
                <button
                  key={t.id}
                  ref={(el) => {
                    tabRefs.current[index] = el;
                  }}
                  type="button"
                  role="tab"
                  id={`${panelId}-tab-${t.id}`}
                  aria-selected={tab === t.id}
                  aria-controls={`${panelId}-panel-${t.id}`}
                  tabIndex={tab === t.id ? 0 : -1}
                  className="dl-tab"
                  onClick={() => setTab(t.id)}
                  onKeyDown={(event) => onTabKeyDown(event, index)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div
            className="dl-sidebar-body"
            ref={contentsScrollRef}
            onScroll={() => {
              lastUserScroll.current = Date.now();
            }}
          >
            <div
              role="tabpanel"
              id={`${panelId}-panel-info`}
              aria-labelledby={`${panelId}-tab-info`}
              hidden={tab !== 'info'}
              tabIndex={0}
            >
              {props.info}
            </div>
            <div
              role="tabpanel"
              id={`${panelId}-panel-contents`}
              aria-labelledby={`${panelId}-tab-contents`}
              hidden={tab !== 'contents'}
              tabIndex={0}
            >
              <ContentsTree items={contents} activeAnchor={activeAnchor} />
            </div>
            <div
              role="tabpanel"
              id={`${panelId}-panel-prefs`}
              aria-labelledby={`${panelId}-tab-prefs`}
              hidden={tab !== 'prefs'}
              tabIndex={0}
            >
              <PrefsPanel
                prefs={prefs}
                onChange={onPrefsChange}
                htmlAvailable={props.htmlAvailable}
              />
              <p className="dl-pref-hint">
                <a href={props.bugReportUrl} rel="noopener noreferrer nofollow" target="_blank">
                  Report a reader bug
                </a>{' '}
                — issues with this reader go to this installation&apos;s tracker.
              </p>
            </div>
          </div>
        </aside>
      ) : null}
    </div>
  );
}

/** Tracks the narrow-screen breakpoint without a setState-in-effect cascade. */
function useIsNarrow(): boolean {
  const subscribe = useCallback((listener: () => void) => {
    const media = window.matchMedia('(max-width: 767px)');
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, []);
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia('(max-width: 767px)').matches,
    () => false,
  );
}
