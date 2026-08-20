import Link from 'next/link';
import { config } from '#src/lib/config.ts';
import type { Actor } from '#src/services/rbac.ts';
import { hasOrgRole, isAdmin } from '#src/services/rbac.ts';
import { LogoutButton } from './LogoutButton.tsx';

/** Application chrome for every screen except the distraction-free reader. */
export function AppBar({ actor }: { actor: Actor | null }) {
  return (
    <header className="dl-appbar">
      <Link href="/" className="dl-badge">
        {config.app.brandName}
      </Link>
      <nav aria-label="Main">
        <Link href="/">Search</Link>
        {actor ? <Link href="/workspace">Workspace</Link> : null}
        {hasOrgRole(actor, 'author') ? <Link href="/drafts/new">New document</Link> : null}
        {isAdmin(actor) ? <Link href="/admin/notification-policies">Admin</Link> : null}
      </nav>
      <span className="dl-appbar-spacer" />
      {actor ? (
        <span style={{ fontSize: '0.8125rem' }}>
          <Link href={`/people/${actor.handle}`}>{actor.displayName}</Link>{' '}
          <span className="dl-muted">({actor.orgRole})</span> <LogoutButton />
        </span>
      ) : (
        <Link href="/login" className="dl-button">
          Sign in
        </Link>
      )}
      <Link href="/about" className="dl-muted" style={{ fontSize: '0.8125rem' }}>
        About
      </Link>
    </header>
  );
}
