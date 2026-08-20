import Link from 'next/link';

const TABS = [
  { key: '', label: 'Status' },
  { key: 'email-expansions', label: 'Email expansions' },
  { key: 'history', label: 'History' },
] as const;

export function DocumentHeader({
  slug,
  title,
  identifier,
  statusLabel,
  statusState,
  active,
  notificationsLabel,
}: {
  slug: string;
  title: string;
  identifier: string;
  statusLabel: string;
  statusState: string;
  active: '' | 'email-expansions' | 'history';
  notificationsLabel?: string;
}) {
  return (
    <>
      <h1 className="dl-page-title">{title}</h1>
      <p className="dl-page-subtitle">
        {identifier}{' '}
        <span className={`dl-status-chip dl-state-${statusState}`}>{statusLabel}</span>{' '}
        <Link href={`/doc/html/${slug}`}>Open in reader</Link>
      </p>
      <div className="dl-doctabs" role="tablist" aria-label="Document detail sections">
        {TABS.map((tab) => (
          <Link
            key={tab.key}
            role="tab"
            aria-selected={active === tab.key}
            className="dl-doctab"
            href={`/doc/${slug}${tab.key ? `/${tab.key}` : ''}`}
          >
            {tab.key === 'email-expansions' ? (notificationsLabel ?? tab.label) : tab.label}
          </Link>
        ))}
      </div>
    </>
  );
}
