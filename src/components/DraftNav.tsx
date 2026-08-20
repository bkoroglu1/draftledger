import Link from 'next/link';

const TABS = [
  { key: 'edit', label: 'Edit' },
  { key: 'settings', label: 'Settings' },
  { key: 'revisions', label: 'Revisions' },
  { key: 'reviews', label: 'Reviews' },
  { key: 'compare', label: 'Compare' },
  { key: 'publish', label: 'Publish' },
] as const;

export function DraftNav({
  slug,
  title,
  status,
  active,
}: {
  slug: string;
  title: string;
  status: string;
  active: (typeof TABS)[number]['key'];
}) {
  return (
    <>
      <h1 className="dl-page-title">{title}</h1>
      <p className="dl-page-subtitle">
        {slug} <span className={`dl-status-chip dl-state-${status}`}>{status}</span>{' '}
        <Link href={`/doc/html/${slug}`}>Open in reader</Link>{' · '}
        <Link href={`/doc/${slug}`}>Status</Link>
      </p>
      <div className="dl-doctabs" role="tablist" aria-label="Draft workspace sections">
        {TABS.map((tab) => (
          <Link
            key={tab.key}
            role="tab"
            aria-selected={active === tab.key}
            className="dl-doctab"
            href={`/drafts/${slug}/${tab.key}`}
          >
            {tab.label}
          </Link>
        ))}
      </div>
    </>
  );
}
