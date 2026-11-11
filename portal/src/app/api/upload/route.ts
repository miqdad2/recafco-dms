import { type NextRequest, NextResponse } from 'next/server';
import { config } from '@/lib/config';
import { getMe, getUploadOperation, mayanRaw, PasswordChangeRequiredError, SessionEndedError } from '@/lib/mayan';
import { deleteSessionsForToken } from '@/lib/session-store';
import { isSameOrigin, jsonError, routeSession, passwordChangeRequired } from '@/lib/route-helpers';

const OPERATION_ID = /^[A-Za-z0-9-]{16,64}$/;

/**
 * Streams the browser's multipart upload straight to the RECAFCO extension
 * without buffering it here. The extension accepts only file, department,
 * category, label, operation_id and (administrators) confidential_group, and
 * takes the uploader from the employee's token.
 *
 * The browser also sends the operation ID in the X-Upload-Operation header.
 * If the connection to Mayan drops, this route does NOT resend the upload
 * (the body is a one-time stream, and a blind retry could duplicate it). It
 * asks Mayan what happened to that operation and returns the definite
 * answer, or tells the browser that the result is not known yet.
 */
export async function POST(request: NextRequest) {
  const session = routeSession(request);
  if (!session) return jsonError(401, 'Please sign in again.');
  if (session.mustChange) return passwordChangeRequired();
  if (!isSameOrigin(request)) return jsonError(403, 'Request blocked.');

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.startsWith('multipart/form-data')) {
    return jsonError(415, 'Send the document as a form upload.');
  }

  const length = Number(request.headers.get('content-length'));
  if (!Number.isFinite(length) || length <= 0) {
    return jsonError(411, 'The upload size is missing.');
  }
  if (length > config.maxUploadBytes) {
    const mb = Math.round(config.maxUploadBytes / 1024 / 1024);
    return jsonError(413, `The file is too large. The limit is ${mb} MB.`);
  }
  if (!request.body) return jsonError(400, 'The upload is empty.');

  const operationId = request.headers.get('x-upload-operation') ?? '';
  if (!OPERATION_ID.test(operationId)) {
    return jsonError(400, 'The upload ID is missing. Reload the page and try again.');
  }

  let upstream: Response;
  try {
    upstream = await mayanRaw(session.token, '/recafco/uploads/', {
      method: 'POST',
      body: request.body,
      headers: { 'Content-Type': contentType, 'Content-Length': String(length) },
      // Required by Node's fetch for a streamed request body.
      duplex: 'half',
    } as RequestInit);
  } catch {
    return await resolveAfterLostReply(session.token, operationId);
  }

  if (upstream.status === 401 || upstream.status === 403) {
    try {
      await getMe(session.token);
    } catch (error) {
      if (error instanceof SessionEndedError) {
        deleteSessionsForToken(session.token);
        return jsonError(401, 'Please sign in again.');
      }
      if (error instanceof PasswordChangeRequiredError) return passwordChangeRequired();
    }
    return jsonError(403, 'You do not have permission to upload this document.');
  }

  let body: unknown;
  try {
    body = await upstream.json();
  } catch {
    // The reply was cut off: the upload may or may not be saved.
    return await resolveAfterLostReply(session.token, operationId);
  }
  if (upstream.status >= 500) {
    return await resolveAfterLostReply(session.token, operationId);
  }
  return NextResponse.json(body, { status: upstream.status });
}

/**
 * The connection to Mayan failed. Ask Mayan what happened to the operation:
 * - completed -> return the saved document (as a normal success),
 * - failed / never received -> tell the browser it was not saved,
 * - still saving, or Mayan unreachable -> "not known yet" (the browser checks
 *   again with GET /api/upload/operations/{id}).
 */
async function resolveAfterLostReply(token: string, operationId: string) {
  try {
    const operation = await getUploadOperation(token, operationId);
    if (operation.state === 'completed' && operation.document) {
      return NextResponse.json(operation.document, { status: 200 });
    }
    if (operation.state === 'failed' || operation.state === 'not_found') {
      return NextResponse.json(
        {
          code: 'not_saved',
          operation_id: operationId,
          detail: 'The connection was lost and the upload was not saved. You can upload it again safely.',
        },
        { status: 503 },
      );
    }
  } catch (error) {
    if (error instanceof SessionEndedError) return jsonError(401, 'Please sign in again.');
    if (error instanceof PasswordChangeRequiredError) return passwordChangeRequired();
  }
  return NextResponse.json(
    {
      code: 'unknown',
      operation_id: operationId,
      detail: 'The connection was lost. We are checking whether your upload was saved.',
    },
    { status: 504 },
  );
}
