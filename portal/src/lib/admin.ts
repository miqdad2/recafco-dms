import 'server-only';
import { refreshRoles, requireSession, withMayan } from './auth';
import { MayanError, mayanJson, type Department, type DocumentDetail, type UserRef } from './mayan';
import type { Session } from './session-store';

/**
 * RECAFCO administration area. The portal reads the person's application
 * permissions to decide what to render, but the real check is in the
 * extension: every /recafco/admin/ endpoint checks its own permission on
 * every request (403 otherwise), whatever the portal does.
 */

export type AdminAccess = {
  session: Session;
  /** May open the administration area at all. */
  allowed: boolean;
  isSystemAdmin: boolean;
  permissions: Set<string>;
  can: (permission: string) => boolean;
};

export class AdminForbiddenError extends Error {}

export async function requireAdmin(): Promise<AdminAccess> {
  const session = await requireSession();
  const me = await refreshRoles(session);
  const permissions = new Set(me.admin_permissions ?? []);
  return {
    session,
    allowed: me.is_admin,
    isSystemAdmin: me.is_system_admin,
    permissions,
    can: (permission: string) => permissions.has(permission),
  };
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
  /** null for very old entries; `deleted` when the account was deleted. */
  actor: (UserRef & { deleted?: boolean }) | null;
  datetime: string;
  details: Record<string, unknown>;
  outcome: 'success' | 'failed' | string;
  reason: string;
  target_id: number;
  target_label: string;
  target_type: string;
};

export type Usage = {
  documents: number;
  documents_in_recycle_bin: number;
  members?: number;
  controllers?: number;
};

export type AdminDepartment = Department & {
  total_documents: number;
  controllers: UserRef[];
  usage: Usage;
};
export type AdminCategory = { id: number; name: string; is_active: boolean; total_documents: number; usage: Usage };

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
  roles: { id: number; name: string }[];
  usage?: { uploaded_documents: number; responsible_for: number; activity_entries: number };
};

export type AdminRole = {
  id: number;
  name: string;
  description: string;
  permissions: string[];
  is_protected: boolean;
  member_count: number;
  members: (UserRef & { is_active: boolean })[];
};

export type AppPermissionInfo = { key: string; label: string; description: string; grantable: boolean };

export type ConfidentialGroup = {
  id: number;
  name: string;
  document_type: string;
  member_count: number;
  members?: (UserRef & { is_active: boolean })[];
  is_active: boolean;
  /** The original group shares the controllers' role and cannot be deleted. */
  is_builtin: boolean;
  usage: Usage;
};

export type DocumentFileInfo = {
  id: number;
  filename: string;
  size: number | null;
  mimetype: string | null;
  timestamp: string;
  is_latest: boolean;
};

export type AdminDocument = DocumentDetail & {
  history: AuditEntry[];
  files: DocumentFileInfo[];
  in_trash: boolean;
  trashed_at: string | null;
};

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
  'document.access_changed': 'changed who can open',
  'document.moved': 'moved',
  'document.trashed': 'moved to the recycle bin',
  'document.restored': 'restored from the recycle bin',
  'document.purged': 'permanently deleted',
  'department.deleted': 'deleted department',
  'department.merged': 'merged and deleted department',
  'category.deleted': 'deleted category',
  'category.merged': 'merged and deleted category',
  'user.deleted': 'deleted the account of',
  'user.roles_changed': 'changed the roles of',
  'role.created': 'created role',
  'role.changed': 'changed role',
  'role.deleted': 'deleted role',
  'confidential_group.activated': 'activated confidential group',
  'confidential_group.deactivated': 'deactivated confidential group',
  'confidential_group.deleted': 'deleted confidential group',
};
