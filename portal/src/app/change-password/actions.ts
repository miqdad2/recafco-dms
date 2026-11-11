'use server';

import { redirect } from 'next/navigation';
import { requireSessionAllowingPasswordChange } from '@/lib/auth';
import { errorsFrom, type FormState } from '@/lib/form-state';
import { changeOwnPassword, getMe, SessionEndedError } from '@/lib/mayan';
import { replaceSessionToken } from '@/lib/session-store';

const MIN_LENGTH = 6;

/**
 * Replaces the signed-in person's password. Mayan checks the current
 * password (with its lockout), applies the rules and issues a new token;
 * this session switches to it and the person's other sessions end.
 * Passwords are never returned to the browser or stored by the portal.
 */
export async function changePassword(_state: FormState, data: FormData): Promise<FormState> {
  const session = await requireSessionAllowingPasswordChange();
  const wasTemporary = session.mustChange;
  const current = String(data.get('current_password') ?? '');
  const next = String(data.get('new_password') ?? '');
  const again = String(data.get('new_password_again') ?? '');

  const errors: Record<string, string> = {};
  if (!current) {
    errors.current_password = wasTemporary ? 'Enter the temporary password you signed in with.' : 'Enter your current password.';
  }
  if (next.length < MIN_LENGTH) errors.new_password = `Use at least ${MIN_LENGTH} characters.`;
  else if (next.length > 128) errors.new_password = 'Use at most 128 characters.';
  else if (next !== again) errors.new_password_again = 'The two new passwords are not the same.';
  if (Object.keys(errors).length) return { errors, at: Date.now() };

  let result;
  try {
    result = await changeOwnPassword(session.token, current, next);
  } catch (error) {
    if (error instanceof SessionEndedError) redirect('/login?ended=1');
    throw error;
  }
  if (result.status === 429) {
    return { errors: { form: String(result.body.detail ?? 'Too many attempts. Wait and try again.') }, at: Date.now() };
  }
  if (!result.ok || typeof result.body.token !== 'string') {
    const found = errorsFrom(result.body, 'Your password was not changed. Try again.');
    if (found.current_password && wasTemporary) {
      found.current_password = 'The temporary password is not correct.';
    }
    return { errors: found, at: Date.now() };
  }

  const token = result.body.token;
  const me = await getMe(token);
  replaceSessionToken(session, token, { canUpload: me.can_upload, isAdmin: me.is_admin, fullName: me.full_name });
  if (wasTemporary) redirect('/?welcome=1');
  return { ok: 'Your password has been changed. You were signed out on your other devices.', at: Date.now() };
}
