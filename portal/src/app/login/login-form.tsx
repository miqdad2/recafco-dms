'use client';

import { useActionState } from 'react';
import { login, type LoginState } from '@/app/actions';
import { PasswordInput } from '@/components/password-input';
import { buttonPrimary, fieldClass } from '@/components/ui';

export function LoginForm() {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(login, {});

  return (
    <form action={formAction} className="mt-6 flex flex-col gap-5" noValidate>
      {state.error && (
        <p role="alert" className="rounded-lg border border-brand/40 bg-brand-soft px-4 py-3 text-lg font-semibold text-brand-strong">
          {state.error}
        </p>
      )}
      <div>
        <label htmlFor="username" className="mb-1.5 block text-base font-semibold">
          Username
        </label>
        <p id="username-hint" className="mb-2 text-base text-muted">
          Your username or employee number. Capital letters do not matter.
        </p>
        <input
          id="username"
          name="username"
          autoComplete="username"
          aria-describedby="username-hint"
          autoCapitalize="none"
          spellCheck={false}
          required
          defaultValue={state.username}
          className={fieldClass}
        />
      </div>
      <div>
        <label htmlFor="password" className="mb-1.5 block text-base font-semibold">
          Password
        </label>
        <PasswordInput id="password" name="password" autoComplete="current-password" />
      </div>
      <button type="submit" className={buttonPrimary} disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
