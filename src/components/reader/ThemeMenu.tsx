'use client';

import { useEffect, useRef, useState } from 'react';
import type { ThemeChoice } from '#src/lib/prefs.ts';

const OPTIONS: Array<{ value: ThemeChoice; label: string; hint: string }> = [
  { value: 'light', label: 'Light', hint: 'Always use the light palette' },
  { value: 'dark', label: 'Dark', hint: 'Always use the dark palette' },
  { value: 'auto', label: 'Auto', hint: 'Follow the operating system setting' },
];

export function ThemeMenu({
  value,
  onChange,
}: {
  value: ThemeChoice;
  onChange: (value: ThemeChoice) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const current = OPTIONS.find((o) => o.value === value) ?? OPTIONS[2]!;

  return (
    <div className="dl-menu" ref={containerRef}>
      <button
        ref={buttonRef}
        type="button"
        className="dl-button"
        aria-haspopup="menu"
        aria-expanded={open}
        title={`Colour theme: ${current.label}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden="true">◐</span>
        <span>{current.label}</span>
        <span className="dl-sr-only">Change colour theme</span>
      </button>
      {open ? (
        <ul className="dl-menu-list" role="menu" aria-label="Colour theme">
          {OPTIONS.map((option) => (
            <li key={option.value} role="none">
              <button
                type="button"
                role="menuitemradio"
                aria-checked={option.value === value}
                title={option.hint}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                  buttonRef.current?.focus();
                }}
              >
                {option.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
