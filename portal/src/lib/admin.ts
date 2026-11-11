import 'server-only';
import { refreshRoles, requireSession, withMayan } from './auth';
import { MayanError, mayanJson, type Department, type DocumentDetail, type UserRef } from './mayan';
import type { Session } from './session-store';

/**
 * RECAFCO administration area. The portal checks the role to decide what to
 * render, but the real check is in the extension: every /recafco/admin/
 * endpoint refuses non-administrators (403), whatever the portal does.
 */

export class AdminForbiddenError extends Error {}

export async function requireAdmin(): Promise<{ session: Session; allowed: boolean }> {
  const session = await requireSession();
  const me = await refreshRoles(session);
  return { session, allowed: me.is_admin };
}

export async function adminGet<T>(session: Session, path: string): Promise<T> {
  try {
    return await withMayan(() => mayanJson<T>(session.token, `/recafco/admin${path}`));
  } catch (error) {
    if (error instanceof MayanError && error.status === 403) throw new AdminForbiddenError();
    throw error;
  }
}

export async function adminGetOrNull<T>(session: Session, path: string): Promise<T | null> {
  try {
    return await adminGet<T>(session, path);
  } catch (error) {
    if (error instanceof MayanError && error.status === 404) return null;
    throw error;
  }
}

export type AuditEntry = {
  id: number;
  action: string;
  actor: UserRef;
  datetime: string;
  details: Record<string, unknown>;
  target_id: number;
  target_label: string;
  target_type: string;
};

export type AdminDepartment = Department & {
  total_documents: number;
  controllers: UserRef[];
};
export type AdminCategory = { id: number; name: string; is_active: boolean; total_documents: number };

export type AdminUser = {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
  full_name: string;
  email: string;
  is_active: boolean;
  is_employee: boolean;
  is_administrator: boolean;
  department_ids: number[];
  controller_department_ids: number[];
  confidential_groups: { id: number; name: string }[];
  last_login: string | null;
  date_joined: string;
  /** Has a temporary password (new account or reset) not yet replaced. */
  must_change_password: boolean;
  /** Sign-in locked after repeated wrong passwords (Mayan lockout). */
  locked_out: boolean;
};

export type ConfidentialGroup = {
  id: number;
  name: string;
  document_type: string;
  member_count: number;
  members?: (UserRef & { is_active: boolean })[];
};

export type AdminDocument = DocumentDetail & { history: AuditEntry[] };

export const ACTION_TEXT: Record<string, string> = {
  'department.created': 'created department',
  'department.changed': 'changed department',
  'department.reordered': 'changed the department order',
  'category.created': 'created category',
  'category.changed': 'changed category',
  'user.created': 'created user',
  'user.changed': 'changed user',
  'user.password_set': 'set a new password for',
  'user.password_reset': 'reset the password of',
  'user.password_changed': 'changed their own password',
  'confidential_group.created': 'created confidential group',
  'confidential_group.renamed': 'renamed confidential group',
  'confidential_group.member_added': 'added a member to',
  'confidential_group.member_removed': 'removed a member from',
  'document.details_changed': 'corrected the details of',
  'document.owner_changed': 'changed the uploader of (before Unit 3; the original uploader was restored and this became a responsibility transfer)',
  'document.responsible_changed': 'transferred responsibility for',
  'document.reclassified': 'made confidential',
};
