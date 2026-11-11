'use client';

import { useActionState, useEffect, useRef } from 'react';
import { PasswordInput } from '@/components/password-input';
import { buttonPrimary } from '@/components/ui';
import type { FormState } from '@/lib/form-state';
import { changePassword } from './actions';

const LABELS: Record<string, string> = {
  current_password: 'Current password',
  new_password: 'New password',
  new_password_again: 'Type the new password again',
};

export function ChangePasswordForm({ temporary }: { temporary: boolean }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(changePassword, {});
  const formRef = useRef<HTMLFormElement>(null);
  const errors = state.errors ?? {};

  // Never keep typed passwords in the form after a submit.
  useEffect(() => {
    if (state.at) formRef.current?.reset();
  }, [state.at]);

  const currentLabel = temporary ? 'Temporary password' : 'Current password';
  const fieldError = (name: string) =>
    errors[name] ? (
      <p id={`${name}-error`} className="mt-2 text-base font-semibold text-brand-strong">
        {errors[name]}
      </p>
    ) : null;

  return (
    <form ref={formRef} action={formAction} className="mt-6 flex flex-col gap-5" noValidate>
      {Object.keys(errors).length > 0 && (
        <div role="alert" className="rounded-lg border border-brand/40 bg-brand-soft px-4 py-3 text-base font-semibold text-brand-strong">
          <p>{errors.form ?? 'Your password was not changed.'}</p>
          {Object.entries(errors)
            .filter(([field]) => field !== 'form')
            .map(([field, message]) => (
              <p key={field} className="font-normal">
                {field === 'current_password' ? currentLabel : (LABELS[field] ?? field)}: {message}
              </p>
            ))}
        </div>
      )}
      {state.ok && Object.keys(errors).length === 0 && (
        <p role="status" className="rounded-lg border border-ok/40 bg-ok-soft px-4 py-3 text-base font-semibold text-ok">
          {state.ok}
        </p>
      )}
      <div>
        <label htmlFor="current_password" className="mb-1.5 block text-base font-semibold">
          {currentLabel}
        </label>
        <PasswordInput
          id="current_password"
          name="current_password"
          autoComplete="current-password"
          describedBy={errors.current_password ? 'current_password-error' : undefined}
          invalid={Boolean(errors.current_password)}
        />
        {fieldError('current_password')}
      </div>
      <div>
        <label htmlFor="new_password" className="mb-1.5 block text-base font-semibold">
          New password
        </label>
        <p id="new_password-hint" className="mb-2 text-base text-muted">
          At least 6 characters. Letters, numbers or both — no special characters needed.
        </p>
        <PasswordInput
          id="new_password"
          name="new_password"
          autoComplete="new-password"
          describedBy={errors.new_password ? 'new_password-hint new_password-error' : 'new_password-hint'}
          invalid={Boolean(errors.new_password)}
        />
        {fieldError('new_password')}
      </div>
      <div>
        <label htmlFor="new_password_again" className="mb-1.5 block text-base font-semibold">
          Type the new password again
        </label>
        <PasswordInput
          id="new_password_again"
          name="new_password_again"
          autoComplete="new-password"
          describedBy={errors.new_password_again ? 'new_password_again-error' : undefined}
          invalid={Boolean(errors.new_password_again)}
        />
        {fieldError('new_password_again')}
      </div>
      <button type="submit" className={buttonPrimary} disabled={pending}>
        {pending ? 'Saving…' : temporary ? 'Save my password and continue' : 'Change password'}
      </button>
    </form>
  );
}
