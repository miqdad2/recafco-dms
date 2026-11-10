'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { config, SESSION_COOKIE } from '@/lib/config';
import { getMe, obtainToken, revokeToken } from '@/lib/mayan';
import {
  createSession,
  deleteSession,
  deleteSessionsForToken,
} from '@/lib/session-store';

export type LoginState = { error?: string; username?: string };

export async function login(
  _previous: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const username = String(formData.get('username') ?? '').trim();
  const password = String(formData.get('password') ?? '');

  if (!username || !password) {
    return { error: 'Enter your username and password.', username };
  }

  let token: string | null;
  try {
    token = await obtainToken(username, password);
  } catch {
    return { error: 'The document system is not responding. Try again soon.', username };
  }
  // Mayan gives the same answer for a wrong password and a disabled account.
  if (!token) return { error: 'Username or password is not correct.', username };

  const me = await getMe(token);
  const sessionId = createSession({
    token,
    username: me.username,
    fullName: me.full_name,
    canUpload: me.can_upload,
    isAdmin: me.is_admin,
  });

  (await cookies()).set(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    path: '/',
    maxAge: Math.floor(config.sessionAbsoluteMs / 1000),
  });
  redirect('/');
}

/**
 * Ends the portal session and deletes the user's Mayan token. Mayan keeps
 * one token per user, so this signs the user out on every device.
 */
export async function logout(): Promise<void> {
  const store = await cookies();
  const session = deleteSession(store.get(SESSION_COOKIE)?.value);
  if (session) {
    try {
      await revokeToken(session.token);
    } catch {
      // The portal session is gone either way; the token never left the server.
    }
    deleteSessionsForToken(session.token);
  }
  store.delete(SESSION_COOKIE);
  redirect('/login?signedout=1');
}
