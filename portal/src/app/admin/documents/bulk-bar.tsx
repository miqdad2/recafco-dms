'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/icons';
import { buttonPrimary, buttonSecondary, fieldClass } from '@/components/ui';
import type { FormState } from '@/lib/form-state';
import { bulkDocuments } from '../actions';

type Option = { id: number; name: string };

const LABELS: Record<string, string> = {
  move: 'Move to a department or category',
  responsible: 'Transfer responsibility',
  access: 'Change who can open them',
  trash: 'Move to the recycle bin',
  restore: 'Restore',
  purge: 'Delete permanently',
};

/**
 * Bulk actions on the selected documents. Row checkboxes belong to this
 * form through form="bulk-documents". One confirmation states what will
 * happen to how many documents; the result lists any document not done.
 */
export function BulkBar({
  mode,
  returnQuery,
  actions,
  departments,
  categories,
  groups,
  people,
}: {
  mode: 'active' | 'trash';
  /** Current list filters; a successful action returns to this list. */
  returnQuery: string;
  actions: string[];
  departments: Option[];
  categories: Option[];
  groups: Option[];
  people: Option[];
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(bulkDocuments, {});
  const [selected, setSelected] = useState(0);
  const [action, setAction] = useState(actions[0] ?? '');
  const dialog = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const router = useRouter();

  // Count the checked rows (they live in the table, outside this form).
  useEffect(() => {
    // Starts at 0: the page is rendered with nothing selected.
    const count = () =>
      setSelected(document.querySelectorAll('input[form="bulk-documents"][name="ids"]:checked').length);
    document.addEventListener('change', count);
    return () => document.removeEventListener('change', count);
  }, []);

  // After a result, clear the selection (rows may have left this list).
  useEffect(() => {
    if (!state.at) return;
    dialog.current?.close();
    document.querySelectorAll<HTMLInputElement>('input[form="bulk-documents"]:checked').forEach((box) => {
      box.checked = false;
    });
    document.dispatchEvent(new Event('change'));
    // The list page shows the result (see done-notice.tsx) with fresh rows.
    if (state.next) router.replace(state.next, { scroll: false });
  }, [state.at, state.next, router]);

  if (!actions.length) return null;
  const errors = Object.values(state.errors ?? {});
  const irreversible = action === 'purge';

  return (
    <div className="flex flex-col gap-2">
      <form
        id="bulk-documents"
        ref={form}
        action={formAction}
        className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-3 lg:flex-row lg:items-end"
      >
        <input type="hidden" name="action" value={action} />
        <input type="hidden" name="return_query" value={returnQuery} />
        <p className="text-base font-semibold lg:self-center" aria-live="polite">
          {selected} selected
        </p>
        <div className="lg:w-64">
          <label htmlFor="bulk-action" className="mb-1.5 block text-sm font-semibold">
            Action
          </label>
          <select id="bulk-action" value={action} onChange={(event) => setAction(event.target.value)} className={fieldClass}>
            {actions.map((value) => (
              <option key={value} value={value}>
                {LABELS[value]}
              </option>
            ))}
          </select>
        </div>
        {action === 'move' && (
          <>
            <Picker id="bulk-department" name="department_id" label="Department" empty="Keep department" options={departments} />
            <Picker id="bulk-category" name="category_id" label="Category" empty="Keep category" options={categories} />
          </>
        )}
        {action === 'responsible' && (
          <Picker id="bulk-person" name="user_id" label="Responsible person" empty="Choose a person" options={people} />
        )}
        {action === 'access' && (
          <div className="lg:w-64">
            <label htmlFor="bulk-access" className="mb-1.5 block text-sm font-semibold">
              Who can open them
            </label>
            <select id="bulk-access" name="confidential_group" defaultValue="" className={fieldClass}>
              <option value="" disabled>
                Choose
              </option>
              <option value="general">All employees (general)</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  Confidential: {group.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="lg:flex-1">
          <label htmlFor="bulk-reason" className="mb-1.5 block text-sm font-semibold">
            Reason <span className="font-normal text-muted">(optional)</span>
          </label>
          <input id="bulk-reason" name="reason" maxLength={500} className={fieldClass} />
        </div>
        <button
          type="button"
          className={action === 'purge' || action === 'trash' ? buttonPrimary : buttonSecondary}
          disabled={selected === 0 || pending}
          onClick={() => dialog.current?.showModal()}
        >
          {pending ? 'Working…' : 'Apply…'}
        </button>
      </form>

      {errors.length > 0 && (
        <div role="alert" className="flex gap-2 rounded-lg border border-brand/40 bg-brand-soft px-3 py-2 text-base font-semibold text-brand-strong">
          <Icon name="alert" className="mt-0.5 size-5 shrink-0" />
          <div>{errors.map((message) => <p key={message}>{message}</p>)}</div>
        </div>
      )}

      <dialog
        ref={dialog}
        aria-labelledby="bulk-confirm-title"
        className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-lg border border-line bg-surface p-0 text-ink shadow-xl backdrop:bg-ink/40"
      >
        <div className="flex flex-col gap-4 p-5 sm:p-6">
          <h2 id="bulk-confirm-title" className="text-xl font-bold">
            {LABELS[action]}?
          </h2>
          <p className="text-base">
            This applies to <strong>{selected}</strong> selected document{selected === 1 ? '' : 's'}
            {mode === 'trash' ? ' in the recycle bin' : ''}.
            {action === 'trash' && ' Employees will no longer see them. They can be restored.'}
            {action === 'access' && ' People outside the chosen audience lose access at once.'}
            {action === 'purge' && ' Their files, versions and previews are deleted from storage.'}
          </p>
          {irreversible && (
            <p className="flex gap-2 rounded-lg border border-brand/40 bg-brand-soft px-3 py-2 text-base font-semibold text-brand-strong">
              <Icon name="alert" className="mt-0.5 size-5 shrink-0" />
              This cannot be undone.
            </p>
          )}
          <div className="flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:justify-end">
            <button type="button" className={buttonSecondary} onClick={() => dialog.current?.close()}>
              Cancel
            </button>
            <button
              type="button"
              className={buttonPrimary}
              disabled={pending}
              onClick={() => form.current?.requestSubmit()}
            >
              {pending ? 'Working…' : action === 'purge' ? 'Delete permanently' : 'Confirm'}
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}

function Picker({ id, name, label, empty, options }: { id: string; name: string; label: string; empty: string; options: Option[] }) {
  return (
    <div className="lg:w-56">
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold">
        {label}
      </label>
      <select id={id} name={name} defaultValue="" className={fieldClass}>
        <option value="">{empty}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    </div>
  );
}

/** "Select all on this page" checkbox for the table header. */
export function SelectAll() {
  return (
    <input
      type="checkbox"
      aria-label="Select all documents on this page"
      className="size-5"
      onChange={(event) => {
        document.querySelectorAll<HTMLInputElement>('input[form="bulk-documents"][name="ids"]').forEach((box) => {
          box.checked = event.target.checked;
        });
        document.dispatchEvent(new Event('change'));
      }}
    />
  );
}
