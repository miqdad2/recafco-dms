import { type NextRequest, NextResponse } from 'next/server';
import { config } from '@/lib/config';
import { mayanRaw, getMe, SessionEndedError } from '@/lib/mayan';
import { deleteSessionsForToken } from '@/lib/session-store';
import { isSameOrigin, jsonError, routeSession } from '@/lib/route-helpers';

/**
 * Streams the browser's multipart upload straight to the RECAFCO extension
 * without buffering it here. The extension accepts only file, department,
 * category and label, and takes the uploader from the employee's token.
 * Nothing in the request can choose a user or an access level.
 */
export async function POST(request: NextRequest) {
  const session = routeSession(request);
  if (!session) return jsonError(401, 'Please sign in again.');
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

  const upstream = await mayanRaw(session.token, '/recafco/uploads/', {
    method: 'POST',
    body: request.body,
    headers: { 'Content-Type': contentType, 'Content-Length': String(length) },
    // Required by Node's fetch for a streamed request body.
    duplex: 'half',
  } as RequestInit);

  if (upstream.status === 401 || upstream.status === 403) {
    try {
      await getMe(session.token);
    } catch (error) {
      if (error instanceof SessionEndedError) {
        deleteSessionsForToken(session.token);
        return jsonError(401, 'Please sign in again.');
      }
    }
    return jsonError(403, 'You do not have permission to upload documents.');
  }

  let body: unknown;
  try {
    body = await upstream.json();
  } catch {
    return jsonError(502, 'The document system did not accept the upload. Try again.');
  }
  if (upstream.status >= 500) {
    return jsonError(502, 'The document system could not save the upload. Try again.');
  }
  return NextResponse.json(body, { status: upstream.status });
}
