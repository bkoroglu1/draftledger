import { AppBar } from '#src/components/AppBar.tsx';
import { LoginForm } from '#src/components/LoginForm.tsx';
import { getActor } from '#src/services/auth.ts';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const actor = await getActor();

  return (
    <>
      <AppBar actor={actor} />
      <div className="dl-app" style={{ maxWidth: '28rem' }}>
        <h1 className="dl-page-title">Sign in</h1>
        <LoginForm next={next ?? '/workspace'} />
      </div>
    </>
  );
}
