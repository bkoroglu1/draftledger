import { AppBar } from '#src/components/AppBar.tsx';
import { RedeemForm } from '#src/components/RedeemForm.tsx';
import { lookupToken } from '#src/services/people.ts';

export const dynamic = 'force-dynamic';

/**
 * Public redemption page. It reveals nothing about an account until a valid,
 * unused, unexpired token is presented.
 */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const subject = await lookupToken(token);
  const usable = subject?.kind === 'invite';

  return (
    <>
      <AppBar actor={null} />
      <div className="dl-app" style={{ maxWidth: '32rem' }}>
        <h1 className="dl-page-title">
          {usable ? 'Welcome — set your password' : 'This link cannot be used'}
        </h1>
        {usable ? (
          <>
            <p className="dl-page-subtitle">
              You will be signed in as {subject.displayName} once you choose a password.
            </p>
            <RedeemForm token={token} kind="invite" />
          </>
        ) : (
          <p className="dl-error">
            This link has expired, has already been used, or was never valid. Ask an administrator
            to issue a new one.
          </p>
        )}
      </div>
    </>
  );
}
