'use server';

import { refresh } from 'next/cache';
import { requireSession, withMayan } from '@/lib/auth';
import { errorsFrom, type FormState } from '@/lib/form-state';
import { mayanSend, setFavorite } from '@/lib/mayan';

export async function toggleFavorite(documentId: number, value: boolean): Promise<void> {
  const session = await requireSession();
  // Not-permitted documents answer 404 and the page shows "not found".
  await withMayan(() => setFavorite(session.token, documentId, value));
  refresh();
}

function optionalId(value: FormDataEntryValue | null): number | undefined {
  const text = String(value ?? '');
  return /^[0-9]{1,12}$/.test(text) ? Number(text) : undefined;
}

/** Controllers and administrators: correct title, department, category. */
export async function updateDetails(documentId: number, _state: FormState, data: FormData): Promise<FormState> {
  const session = await requireSession();
  const result = await withMayan(() =>
    mayanSend<{ changes?: Record<string, unknown> }>(session.token, `/recafco/documents/${documentId}/details/`, 'PATCH', {
      label: String(data.get('label') ?? ''),
      department_id: optionalId(data.get('department_id')),
      category_id: optionalId(data.get('category_id')),
    }),
  );
  if (result.status === 403 || result.status === 404) {
    return { errors: { form: 'You cannot change this document.' }, at: Date.now() };
  }
  if (!result.ok) return { errors: errorsFrom(result.body), at: Date.now() };
  refresh();
  const changed = Object.keys(result.body.changes ?? {}).length;
  return { ok: changed ? 'The document details are saved.' : 'Nothing was changed.', at: Date.now() };
}
