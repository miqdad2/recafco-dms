import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE } from './config';
import { getMe, type Me, SessionEndedError } from './mayan';
import { type Session, touchSession, updateSessionFlags } from './session-store';

export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  return touchSession(store.get(SESSION_COOKIE)?.value);
}

/** For pages: the session, or a redirect to sign in. */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect('/login?ended=1');
  return session;
}

/**
 * Runs a Mayan call for a page. If Mayan reports that the token no longer
 * works (user disabled, password changed, token revoked), sends the user to
 * sign in again.
 */
export async function withMayan<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof SessionEndedError) redirect('/login?ended=1');
    throw error;
  }
}

/**
 * Re-reads the employee's roles from Mayan (upload permission, admin) and
 * updates the session's display flags. Roles can change while signed in.
 */
export async function refreshRoles(session: Session): Promise<Me> {
  const me = await withMayan(() => getMe(session.token));
  updateSessionFlags(session, { canUpload: me.can_upload, isAdmin: me.is_admin });
  return me;
}
