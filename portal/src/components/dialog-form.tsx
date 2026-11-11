'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useRef } from 'react';
import { Icon } from '@/components/icons';
import { buttonPrimary, buttonSecondary } from '@/components/ui';
import type { FormState } from '@/lib/form-state';

/**
 * A destructive or important action behind one confirmation dialog.
 *
 * - The trigger opens a native <dialog> (focus moves into it; Escape and
 *   Cancel close it) that states what will happen and the affected counts.
 * - The form inside posts to a server action; the dialog shows the server's
 *   real answer. On success it closes and the page shows the message.
 * - `irreversible` adds a plain "cannot be undone" warning.
 * The form is part of the page HTML, so it can also be submitted without
 * JavaScript by tools; people use the dialog.
 */
export function DialogForm({
  action,
  trigger,
  triggerClassName = buttonSecondary,
  title,
  summary,
  children,
  confirmLabel,
  danger = false,
  irreversible = false,
  reason = true,
  formId,
}: {
  action: (state: FormState, data: FormData) => Promise<FormState>;
  trigger: React.ReactNode;
  triggerClassName?: string;
  title: string;
  summary: React.ReactNode;
  children?: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  irreversible?: boolean;
  /** Offer an optional "Reason" field (recorded in the activity log). */
  reason?: boolean;
  formId?: string;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  const dialog = useRef<HTMLDialogElement>(null);
  const errors = Object.entries(state.errors ?? {});
  const router = useRouter();

  useEffect(() => {
    if (!state.ok) return;
    dialog.current?.close();
    // When the action removes what this dialog belongs to, the page shows
    // the result instead (see done-notice.tsx).
    if (state.next) router.replace(state.next, { scroll: false });
  }, [state.ok, state.at, state.next, router]);

  return (
    <>
      <button type="button" className={triggerClassName} onClick={() => dialog.current?.showModal()}>
        {trigger}
      </button>
      {state.ok && !state.next && errors.length === 0 && (
        <p role="status" className="flex gap-2 rounded-lg border border-ok/30 bg-ok-soft px-3 py-2 text-base font-semibold text-ok">
          <Icon name="check" className="mt-0.5 size-5 shrink-0" />
          {state.ok}
        </p>
      )}
      <dialog
        ref={dialog}
        aria-labelledby={`${formId ?? title}-title`}
        className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-lg border border-line bg-surface p-0 text-ink shadow-xl backdrop:bg-ink/40"
      >
        <form id={formId} action={formAction} className="flex flex-col gap-4 p-5 sm:p-6">
          <h2 id={`${formId ?? title}-title`} className="text-xl font-bold">
            {title}
          </h2>
          <div className="text-base">{summary}</div>
          {children}
          {reason && (
            <div>
              <label htmlFor={`${formId ?? title}-reason`} className="mb-1.5 block text-base font-semibold">
                Reason <span className="font-normal text-muted">(optional, kept in the activity log)</span>
              </label>
              <input
                id={`${formId ?? title}-reason`}
                name="reason"
                maxLength={500}
                className="block min-h-12 w-full rounded-lg border border-line-strong bg-surface px-3 text-base"
              />
            </div>
          )}
          {irreversible && (
            <p className="flex gap-2 rounded-lg border border-brand/40 bg-brand-soft px-3 py-2 text-base font-semibold text-brand-strong">
              <Icon name="alert" className="mt-0.5 size-5 shrink-0" />
              This cannot be undone.
            </p>
          )}
          {errors.length > 0 && (
            <div role="alert" className="rounded-lg border border-brand/40 bg-brand-soft px-3 py-2 text-base font-semibold text-brand-strong">
              {errors.map(([field, message]) => (
                <p key={field}>{message}</p>
              ))}
            </div>
          )}
          <div className="flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:justify-end">
            <button type="button" className={buttonSecondary} onClick={() => dialog.current?.close()}>
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className={danger ? `${buttonPrimary}` : buttonPrimary}
            >
              {pending ? 'Working…' : confirmLabel}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
