import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { Breadcrumb, buttonPrimary } from '@/components/ui';
import type { AdminAccess } from '@/lib/admin';
import type { Session } from '@/lib/session-store';

export type AdminSection =
  | 'overview'
  | 'departments'
  | 'categories'
  | 'users'
  | 'roles'
  | 'confidential'
  | 'documents'
  | 'activity';

const DOCUMENT_PERMISSIONS = ['documents.manage', 'documents.recycle', 'documents.purge'];

/**
 * Which application permission opens each section. The extension checks
 * the same permissions on every request; this only decides what to show.
 */
export function sectionAllowed(access: AdminAccess, section: AdminSection): boolean {
  switch (section) {
    case 'overview':
      return access.allowed;
    case 'departments':
      return access.can('departments.manage');
    case 'categories':
      return access.can('categories.manage');
    case 'users':
      return access.can('users.manage');
    case 'roles':
      return access.can('roles.manage');
    case 'confidential':
      return access.can('confidential_groups.manage');
    case 'documents':
      return DOCUMENT_PERMISSIONS.some((permission) => access.can(permission));
    case 'activity':
      return access.can('activity.view');
  }
}

const sections: { id: AdminSection; href: string; label: string }[] = [
  { id: 'overview', href: '/admin', label: 'Overview' },
  { id: 'documents', href: '/admin/documents', label: 'Documents' },
  { id: 'departments', href: '/admin/departments', label: 'Departments' },
  { id: 'categories', href: '/admin/categories', label: 'Categories' },
  { id: 'users', href: '/admin/users', label: 'Users' },
  { id: 'roles', href: '/admin/roles', label: 'Roles' },
  { id: 'confidential', href: '/admin/confidential-groups', label: 'Confidential groups' },
  { id: 'activity', href: '/admin/activity', label: 'Activity log' },
];

export function AdminShell({
  access,
  section,
  title,
  crumbs = [],
  children,
}: {
  access: AdminAccess;
  section: AdminSection;
  title: string;
  crumbs?: { href?: string; label: string }[];
  children: React.ReactNode;
}) {
  const visible = sections.filter((item) => sectionAllowed(access, item.id));
  return (
    <AppShell session={access.session} section="admin">
      <div className="flex flex-col gap-3">
        <nav aria-label="Administration" className="border-b border-line">
          <ul className="-mb-px flex flex-wrap gap-x-1">
            {visible.map((item) => {
              const current = item.id === section;
              return (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    aria-current={current ? 'page' : undefined}
                    className={`flex min-h-11 items-center border-b-2 px-3 text-base font-semibold ${
                      current ? 'border-brand text-ink' : 'border-transparent text-muted hover:border-line-strong hover:text-ink'
                    }`}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        {crumbs.length > 0 && <Breadcrumb items={[{ href: '/admin', label: 'Administration' }, ...crumbs]} />}
      </div>
      <h1 className="text-2xl font-bold tracking-tight wrap-anywhere sm:text-3xl">{title}</h1>
      {children}
    </AppShell>
  );
}

/** Shown to signed-in users without permission for this part of the area. */
export function NotAuthorized({ session }: { session: Session }) {
  return (
    <AppShell session={session}>
      <h1 className="text-2xl font-bold sm:text-3xl">Administration</h1>
      <p className="max-w-2xl text-base">
        This area is only for RECAFCO administrators. If you need a change to departments, categories or accounts, please
        contact IT.
      </p>
      <Link href="/" className={`${buttonPrimary} self-start`}>
        Go to Departments
      </Link>
    </AppShell>
  );
}

export const adminTable = 'w-full text-left';
export const adminTh = 'px-4 py-2.5 text-sm font-semibold text-muted';
export const adminTd = 'px-4 py-3 align-top text-base';
