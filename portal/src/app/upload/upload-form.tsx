'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Icon } from '@/components/icons';
import {
  buttonPrimary,
  buttonSecondary,
  buttonSmall,
  errorTextClass,
  fieldClass,
  formatSize,
  helpClass,
  labelClass,
} from '@/components/ui';
import type { Category, Department, Ref } from '@/lib/mayan';

type Field = 'file' | 'department' | 'category' | 'label' | 'confidential_group' | 'form';
type Errors = Partial<Record<Field, string>>;

type Saved = { id: number | null; accessible: boolean; label?: string; confidential_group?: Ref | null };

/** What the page shows after pressing Upload. */
type Outcome =
  | { kind: 'idle' }
  | { kind: 'uploading'; progress: number }
  | { kind: 'checking'; filename: string; message: string }
  | { kind: 'not-saved'; filename: string; message: string }
  | { kind: 'unreachable'; filename: string }
  | { kind: 'receipt'; saved: Saved };

type Pending = { operationId: string; filename: string; startedAt: number };

const STORAGE_KEY = 'recafco.upload.unconfirmed';
const KNOWN_FIELDS: Field[] = ['file', 'department', 'category', 'label', 'confidential_group'];

/** Random upload ID. crypto.getRandomValues also works on plain-HTTP intranet pages. */
function newOperationId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

const CHANGE_EVENT = 'recafco-upload-unconfirmed';

function rawPending(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}
function parsePending(raw: string | null): Pending | null {
  try {
    const value = JSON.parse(raw ?? 'null') as Pending | null;
    return value && Date.now() - value.startedAt < 7 * 24 * 3600_000 ? value : null;
  } catch {
    return null;
  }
}
function subscribePending(onChange: () => void) {
  window.addEventListener('storage', onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}
/** Remembers an upload whose result is not confirmed (survives a reload). */
function writePending(value: Pending | null) {
  try {
    if (value) localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode: recovery then only works while this page stays open.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function pickErrors(body: unknown): Errors {
  const errors: Errors = {};
  if (body && typeof body === 'object') {
    for (const [key, value] of Object.entries(body)) {
      if (key === 'code' || key === 'operation_id' && typeof value !== 'string') continue;
      const text = Array.isArray(value) ? String(value[0]) : String(value);
      if ((KNOWN_FIELDS as string[]).includes(key)) errors[key as Field] = text;
      else errors.form = text;
    }
  }
  return Object.keys(errors).length ? errors : { form: 'The upload did not work. Try again.' };
}

export function UploadForm({
  departments,
  categories,
  defaultDepartment,
  confidentialGroups,
  maxBytes,
  cancelHref,
}: {
  departments: Department[];
  categories: Category[];
  defaultDepartment: string;
  confidentialGroups: Ref[];
  maxBytes: number;
  /** Where Cancel goes (the department the upload started from, or home). */
  cancelHref: string;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  // The submission being sent: kept so "Try again" resends the same bytes
  // with the SAME upload ID (the server then returns the first result
  // instead of saving a copy).
  const current = useRef<{ operationId: string; data: FormData; filename: string } | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'idle' });
  const fileInput = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<{ name: string; size: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  // The title is suggested from the file name until the person edits it.
  const [title, setTitle] = useState('');
  const [titleEdited, setTitleEdited] = useState(false);
  const [groupId, setGroupId] = useState('');
  const [confidential, setConfidential] = useState(false);
  // True while a submission is kept for "Try again" / "Upload it again".
  const [hasCurrent, setHasCurrent] = useState(false);
  const pendingRaw = useSyncExternalStore(subscribePending, rawPending, () => null);
  const unconfirmed = useMemo(() => parsePending(pendingRaw), [pendingRaw]);

  const finish = useCallback(
    (saved: Saved) => {
      writePending(null);
      current.current = null;
      setHasCurrent(false);
      if (saved.accessible && saved.id) {
        router.push(`/documents/${saved.id}?uploaded=1`);
        return;
      }
      setOutcome({ kind: 'receipt', saved });
    },
    [router],
  );

  /** Ask the server what happened to an upload whose reply was lost. */
  const check = useCallback(
    async (operationId: string, filename: string): Promise<void> => {
      setOutcome({ kind: 'checking', filename, message: 'Checking whether your upload was saved…' });
      for (let attempt = 0; attempt <= 40; attempt += 1) {
        let response: Response;
        try {
          response = await fetch(`/api/upload/operations/${operationId}`, { cache: 'no-store' });
        } catch {
          setOutcome({ kind: 'unreachable', filename });
          return;
        }
        if (response.status === 401) {
          router.push('/login?ended=1');
          return;
        }
        if (!response.ok) {
          setOutcome({ kind: 'unreachable', filename });
          return;
        }
        const operation = (await response.json()) as { state: string; document?: Saved; errors?: Record<string, string> };
        if (operation.state === 'completed' && operation.document) {
          finish(operation.document);
          return;
        }
        if (operation.state !== 'pending') {
          // failed or never received: nothing was saved.
          writePending(null);
          if (operation.errors) setErrors(pickErrors(operation.errors));
          setOutcome({
            kind: 'not-saved',
            filename,
            message:
              operation.state === 'failed' && operation.errors
                ? 'The upload was not saved.'
                : 'The upload did not reach the server, so nothing was saved.',
          });
          return;
        }
        setOutcome({ kind: 'checking', filename, message: 'Your upload is still being saved. Please wait…' });
        await sleep(3000);
      }
      setOutcome({ kind: 'unreachable', filename });
    },
    [finish, router],
  );

  function send(operationId: string, data: FormData, filename: string) {
    current.current = { operationId, data, filename };
    setHasCurrent(true);
    writePending({ operationId, filename, startedAt: Date.now() });

    // XMLHttpRequest, because fetch cannot report upload progress.
    const request = new XMLHttpRequest();
    request.open('POST', '/api/upload');
    request.setRequestHeader('X-Upload-Operation', operationId);
    request.responseType = 'json';
    request.upload.onprogress = (e) => {
      if (e.lengthComputable) setOutcome({ kind: 'uploading', progress: Math.round((e.loaded / e.total) * 100) });
    };
    // The reply was lost. The upload may or may not be saved: find out.
    request.onerror = () => void check(operationId, filename);
    request.ontimeout = () => void check(operationId, filename);
    request.onload = () => {
      const body = request.response;
      if ((request.status === 201 || request.status === 200) && body && 'accessible' in body) {
        finish(body as Saved);
        return;
      }
      if (request.status === 401) {
        router.push('/login?ended=1');
        return;
      }
      if (request.status === 202 || request.status === 504 || request.status === 502 || request.status === 0) {
        void check(operationId, filename);
        return;
      }
      if (request.status === 503 && body?.code === 'not_saved') {
        writePending(null);
        setOutcome({ kind: 'not-saved', filename, message: 'The connection was lost before the upload was saved.' });
        return;
      }
      // A definite refusal (wrong field, no permission, too large): nothing saved.
      writePending(null);
      current.current = null;
      setHasCurrent(false);
      setOutcome({ kind: 'idle' });
      setErrors(pickErrors(body));
    };
    setOutcome({ kind: 'uploading', progress: 0 });
    request.send(data);
  }

  function validate(data: FormData): Errors {
    const found: Errors = {};
    const file = data.get('file');
    if (!(file instanceof File) || file.size === 0) found.file = 'Choose a file to upload.';
    else if (file.size > maxBytes) found.file = `The file is too large. The limit is ${formatSize(maxBytes)}.`;
    if (!data.get('department')) found.department = 'Choose a department.';
    if (!data.get('category')) found.category = 'Choose a category.';
    if (confidential && !data.get('confidential_group')) found.confidential_group = 'Choose the confidential group.';
    return found;
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (!String(data.get('label') ?? '').trim()) data.delete('label');
    data.delete('access');
    if (!confidential) data.delete('confidential_group');
    const found = validate(data);
    setErrors(found);
    if (Object.keys(found).length) {
      const first = Object.keys(found)[0];
      formRef.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
      return;
    }
    // A new submission always gets a new upload ID.
    const operationId = newOperationId();
    data.set('operation_id', operationId);
    send(operationId, data, (data.get('file') as File).name);
  }

  /** Resend the same submission with the same upload ID: never a copy. */
  function retrySame() {
    if (current.current) send(current.current.operationId, current.current.data, current.current.filename);
  }

  /** The earlier attempt was definitely not saved: send it as a new upload. */
  function uploadAgain() {
    if (!current.current) {
      setOutcome({ kind: 'idle' });
      return;
    }
    const operationId = newOperationId();
    const data = current.current.data;
    data.set('operation_id', operationId);
    send(operationId, data, current.current.filename);
  }
  const busy = outcome.kind === 'uploading' || outcome.kind === 'checking';
  const describe = (name: Field) => (errors[name] ? `${name}-error` : undefined);
  const selectedGroup = confidentialGroups.find((group) => String(group.id) === groupId);

  /** Shows the chosen file and suggests its name as the title (unless the person typed one). */
  function choose(file: File | null) {
    setSelected(file ? { name: file.name, size: file.size } : null);
    setErrors((previous) => ({ ...previous, file: undefined }));
    if (file && !titleEdited) setTitle(file.name.replace(/\.[^.]{1,8}$/, ''));
  }

  function removeFile() {
    if (fileInput.current) fileInput.current.value = '';
    choose(null);
    if (!titleEdited) setTitle('');
    fileInput.current?.focus();
  }

  function onDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const files = event.dataTransfer.files;
    if (!files.length || !fileInput.current) return;
    if (files.length > 1) {
      setErrors((previous) => ({ ...previous, file: 'Drop one file at a time. Each file is uploaded as its own document.' }));
      return;
    }
    fileInput.current.files = files;
    choose(files[0]);
  }

  if (outcome.kind === 'receipt') {
    return (
      <section role="status" className="flex flex-col gap-4 rounded-lg border border-ok/40 bg-surface p-5 sm:p-6">
        <h2 className="flex items-center gap-2 text-xl font-bold text-ok">
          <Icon name="check" className="size-6" />
          The document is saved
        </h2>
        <p className="text-base">
          <strong dir="auto" className="wrap-anywhere">{outcome.saved.label}</strong> was saved
          {outcome.saved.confidential_group ? (
            <>
              {' '}
              to the confidential group <strong>{outcome.saved.confidential_group.name}</strong>
            </>
          ) : null}
          . Reference number: <strong>{outcome.saved.id}</strong>.
        </p>
        <p className="text-base text-muted">
          Only members of that group can open it. You are not a member, so you cannot open or download it.
        </p>
        <button type="button" className={`${buttonPrimary} self-start`} onClick={() => setOutcome({ kind: 'idle' })}>
          Upload another document
        </button>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {unconfirmed && outcome.kind === 'idle' && (
        <section role="status" className="flex flex-col gap-3 rounded-lg border border-wait/40 bg-wait-soft p-4 text-wait sm:p-5">
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <Icon name="clock" className="size-5" />
            An earlier upload was not confirmed
          </h2>
          <p className="text-base">
            We never received an answer for <strong dir="auto" className="wrap-anywhere">{unconfirmed.filename}</strong>. Check
            before uploading it again.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={buttonPrimary} onClick={() => void check(unconfirmed.operationId, unconfirmed.filename)}>
              Check whether it was saved
            </button>
            <button type="button" className={buttonSecondary} onClick={() => writePending(null)}>
              Dismiss
            </button>
          </div>
        </section>
      )}

      {(outcome.kind === 'checking' || outcome.kind === 'unreachable' || outcome.kind === 'not-saved') && (
        <section
          role={outcome.kind === 'not-saved' ? 'alert' : 'status'}
          aria-live="polite"
          className={`flex flex-col gap-3 rounded-lg border p-4 sm:p-5 ${
            outcome.kind === 'not-saved' ? 'border-brand/40 bg-brand-soft text-brand-strong' : 'border-wait/40 bg-wait-soft text-wait'
          }`}
        >
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <Icon name={outcome.kind === 'not-saved' ? 'alert' : 'clock'} className="size-5" />
            {outcome.kind === 'checking'
              ? 'We are not sure your upload was saved'
              : outcome.kind === 'unreachable'
                ? 'We could not confirm your upload'
                : 'Your upload was not saved'}
          </h2>
          <p className="text-base">
            {outcome.kind === 'checking' && (
              <>
                <span aria-hidden="true" className="mr-2 inline-block size-4 animate-spin rounded-full border-4 border-wait border-t-transparent align-middle" />
                {outcome.message}
              </>
            )}
            {outcome.kind === 'unreachable' &&
              `The connection was lost while sending ${outcome.filename}. It may have been saved. Please do not upload it again as a new document yet. Come back to this page later: it will offer to check again. My uploads also lists what was saved.`}
            {outcome.kind === 'not-saved' && `${outcome.message} Nothing was saved for ${outcome.filename}.`}
          </p>
          {outcome.kind === 'unreachable' && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={buttonPrimary}
                onClick={() => {
                  const pending = current.current ?? unconfirmed;
                  if (pending) void check(pending.operationId, pending.filename);
                }}
              >
                Check again
              </button>
              {hasCurrent && (
                <button type="button" className={buttonSecondary} onClick={retrySame}>
                  Try sending again (safe – no copy is made)
                </button>
              )}
            </div>
          )}
          {outcome.kind === 'not-saved' && (
            <div className="flex flex-wrap gap-2">
              {hasCurrent ? (
                <button type="button" className={buttonPrimary} onClick={uploadAgain}>
                  Upload it again
                </button>
              ) : (
                <button type="button" className={buttonPrimary} onClick={() => setOutcome({ kind: 'idle' })}>
                  Choose the file again
                </button>
              )}
            </div>
          )}
        </section>
      )}

      <form ref={formRef} onSubmit={submit} noValidate className="flex flex-col gap-5 rounded-lg border border-line bg-surface p-4 sm:p-6">
        {errors.form && (
          <p role="alert" className="flex gap-2 rounded-lg border border-brand/40 bg-brand-soft px-4 py-3 text-base font-semibold text-brand-strong">
            <Icon name="alert" className="mt-0.5 size-5 shrink-0" />
            {errors.form}
          </p>
        )}

        <div>
          <span id="file-label" className={labelClass}>
            File
          </span>
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={`relative flex flex-col items-center gap-3 rounded-lg border border-dashed px-4 py-6 text-center focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-info sm:py-8 ${
              dragging ? 'border-info bg-info-soft' : errors.file ? 'border-brand bg-brand-soft/40' : 'border-line-strong bg-canvas'
            }`}
          >
            {selected ? (
              <div className="flex w-full flex-col items-center gap-3 sm:flex-row sm:text-left">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-surface text-muted ring-1 ring-line">
                  <Icon name="document" className="size-6" />
                </span>
                <span className="min-w-0 flex-1">
                  <span dir="auto" className="block text-base font-semibold wrap-anywhere">{selected.name}</span>
                  <span className="block text-sm text-muted">{formatSize(selected.size)}</span>
                </span>
                <span className="flex shrink-0 gap-2">
                  <label htmlFor="file" className={`${buttonSmall} cursor-pointer`}>
                    Replace
                  </label>
                  <button type="button" onClick={removeFile} className={buttonSmall}>
                    Remove
                  </button>
                </span>
              </div>
            ) : (
              <>
                <Icon name="upload" className="size-8 text-muted" />
                <p className="text-base">
                  <span className="hidden sm:inline">Drag a file here, or </span>
                  <label htmlFor="file" className={`${buttonSecondary} ml-1 cursor-pointer align-middle`}>
                    Browse files
                  </label>
                </p>
              </>
            )}
            <input
              ref={fileInput}
              id="file"
              name="file"
              type="file"
              required
              aria-labelledby="file-label"
              aria-invalid={!!errors.file}
              aria-describedby={['file-help', describe('file')].filter(Boolean).join(' ')}
              onChange={(event) => choose(event.target.files?.[0] ?? null)}
              className="sr-only"
            />
          </div>
          <p id="file-help" className={helpClass}>
            One file per upload, up to {formatSize(maxBytes)}. Any file type is accepted; PDFs and images can be previewed here,
            other files open after downloading.
          </p>
          {errors.file && (
            <p id="file-error" className={errorTextClass}>
              {errors.file}
            </p>
          )}
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <div>
            <label htmlFor="department" className={labelClass}>
              Department
            </label>
            <select
              id="department"
              name="department"
              required
              defaultValue={defaultDepartment}
              aria-invalid={!!errors.department}
              aria-describedby={describe('department')}
              className={fieldClass}
            >
              <option value="" disabled>
                Choose a department
              </option>
              {departments.map((department) => (
                <option key={department.id} value={department.name}>
                  {department.name}
                </option>
              ))}
            </select>
            {errors.department && (
              <p id="department-error" className={errorTextClass}>
                {errors.department}
              </p>
            )}
          </div>
          <div>
            <label htmlFor="category" className={labelClass}>
              Category
            </label>
            <select
              id="category"
              name="category"
              required
              defaultValue=""
              aria-invalid={!!errors.category}
              aria-describedby={describe('category')}
              className={fieldClass}
            >
              <option value="" disabled>
                Choose a category
              </option>
              {categories.map((category) => (
                <option key={category.id} value={category.name}>
                  {category.name}
                </option>
              ))}
            </select>
            {errors.category && (
              <p id="category-error" className={errorTextClass}>
                {errors.category}
              </p>
            )}
          </div>
        </div>

        <div>
          <label htmlFor="label" className={labelClass}>
            Title <span className="font-normal text-muted">(optional)</span>
          </label>
          <input
            id="label"
            name="label"
            maxLength={255}
            dir="auto"
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              setTitleEdited(true);
            }}
            aria-describedby="label-help"
            className={fieldClass}
          />
          <p id="label-help" className={helpClass}>
            Filled in from the file name; change it if you like. For example: PO 4521 – Steel plates.
          </p>
        </div>

        {confidentialGroups.length > 0 && (
          <fieldset className="rounded-lg border border-line p-4">
            <legend className="px-1 text-base font-semibold">Who can open it?</legend>
            <label className="flex min-h-11 items-start gap-3 text-base">
              <input type="radio" name="access" value="general" checked={!confidential} onChange={() => setConfidential(false)} className="mt-1 size-5 shrink-0" />
              <span>
                All employees <span className="block text-sm text-muted">A general document, like purchase orders and invoices.</span>
              </span>
            </label>
            <label className="mt-2 flex min-h-11 items-start gap-3 text-base">
              <input type="radio" name="access" value="confidential" checked={confidential} onChange={() => setConfidential(true)} className="mt-1 size-5 shrink-0" />
              <span>
                Only one confidential group
                <span className="block text-sm text-muted">Administrators only. Confidential from the moment it is saved.</span>
              </span>
            </label>
            {confidential && (
              <div className="mt-3">
                <label htmlFor="confidential_group" className={labelClass}>
                  Confidential group
                </label>
                <select
                  id="confidential_group"
                  name="confidential_group"
                  value={groupId}
                  onChange={(event) => setGroupId(event.target.value)}
                  required
                  aria-invalid={!!errors.confidential_group}
                  aria-describedby={describe('confidential_group')}
                  className={fieldClass}
                >
                  <option value="" disabled>
                    Choose the group
                  </option>
                  {confidentialGroups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </select>
                {errors.confidential_group && (
                  <p id="confidential_group-error" className={errorTextClass}>
                    {errors.confidential_group}
                  </p>
                )}
              </div>
            )}
          </fieldset>
        )}

        <div
          id="audience"
          aria-live="polite"
          className={`flex gap-3 rounded-lg border px-4 py-3 text-base ${
            confidential ? 'border-ink/30 bg-canvas text-ink' : 'border-info/30 bg-info-soft text-info'
          }`}
        >
          <Icon name={confidential ? 'lock' : 'people'} className="mt-0.5 size-5 shrink-0" />
          {confidential ? (
            <p>
              {selectedGroup ? (
                <>
                  <strong>Restricted to {selectedGroup.name}.</strong> Only members of this group will be able to open it. If you
                  are not a member, you will not be able to open or download it after uploading.
                </>
              ) : (
                <strong>Restricted to one confidential group. Choose the group above.</strong>
              )}
            </p>
          ) : (
            <p>
              <strong>Visible to all employees.</strong> Your name and the upload date are shown with it.
            </p>
          )}
        </div>

        {outcome.kind === 'uploading' && (
          <div role="status" aria-live="polite">
            <p className="mb-2 text-base font-semibold">
              {outcome.progress < 100 ? `Uploading… ${outcome.progress}%` : 'Upload sent. Saving the document…'}
            </p>
            <div className="h-2 overflow-hidden rounded-full bg-canvas ring-1 ring-line">
              <div className="h-full bg-brand transition-[width]" style={{ width: `${outcome.progress}%` }} />
            </div>
          </div>
        )}

        <div className="flex flex-col-reverse gap-2 border-t border-line pt-5 sm:flex-row sm:justify-end">
          <Link href={cancelHref} className={buttonSecondary}>
            Cancel
          </Link>
          <button type="submit" className={buttonPrimary} disabled={busy || outcome.kind === 'unreachable'}>
            <Icon name={confidential ? 'lock' : 'upload'} className="size-5" />
            {outcome.kind === 'uploading' ? 'Uploading…' : confidential ? 'Upload as confidential' : 'Upload document'}
          </button>
        </div>
      </form>
    </div>
  );
}
