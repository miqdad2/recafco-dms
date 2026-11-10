import { type NextRequest, NextResponse } from 'next/server';
import { getUploadOperation, SessionEndedError } from '@/lib/mayan';
import { jsonError, routeSession } from '@/lib/route-helpers';

/**
 * Upload recovery: "was my upload saved?" Answers only about the signed-in
 * user's own operations (Mayan scopes them to the token's user).
 */
export async function GET(request: NextRequest, context: RouteContext<'/api/upload/operations/[id]'>) {
  const session = routeSession(request);
  if (!session) return jsonError(401, 'Please sign in again.');
  const { id } = await context.params;
  try {
    const operation = await getUploadOperation(session.token, id);
    return NextResponse.json(operation, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof SessionEndedError) return jsonError(401, 'Please sign in again.');
    return jsonError(502, 'The document system is not answering. Try again in a moment.');
  }
}
