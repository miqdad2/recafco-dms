import Image from 'next/image';
import Link from 'next/link';
import { logout } from '@/app/actions';
import { Icon } from '@/components/icons';
import type { Session } from '@/lib/session-store';

export type Section = 'departments' | 'uploads' | 'favorites' | 'admin' | null;

const navItems: { section: Exclude<Section, null>; href: string; label: string; icon: string; adminOnly?: boolean }[] = [
  { section: 'departments', href: '/', label: 'Departments', icon: 'folder' },
  { section: 'uploads', href: '/my-uploads', label: 'My uploads', icon: 'upload' },
  { section: 'favorites', href: '/favorites', label: 'Favorites', icon: 'star' },
  { section: 'admin', href: '/admin', label: 'Administration', icon: 'gear', adminOnly: true },
];

export function AppShell({
  session,
  section = null,
  children,
}: {
  session: Session;
  section?: Section;
  children: React.ReactNode;
}) {
  // The Administration link is a convenience only: every admin page and
  // endpoint checks the role again on the server.
  const items = navItems.filter((item) => !item.adminOnly || session.isAdmin);

  return (
    <>
      <header className="border-b-4 border-brand bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link href="/" className="flex min-h-12 shrink-0 items-center gap-3" aria-label="RECAFCO Documents – Departments">
            <Image src="/recafco-logo.png" alt="" width={52} height={52} priority />
            <span className="flex flex-col leading-tight">
              <span className="text-xs font-bold tracking-[0.18em] text-brand">RECAFCO</span>
              <span className="text-xl font-bold">Documents</span>
            </span>
          </Link>

          <nav aria-label="Main" className="hidden lg:block">
            <ul className="flex items-center gap-1">
              {items.map((item) => (
                <li key={item.href}>
                  <NavLink item={item} current={item.section === section} />
                </li>
              ))}
            </ul>
          </nav>

          <details className="group relative">
            <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 rounded-xl border-2 border-line px-3 font-semibold hover:border-ink [&::-webkit-details-marker]:hidden">
              <span aria-hidden="true" className="flex size-8 items-center justify-center rounded-full bg-ink text-sm font-bold text-white">
                {initials(session.fullName)}
              </span>
              <span className="hidden max-w-48 truncate text-base sm:inline">{session.fullName}</span>
              <Icon name="chevronDown" className="size-5 transition-transform group-open:rotate-180" />
              <span className="sr-only">Account menu</span>
            </summary>
            <div className="absolute right-0 z-20 mt-2 w-72 rounded-2xl border-2 border-line bg-white p-4 shadow-lg">
              <p className="text-lg font-semibold break-words">{session.fullName}</p>
              <p className="text-base text-muted break-words">Signed in as {session.username}</p>
              <form id="signout-form" action={logout} className="mt-4">
                <button
                  type="submit"
                  className="min-h-12 w-full rounded-xl border-2 border-ink px-4 text-base font-semibold hover:bg-canvas"
                >
                  Sign out
                </button>
              </form>
            </div>
          </details>
        </div>

        <nav aria-label="Main" className="border-t border-line lg:hidden">
          <ul className="mx-auto flex max-w-7xl flex-wrap gap-1 px-2 py-1 sm:px-4">
            {items.map((item) => (
              <li key={item.href}>
                <NavLink item={item} current={item.section === section} compact />
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main id="main" className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
        {children}
      </main>
    </>
  );
}

function NavLink({
  item,
  current,
  compact = false,
}: {
  item: (typeof navItems)[number];
  current: boolean;
  compact?: boolean;
}) {
  return (
    <Link
      href={item.href}
      aria-current={current ? 'page' : undefined}
      className={`flex min-h-12 items-center gap-2 rounded-xl px-3 font-semibold ${compact ? 'text-base' : 'text-lg'} ${
        current ? 'bg-brand-soft text-brand-strong' : 'text-ink hover:bg-canvas'
      }`}
    >
      <Icon name={item.icon} className="size-5" />
      {item.label}
    </Link>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?';
}
