import { type NextRequest, NextResponse } from 'next/server';
import { getUploadOperation, PasswordChangeRequiredError, SessionEndedError } from '@/lib/mayan';
import { jsonError, routeSession, passwordChangeRequired } from '@/lib/route-helpers';

/**
 * Upload recovery: "was my upload saved?" Answers only about the signed-in
 * user's own operations (Mayan scopes them to the token's user).
 */
export async function GET(request: NextRequest, context: RouteContext<'/api/upload/operations/[id]'>) {
  const session = routeSession(request);
  if (!session) return jsonError(401, 'Please sign in again.');
  if (session.mustChange) return passwordChangeRequired();
  const { id } = await context.params;
  try {
    const operation = await getUploadOperation(session.token, id);
    return NextResponse.json(operation, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof SessionEndedError) return jsonError(401, 'Please sign in again.');
    if (error instanceof PasswordChangeRequiredError) return passwordChangeRequired();
    return jsonError(502, 'The document system is not answering. Try again in a moment.');
  }
}
