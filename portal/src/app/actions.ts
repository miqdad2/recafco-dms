'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { CHANGE_PASSWORD_PATH } from '@/lib/auth';
import { config, SESSION_COOKIE } from '@/lib/config';
import { revokeToken, signIn } from '@/lib/mayan';
import {
  createSession,
  deleteSession,
  deleteSessionsForToken,
} from '@/lib/session-store';

export type LoginState = { error?: string; username?: string };

const SIGN_IN_ERRORS = {
  invalid: 'Username or password is not correct.',
  locked:
    'Too many unsuccessful sign-in attempts for this username. Wait 15 minutes, or ask an administrator to reset the password.',
  throttled: 'Too many sign-in attempts for this username. Wait a minute and try again.',
  unavailable: 'The document system is not responding. Try again soon.',
} as const;

export async function login(
  _previous: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const username = String(formData.get('username') ?? '').trim();
  const password = String(formData.get('password') ?? '');

  if (!username || !password) {
    return { error: 'Enter your username and password.', username };
  }

  // The password is checked by Mayan (Django's authenticate(), Mayan's own
  // user table and lockout). It is never stored or logged here.
  const result = await signIn(username, password);
  // Mayan gives the same answer for a wrong password and a disabled account.
  if (!result.ok) return { error: SIGN_IN_ERRORS[result.reason], username };

  const sessionId = createSession({
    token: result.token,
    username: result.username,
    fullName: result.fullName,
    canUpload: result.canUpload,
    isAdmin: result.isAdmin,
    mustChange: result.mustChange,
  });

  (await cookies()).set(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    path: '/',
    maxAge: Math.floor(config.sessionAbsoluteMs / 1000),
  });
  redirect(result.mustChange ? CHANGE_PASSWORD_PATH : '/');
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
