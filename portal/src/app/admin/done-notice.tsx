import { Notice } from '@/components/ui';

/*
 * Result of an action whose own form disappears afterwards (a deleted
 * department, documents that left the list, a document that moved to the
 * recycle bin). The server action redirects with a fixed result code and
 * this notice renders it on the server, so the confirmation survives the
 * page refresh. Only known codes are shown: no text is taken from the URL.
 */
const MESSAGES: Record<string, string> = {
  'department-deleted': 'Department deleted.',
  'department-merged': 'Documents moved and department deleted.',
  'department-trashed': 'Department deleted; its documents are in the recycle bin.',
  'category-deleted': 'Documents moved and category deleted.',
  'document-trashed': 'Moved to the recycle bin. Employees no longer see it.',
  'document-restored': 'Restored. Employees can see it again.',
};

const BULK_DONE: Record<string, string> = {
  move: 'moved',
  responsible: 'given a new responsible person',
  access: 'given new access',
  trash: 'moved to the recycle bin',
  restore: 'restored',
  purge: 'permanently deleted, including their stored files',
};

type Params = Record<string, string | string[] | undefined>;
const one = (params: Params, name: string) => {
  const value = params[name];
  return String(Array.isArray(value) ? value[0] : (value ?? '')).slice(0, 2000);
};
const count = (text: string) => (/^[0-9]{1,4}$/.test(text) ? Number(text) : null);

export function DoneNotice({ params }: { params: Params }) {
  const done = one(params, 'done');
  if (MESSAGES[done]) {
    return (
      <Notice tone="ok" role="status">
        {MESSAGES[done]}
      </Notice>
    );
  }
  const bulk = done.startsWith('bulk-') ? done.slice(5) : '';
  const succeeded = count(one(params, 'n'));
  const total = count(one(params, 'of'));
  if (!BULK_DONE[bulk] || succeeded === null || total === null) return null;
  const failed = one(params, 'failed')
    .split(',')
    .filter((id) => /^[0-9]{1,12}$/.test(id))
    .slice(0, 200);
  const summary = `${succeeded} of ${total} document${total === 1 ? '' : 's'} ${BULK_DONE[bulk]}.`;
  if (!failed.length) {
    return (
      <Notice tone="ok" role="status">
        {summary}
      </Notice>
    );
  }
  return (
    <Notice tone="error" role="alert">
      {summary} Not done: {failed.map((id) => `No. ${id}`).join(', ')}. They were left unchanged. Open each one to see
      its current state; for example, someone else may have changed it first.
    </Notice>
  );
}
