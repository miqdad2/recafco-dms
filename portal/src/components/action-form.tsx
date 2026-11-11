'use client';

import { useActionState, useEffect, useRef } from 'react';
import type { FormState } from '@/lib/form-state';

/**
 * A form posted to a server action. Shows the server's real answer: a
 * success message only when the action reports success, otherwise the
 * errors it returned. Works without JavaScript too (plain form post).
 */
export function ActionForm({
  action,
  children,
  className = 'flex flex-col gap-4',
  labels = {},
  resetOnSuccess = false,
  submit,
  pendingText = 'Saving…',
  submitClassName,
  confirm,
}: {
  action: (state: FormState, data: FormData) => Promise<FormState>;
  children: React.ReactNode;
  className?: string;
  /** Field name → readable label, used in error messages. */
  labels?: Record<string, string>;
  resetOnSuccess?: boolean;
  submit: string;
  pendingText?: string;
  submitClassName: string;
  /** Ask before submitting (for deactivation and similar). */
  confirm?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok && resetOnSuccess) formRef.current?.reset();
  }, [state, resetOnSuccess]);

  const errors = Object.entries(state.errors ?? {});

  return (
    <form
      ref={formRef}
      action={formAction}
      className={className}
      onSubmit={(event) => {
        if (confirm && !window.confirm(confirm)) event.preventDefault();
      }}
    >
      {errors.length > 0 && (
        <div role="alert" className="rounded-lg border border-brand/40 bg-brand-soft px-4 py-3 text-base font-semibold text-brand-strong">
          {errors.map(([field, message]) => (
            <p key={field}>
              {field !== 'form' && labels[field] ? `${labels[field]}: ` : ''}
              {message}
            </p>
          ))}
        </div>
      )}
      {state.ok && errors.length === 0 && (
        <p role="status" className="rounded-lg border border-ok/40 bg-ok-soft px-4 py-3 text-base font-semibold text-ok">
          {state.ok}
        </p>
      )}
      {children}
      <div>
        <button type="submit" disabled={pending} className={submitClassName}>
          {pending ? pendingText : submit}
        </button>
      </div>
    </form>
  );
}
