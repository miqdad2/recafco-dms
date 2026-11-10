'use client';

import { useActionState } from 'react';
import { login, type LoginState } from '@/app/actions';
import { buttonPrimary, fieldClass } from '@/components/ui';

export function LoginForm() {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(login, {});

  return (
    <form action={formAction} className="mt-6 flex flex-col gap-5" noValidate>
      {state.error && (
        <p role="alert" className="rounded-xl border-2 border-brand bg-brand-soft px-4 py-3 text-lg font-semibold text-brand-strong">
          {state.error}
        </p>
      )}
      <div>
        <label htmlFor="username" className="mb-2 block text-lg font-semibold">
          Username
        </label>
        <input
          id="username"
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          defaultValue={state.username}
          className={fieldClass}
        />
      </div>
      <div>
        <label htmlFor="password" className="mb-2 block text-lg font-semibold">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className={fieldClass}
        />
      </div>
      <button type="submit" className={buttonPrimary} disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
