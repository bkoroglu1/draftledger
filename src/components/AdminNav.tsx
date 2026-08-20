import Link from 'next/link';

const TABS = [
  { key: 'people', label: 'People' },
  { key: 'teams', label: 'Teams' },
  { key: 'namespaces', label: 'Namespaces' },
  { key: 'templates', label: 'Templates' },
  { key: 'workflows', label: 'Workflows' },
  { key: 'notification-policies', label: 'Notification policies' },
] as const;

export function AdminNav({ active }: { active: (typeof TABS)[number]['key'] }) {
  return (
    <div className="dl-doctabs" role="tablist" aria-label="Administration sections">
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          role="tab"
          aria-selected={active === tab.key}
          className="dl-doctab"
          href={`/admin/${tab.key}`}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
