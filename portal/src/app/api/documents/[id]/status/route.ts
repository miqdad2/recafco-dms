import { type NextRequest, NextResponse } from 'next/server';
import { getDocument, SessionEndedError } from '@/lib/mayan';
import { jsonError, parseId, routeSession } from '@/lib/route-helpers';

export async function GET(request: NextRequest, context: RouteContext<'/api/documents/[id]/status'>) {
  const session = routeSession(request);
  if (!session) return jsonError(401, 'Please sign in again.');
  const id = parseId((await context.params).id);
  if (id === null) return jsonError(404, 'Not found.');
  try {
    const document = await getDocument(session.token, id);
    if (!document) return jsonError(404, 'Not found.');
    return NextResponse.json({ state: document.state }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof SessionEndedError) return jsonError(401, 'Please sign in again.');
    throw error;
  }
}
