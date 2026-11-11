import 'server-only';
import { type NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE } from './config';
import { mayanStream, PasswordChangeRequiredError, SessionEndedError } from './mayan';
import { type Session, touchSession } from './session-store';

export function routeSession(request: NextRequest): Session | null {
  return touchSession(request.cookies.get(SESSION_COOKIE)?.value);
}

export const jsonError = (status: number, message: string) =>
  NextResponse.json({ detail: message }, { status });

/** The account signed in with a temporary password and has not replaced it. */
export const passwordChangeRequired = () =>
  NextResponse.json(
    { code: 'password_change_required', detail: 'Change your temporary password first.' },
    { status: 403 },
  );

/**
 * Rejects cross-site state-changing requests. Browsers always send Origin on
 * POST. Behind a reverse proxy, the proxy must pass the original Host.
 */
export function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function parseId(value: string): number | null {
  return /^[0-9]{1,12}$/.test(value) ? Number(value) : null;
}

const PASS_HEADERS = ['content-type', 'content-length', 'content-disposition', 'last-modified', 'etag'];

/** Streams a Mayan binary response (image, file) to the browser. */
export async function streamFromMayan(session: Session, path: string): Promise<Response> {
  let upstream: Response;
  try {
    upstream = await mayanStream(session.token, path);
  } catch (error) {
    if (error instanceof SessionEndedError) return jsonError(401, 'Please sign in again.');
    if (error instanceof PasswordChangeRequiredError) return passwordChangeRequired();
    throw error;
  }
  if (upstream.status === 404 || upstream.status === 403) {
    return jsonError(404, 'Not found.');
  }
  if (!upstream.ok || !upstream.body) {
    return jsonError(502, 'The document system could not provide this file right now.');
  }
  const headers = new Headers({
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  for (const name of PASS_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(upstream.body, { status: 200, headers });
}
