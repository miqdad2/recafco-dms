import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE } from './config';
import { getMe, type Me, PasswordChangeRequiredError, SessionEndedError } from './mayan';
import { markMustChange, type Session, touchSession, updateSessionFlags } from './session-store';

export const CHANGE_PASSWORD_PATH = '/change-password';

export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  return touchSession(store.get(SESSION_COOKIE)?.value);
}

/**
 * For pages and actions: the session, or a redirect to sign in. A session
 * that must replace its temporary password is sent to the change-password
 * page; Mayan refuses its other requests anyway.
 */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect('/login?ended=1');
  if (session.mustChange) redirect(CHANGE_PASSWORD_PATH);
  return session;
}

/** For the change-password page only: allows a pending password change. */
export async function requireSessionAllowingPasswordChange(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect('/login?ended=1');
  return session;
}

/**
 * Runs a Mayan call for a page. If Mayan reports that the token no longer
 * works (user disabled, password changed or reset, token revoked), sends the
 * user to sign in again. If Mayan reports a pending password change, sends
 * the user to the change-password page.
 */
export async function withMayan<T>(call: () => Promise<T>, session?: Session): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof SessionEndedError) redirect('/login?ended=1');
    if (error instanceof PasswordChangeRequiredError) {
      const current = session ?? (await getSession());
      if (current) markMustChange(current);
      redirect(CHANGE_PASSWORD_PATH);
    }
    throw error;
  }
}

/**
 * Re-reads the employee's roles from Mayan (upload permission, admin) and
 * updates the session's display flags. Roles can change while signed in.
 */
export async function refreshRoles(session: Session): Promise<Me> {
  const me = await withMayan(() => getMe(session.token), session);
  updateSessionFlags(session, { canUpload: me.can_upload, isAdmin: me.is_admin });
  return me;
}
