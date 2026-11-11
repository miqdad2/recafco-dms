import type { NextRequest } from 'next/server';
import { jsonError, parseId, routeSession, streamFromMayan, passwordChangeRequired } from '@/lib/route-helpers';

const WIDTHS = [400, 800, 1200, 1600];

/** Page preview image, fetched from Mayan as the signed-in employee. */
export async function GET(
  request: NextRequest,
  context: RouteContext<'/api/documents/[id]/versions/[versionId]/pages/[pageId]/image'>,
) {
  const session = routeSession(request);
  if (!session) return jsonError(401, 'Please sign in again.');
  if (session.mustChange) return passwordChangeRequired();
  const params = await context.params;
  const [id, versionId, pageId] = [params.id, params.versionId, params.pageId].map(parseId);
  if (id === null || versionId === null || pageId === null) return jsonError(404, 'Not found.');

  const requested = Number(request.nextUrl.searchParams.get('width')) || 1200;
  const width = WIDTHS.reduce((best, w) => (Math.abs(w - requested) < Math.abs(best - requested) ? w : best));

  return streamFromMayan(
    session,
    `/documents/${id}/versions/${versionId}/pages/${pageId}/image/?width=${width}`,
  );
}
