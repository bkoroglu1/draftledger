export const dynamic = 'force-dynamic';

/** Liveness: the process is up. Does not touch the database. */
export async function GET() {
  return Response.json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) });
}
