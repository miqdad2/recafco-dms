'use client';

import { useActionState, useEffect, useRef } from 'react';
import { login, type LoginState } from '@/app/actions';
import { Icon } from '@/components/icons';
import { PasswordInput } from '@/components/password-input';
import { buttonPrimary, errorTextClass, fieldClass, labelClass } from '@/components/ui';

/**
 * Sign-in form. Works as a plain form post without JavaScript. The server
 * returns the username (never the password) so it stays filled in after an
 * error. While signing in the button is disabled, so it cannot be sent twice.
 */
export function LoginForm() {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(login, {});
  const formRef = useRef<HTMLFormElement>(null);
  const usernameError = state.fields?.username;
  const passwordError = state.fields?.password;

  // After a failed attempt, move focus to where the person needs to act.
  useEffect(() => {
    if (!state.at) return;
    const target = usernameError ? '#username' : '#password';
    formRef.current?.querySelector<HTMLInputElement>(target)?.focus();
  }, [state.at, usernameError]);

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-5" noValidate>
      {state.error && (
        <p role="alert" className="flex gap-2 rounded-lg border border-brand/40 bg-brand-soft px-3 py-2.5 text-base font-semibold text-brand-strong">
          <Icon name="alert" className="mt-0.5 size-5 shrink-0" />
          {state.error}
        </p>
      )}
      <div>
        <label htmlFor="username" className={labelClass}>
          Username
        </label>
        <input
          id="username"
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          maxLength={150}
          placeholder="Username or employee number"
          defaultValue={state.username}
          aria-invalid={usernameError ? true : undefined}
          aria-describedby={usernameError ? 'username-error' : undefined}
          className={`${fieldClass} min-h-[3.25rem]`}
        />
        {usernameError && (
          <p id="username-error" className={errorTextClass}>
            {usernameError}
          </p>
        )}
      </div>
      <div>
        <label htmlFor="password" className={labelClass}>
          Password
        </label>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="current-password"
          tall
          invalid={Boolean(passwordError)}
          describedBy={passwordError ? 'password-error' : undefined}
        />
        {passwordError && (
          <p id="password-error" className={errorTextClass}>
            {passwordError}
          </p>
        )}
      </div>
      <button type="submit" className={`${buttonPrimary} min-h-[3.25rem] w-full`} disabled={pending} aria-disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
      {(usernameError || passwordError) && (
        <p role="alert" className="sr-only">
          {[usernameError, passwordError].filter(Boolean).join(' ')}
        </p>
      )}
    </form>
  );
}
