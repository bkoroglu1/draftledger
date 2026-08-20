'use client';

import { useCallback } from 'react';

export interface ContentsItem {
  anchor: string;
  number: string | null;
  title: string;
  depth: number;
  isAppendix: boolean;
  pageNumber: number | null;
}

export function ContentsTree({
  items,
  activeAnchor,
  parserNote,
}: {
  items: ContentsItem[];
  activeAnchor: string | null;
  parserNote?: string;
}) {
  const onSelect = useCallback((event: React.MouseEvent<HTMLAnchorElement>, anchor: string) => {
    const target = document.getElementById(anchor);
    if (!target) return; // Let the browser fall back to normal anchor handling.
    event.preventDefault();
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    history.replaceState(null, '', `#${anchor}`);
    target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  }, []);

  if (!items.length) {
    return (
      <p className="dl-muted">
        {parserNote ??
          'No sections were extracted from this revision. The parser found no headings — check the source structure or the render diagnostics.'}
      </p>
    );
  }

  return (
    <ul className="dl-contents-tree">
      {items.map((item) => (
        <li key={item.anchor}>
          <a
            href={`#${item.anchor}`}
            aria-current={item.anchor === activeAnchor ? 'true' : undefined}
            style={{ paddingLeft: `${(item.depth - 1) * 0.85 + 0.25}rem` }}
            onClick={(event) => onSelect(event, item.anchor)}
            data-anchor={item.anchor}
          >
            {item.number ? (
              <span className="dl-contents-number">
                {item.isAppendix ? `${item.number}.` : `${item.number}.`}
              </span>
            ) : null}
            <span className="dl-contents-title">{item.title}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
