import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { Breadcrumb } from '@/components/ui';
import type { Session } from '@/lib/session-store';

export type AdminSection = 'overview' | 'departments' | 'categories' | 'users' | 'confidential' | 'documents' | 'activity';

const sections: { id: AdminSection; href: string; label: string }[] = [
  { id: 'overview', href: '/admin', label: 'Overview' },
  { id: 'departments', href: '/admin/departments', label: 'Departments' },
  { id: 'categories', href: '/admin/categories', label: 'Categories' },
  { id: 'users', href: '/admin/users', label: 'Users and roles' },
  { id: 'confidential', href: '/admin/confidential-groups', label: 'Confidential groups' },
  { id: 'documents', href: '/admin/documents', label: 'Documents' },
  { id: 'activity', href: '/admin/activity', label: 'Activity log' },
];

export function AdminShell({
  session,
  section,
  title,
  crumbs = [],
  children,
}: {
  session: Session;
  section: AdminSection;
  title: string;
  crumbs?: { href?: string; label: string }[];
  children: React.ReactNode;
}) {
  return (
    <AppShell session={session} section="admin">
      <Breadcrumb items={[{ href: '/admin', label: 'Administration' }, ...crumbs]} />
      <div className="grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)] lg:items-start">
        <nav aria-label="Administration" className="rounded-2xl border border-line bg-white p-2">
          <ul className="flex flex-wrap gap-1 lg:flex-col">
            {sections.map((item) => (
              <li key={item.id}>
                <Link
                  href={item.href}
                  aria-current={item.id === section ? 'page' : undefined}
                  className={`flex min-h-12 items-center rounded-xl px-3 text-base font-semibold ${
                    item.id === section ? 'bg-brand-soft text-brand-strong' : 'hover:bg-canvas'
                  }`}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex min-w-0 flex-col gap-6">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
          {children}
        </div>
      </div>
    </AppShell>
  );
}

/** Shown to signed-in users who are not RECAFCO administrators. */
export function NotAuthorized({ session }: { session: Session }) {
  return (
    <AppShell session={session}>
      <h1 className="text-3xl font-bold">Administration</h1>
      <p className="max-w-2xl text-lg">
        This area is only for RECAFCO administrators. If you need a change to departments, categories or accounts, please
        contact IT.
      </p>
      <Link href="/" className="inline-flex min-h-14 items-center self-start rounded-xl bg-brand px-6 text-lg font-semibold text-white hover:bg-brand-strong">
        Go to Departments
      </Link>
    </AppShell>
  );
}

export const adminTable = 'w-full text-left';
export const adminTh = 'px-4 py-3 text-base font-semibold text-muted';
export const adminTd = 'px-4 py-3 align-top text-base';
