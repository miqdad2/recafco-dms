import { type NextRequest } from 'next/server';
import { mayanRaw } from '@/lib/mayan';
import { jsonError, passwordChangeRequired, routeSession } from '@/lib/route-helpers';

const FILTERS = ['q', 'action', 'target_type', 'outcome', 'actor', 'date_from', 'date_to'];

/**
 * CSV export of the (filtered) activity log. The extension checks the
 * "activity.view" permission with the person's own token; the token never
 * reaches the browser.
 */
export async function GET(request: NextRequest) {
  const session = routeSession(request);
  if (!session) return jsonError(401, 'Please sign in again.');
  if (session.mustChange) return passwordChangeRequired();
  const params = new URLSearchParams();
  for (const name of FILTERS) {
    const value = request.nextUrl.searchParams.get(name);
    if (value) params.set(name, value.slice(0, 200));
  }
  const upstream = await mayanRaw(session.token, `/recafco/admin/audit/export/?${params}`, {
    headers: { Accept: 'text/csv' },
  });
  if (upstream.status === 401 || upstream.status === 403) return jsonError(403, 'You do not have permission to export the activity log.');
  if (upstream.status === 400) return jsonError(400, 'Check the filters.');
  if (!upstream.ok || !upstream.body) return jsonError(502, 'The activity log could not be exported right now.');
  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="recafco-activity-log.csv"',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
