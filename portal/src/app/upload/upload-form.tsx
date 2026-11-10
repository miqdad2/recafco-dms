'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { buttonPrimary, fieldClass, formatSize } from '@/components/ui';
import type { Category, Department } from '@/lib/mayan';

type Errors = Partial<Record<'file' | 'department' | 'category' | 'label' | 'form', string>>;

function pickErrors(body: unknown): Errors {
  const errors: Errors = {};
  if (body && typeof body === 'object') {
    for (const [key, value] of Object.entries(body)) {
      const text = Array.isArray(value) ? String(value[0]) : String(value);
      if (key === 'file' || key === 'department' || key === 'category' || key === 'label') errors[key] = text;
      else errors.form = text;
    }
  }
  return Object.keys(errors).length ? errors : { form: 'The upload did not work. Try again.' };
}

export function UploadForm({
  departments,
  categories,
  defaultDepartment,
  maxBytes,
}: {
  departments: Department[];
  categories: Category[];
  defaultDepartment: string;
  maxBytes: number;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [progress, setProgress] = useState<number | null>(null);
  const [fileInfo, setFileInfo] = useState<string>('');

  function validate(data: FormData): Errors {
    const found: Errors = {};
    const file = data.get('file');
    if (!(file instanceof File) || file.size === 0) found.file = 'Choose a file to upload.';
    else if (file.size > maxBytes) found.file = `The file is too large. The limit is ${formatSize(maxBytes)}.`;
    if (!data.get('department')) found.department = 'Choose a department.';
    if (!data.get('category')) found.category = 'Choose a category.';
    return found;
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (!String(data.get('label') ?? '').trim()) data.delete('label');
    const found = validate(data);
    setErrors(found);
    if (Object.keys(found).length) {
      const first = Object.keys(found)[0];
      formRef.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
      return;
    }

    // XMLHttpRequest, because fetch cannot report upload progress.
    const request = new XMLHttpRequest();
    request.open('POST', '/api/upload');
    request.responseType = 'json';
    request.upload.onprogress = (e) => {
      if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
    };
    request.onerror = () => {
      setProgress(null);
      setErrors({ form: 'The connection was lost. Check your network and try again.' });
    };
    request.onload = () => {
      if (request.status === 201 && request.response?.id) {
        router.push(`/documents/${request.response.id}?uploaded=1`);
        return;
      }
      setProgress(null);
      if (request.status === 401) {
        router.push('/login?ended=1');
        return;
      }
      setErrors(pickErrors(request.response));
    };
    setProgress(0);
    request.send(data);
  }

  const uploading = progress !== null;
  const describe = (name: keyof Errors) => (errors[name] ? `${name}-error` : undefined);

  return (
    <form ref={formRef} onSubmit={submit} noValidate className="flex max-w-3xl flex-col gap-6 rounded-2xl border border-line bg-white p-5 sm:p-6">
      {errors.form && (
        <p role="alert" className="rounded-xl border-2 border-brand bg-brand-soft px-4 py-3 text-lg font-semibold text-brand-strong">
          {errors.form}
        </p>
      )}

      <div>
        <label htmlFor="file" className="mb-2 block text-lg font-semibold">
          File
        </label>
        <input
          id="file"
          name="file"
          type="file"
          required
          aria-invalid={!!errors.file}
          aria-describedby={['file-help', describe('file')].filter(Boolean).join(' ')}
          onChange={(e) => {
            const file = e.target.files?.[0];
            setFileInfo(file ? `${file.name} · ${formatSize(file.size)}` : '');
          }}
          className="block w-full rounded-xl border-2 border-dashed border-line bg-canvas p-4 text-lg file:mr-4 file:min-h-12 file:rounded-lg file:border-0 file:bg-ink file:px-4 file:font-semibold file:text-white"
        />
        <p id="file-help" className="mt-2 text-base text-muted">
          {fileInfo || `PDF, photo or office file. Up to ${formatSize(maxBytes)}.`}
        </p>
        {errors.file && <p id="file-error" className="mt-2 text-lg font-semibold text-brand-strong">{errors.file}</p>}
      </div>

      <div>
        <label htmlFor="department" className="mb-2 block text-lg font-semibold">
          Department
        </label>
        <select id="department" name="department" required defaultValue={defaultDepartment} aria-invalid={!!errors.department} aria-describedby={describe('department')} className={fieldClass}>
          <option value="" disabled>
            Choose a department
          </option>
          {departments.map((department) => (
            <option key={department.id} value={department.name}>
              {department.name}
            </option>
          ))}
        </select>
        {errors.department && <p id="department-error" className="mt-2 text-lg font-semibold text-brand-strong">{errors.department}</p>}
      </div>

      <div>
        <label htmlFor="category" className="mb-2 block text-lg font-semibold">
          Category
        </label>
        <select id="category" name="category" required defaultValue="" aria-invalid={!!errors.category} aria-describedby={describe('category')} className={fieldClass}>
          <option value="" disabled>
            Choose a category
          </option>
          {categories.map((category) => (
            <option key={category.id} value={category.name}>
              {category.name}
            </option>
          ))}
        </select>
        {errors.category && <p id="category-error" className="mt-2 text-lg font-semibold text-brand-strong">{errors.category}</p>}
      </div>

      <div>
        <label htmlFor="label" className="mb-2 block text-lg font-semibold">
          Title <span className="font-normal text-muted">(optional)</span>
        </label>
        <input id="label" name="label" maxLength={255} aria-describedby="label-help" className={fieldClass} />
        <p id="label-help" className="mt-2 text-base text-muted">
          For example: PO 4521 – Steel plates. If empty, the file name is used.
        </p>
      </div>

      {uploading && (
        <div role="status" aria-live="polite">
          <p className="mb-2 text-lg font-semibold">Uploading… {progress}%</p>
          <div className="h-3 overflow-hidden rounded-full bg-canvas">
            <div className="h-full bg-brand transition-[width]" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      <button type="submit" className={buttonPrimary} disabled={uploading}>
        {uploading ? 'Uploading…' : 'Upload document'}
      </button>
    </form>
  );
}
