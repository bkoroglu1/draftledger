import type { Metadata, Viewport } from 'next';
import { settingValues } from '#src/services/settings.ts';
import { PREFS_BOOT_SCRIPT } from '#src/lib/prefs.ts';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const { brandName } = await settingValues();
  return {
    title: {
      default: `${brandName} \u2014 DraftLedger`,
      template: `%s \u2014 ${brandName}`,
    },
    description:
      'Self-hosted standards authoring, review, publication and reading platform.',
  };
}

/**
 * Without this, mobile browsers lay the page out at a virtual desktop width and
 * scale it down — the narrow-screen drawer and the fixed controls would never
 * activate on a real phone.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="auto" suppressHydrationWarning>
      <head>
        {/* Applies stored theme/font/sidebar before first paint, so switching
            themes or reloading never flashes the wrong colours. */}
        <script dangerouslySetInnerHTML={{ __html: PREFS_BOOT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
