import type { NextRequest } from 'next/server';
import { jsonError, parseId, routeSession, streamFromMayan, passwordChangeRequired } from '@/lib/route-helpers';

/** Original file download, streamed from Mayan as the signed-in employee. */
export async function GET(
  request: NextRequest,
  context: RouteContext<'/api/documents/[id]/files/[fileId]/download'>,
) {
  const session = routeSession(request);
  if (!session) return jsonError(401, 'Please sign in again.');
  if (session.mustChange) return passwordChangeRequired();
  const params = await context.params;
  const id = parseId(params.id);
  const fileId = parseId(params.fileId);
  if (id === null || fileId === null) return jsonError(404, 'Not found.');
  return streamFromMayan(session, `/documents/${id}/files/${fileId}/download/`);
}
