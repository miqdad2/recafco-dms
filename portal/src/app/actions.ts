'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { CHANGE_PASSWORD_PATH } from '@/lib/auth';
import { config, SESSION_COOKIE, SIGNED_OUT_COOKIE } from '@/lib/config';
import { revokeToken, signIn } from '@/lib/mayan';
import {
  createSession,
  deleteSession,
  deleteSessionsForToken,
} from '@/lib/session-store';

/**
 * Result of a sign-in attempt, rendered back into the form. Never contains
 * the password. `fields` holds inline messages for empty fields; `error`
 * is a sign-in failure (wrong details, lockout, system unavailable).
 */
export type LoginState = {
  error?: string;
  fields?: { username?: string; password?: string };
  username?: string;
  /** Changes on every attempt so the form can move focus to the problem. */
  at?: number;
};

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
    return {
      fields: {
        ...(username ? {} : { username: 'Enter your username.' }),
        ...(password ? {} : { password: 'Enter your password.' }),
      },
      username,
      at: Date.now(),
    };
  }

  // The password is checked by Mayan (Django's authenticate(), Mayan's own
  // user table and lockout). It is never stored or logged here.
  const result = await signIn(username, password);
  // Mayan gives the same answer for a wrong password and a disabled account.
  if (!result.ok) return { error: SIGN_IN_ERRORS[result.reason], username, at: Date.now() };

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
  // One-time note for the sign-in page: shown only after this real sign-out
  // (not when someone opens /login?signedout=1). Cleared on first display.
  store.set(SIGNED_OUT_COOKIE, '1', {
    httpOnly: false,
    sameSite: 'lax',
    secure: config.cookieSecure,
    path: '/login',
    maxAge: 120,
  });
  redirect('/login?signedout=1');
}
