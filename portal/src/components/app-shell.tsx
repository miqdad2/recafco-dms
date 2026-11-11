import Image from 'next/image';
import Link from 'next/link';
import { logout } from '@/app/actions';
import { Icon } from '@/components/icons';
import { MenuDetails } from '@/components/menu-details';
import type { Session } from '@/lib/session-store';

export type Section = 'departments' | 'search' | 'uploads' | 'favorites' | 'admin' | null;

type NavItem = { section: Exclude<Section, null>; href: string; label: string; icon: string };

const mainItems: NavItem[] = [
  { section: 'departments', href: '/', label: 'Departments', icon: 'folder' },
  { section: 'search', href: '/search', label: 'Search documents', icon: 'search' },
  { section: 'uploads', href: '/my-uploads', label: 'My uploads', icon: 'upload' },
  { section: 'favorites', href: '/favorites', label: 'Favorites', icon: 'star' },
];
const adminItem: NavItem = { section: 'admin', href: '/admin', label: 'Administration', icon: 'gear' };

const SECTION_LABELS: Record<Exclude<Section, null>, string> = {
  departments: 'Departments',
  search: 'Search documents',
  uploads: 'My uploads',
  favorites: 'Favorites',
  admin: 'Administration',
};

/**
 * Application layout: a persistent sidebar on desktop, a compact header with
 * the current section and the account menu, and a "Menu" button on phones
 * and tablets. The Administration link is a convenience only; every admin
 * page and endpoint checks the role again on the server.
 */
export function AppShell({
  session,
  section = null,
  children,
}: {
  session: Session;
  section?: Section;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]">
      <aside className="hidden border-r border-line bg-surface lg:block">
        <div className="sticky top-0 flex h-dvh flex-col">
          <Brand />
          <MainNav session={session} section={section} label="Main" />
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 border-b border-line bg-surface">
          <div className="flex h-16 items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
            <div className="flex min-w-0 items-center gap-2">
              <MenuDetails className="group lg:hidden">
                <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg border border-line-strong px-3 font-semibold hover:bg-hover [&::-webkit-details-marker]:hidden">
                  <Icon name="menu" className="size-5 group-open:hidden" />
                  <Icon name="close" className="hidden size-5 group-open:block" />
                  Menu
                </summary>
                <div className="fixed inset-x-0 top-16 bottom-0 z-40 overflow-y-auto border-t border-line bg-surface">
                  <MainNav session={session} section={section} label="Main menu" />
                </div>
              </MenuDetails>
              <Link href="/" className="flex min-h-11 items-center gap-3 lg:hidden" aria-label="RECAFCO Documents – Departments">
                <LogoBadge className="size-13" />
                <BrandText className="hidden min-[380px]:flex" />
              </Link>
              {section && (
                <p className="hidden truncate text-base font-semibold text-muted lg:block">{SECTION_LABELS[section]}</p>
              )}
            </div>
            <AccountMenu session={session} />
          </div>
        </header>

        <main id="main" className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-3 border-b border-line px-5 py-4" aria-label="RECAFCO Documents – Departments">
      <LogoBadge className="size-16" />
      <BrandText className="flex" />
    </Link>
  );
}

/*
 * The complete logo (Arabic name, wordmark, "Since 1976") in a white circular
 * badge. Uses the cropped mark (640:501, see auth-layout.tsx) so the artwork
 * fills the badge; object-contain inside the padded box keeps it whole and
 * unstretched, and its corners stay inside the circle at 64px and 52px.
 */
function LogoBadge({ className }: { className: string }) {
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-full border border-line bg-white p-[9px] shadow-[0_1px_3px_rgb(0_0_0/0.06)] ${className}`}
    >
      <Image src="/recafco-logo-mark.png" alt="" width={46} height={36} priority className="size-full object-contain" />
    </span>
  );
}

function BrandText({ className }: { className: string }) {
  return (
    <span className={`flex-col leading-tight ${className}`}>
      <span className="text-xs font-bold tracking-[0.16em] text-brand">RECAFCO</span>
      <span className="text-lg font-bold">Documents</span>
    </span>
  );
}

function MainNav({ session, section, label }: { session: Session; section: Section; label: string }) {
  return (
    <nav aria-label={label} className="flex flex-1 flex-col gap-1 p-3">
      <ul className="flex flex-col gap-1">
        {mainItems.map((item) => (
          <li key={item.href}>
            <NavLink item={item} current={item.section === section} />
          </li>
        ))}
      </ul>
      {session.isAdmin && (
        <ul className="mt-3 border-t border-line pt-3">
          <li>
            <NavLink item={adminItem} current={section === 'admin'} />
          </li>
        </ul>
      )}
    </nav>
  );
}

function NavLink({ item, current }: { item: NavItem; current: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={current ? 'page' : undefined}
      className={`relative flex min-h-12 items-center gap-3 rounded-lg px-3 text-base font-semibold ${
        current ? 'bg-brand-soft text-brand-strong' : 'text-ink hover:bg-hover'
      }`}
    >
      {current && <span aria-hidden="true" className="absolute inset-y-2 left-0 w-1 rounded-r bg-brand" />}
      <Icon name={item.icon} className="size-5 shrink-0" />
      {item.label}
    </Link>
  );
}

function AccountMenu({ session }: { session: Session }) {
  return (
    <MenuDetails className="relative">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg border border-line-strong px-2 font-semibold hover:bg-hover sm:px-3 [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="flex size-7 items-center justify-center rounded-full bg-ink text-xs font-bold text-white">
          {initials(session.fullName)}
        </span>
        <span className="hidden max-w-48 truncate text-base sm:inline">{session.fullName}</span>
        <Icon name="chevronDown" className="size-4" />
        <span className="sr-only">Account menu</span>
      </summary>
      <div className="absolute right-0 z-40 mt-2 w-72 rounded-lg border border-line bg-surface p-3 shadow-lg">
        <p className="px-1 text-base font-semibold wrap-anywhere">{session.fullName}</p>
        <p className="px-1 text-sm text-muted wrap-anywhere">Signed in as {session.username}</p>
        <Link
          href="/change-password"
          className="mt-3 flex min-h-11 items-center gap-2 rounded-lg px-2 text-base font-semibold hover:bg-hover"
        >
          <Icon name="key" className="size-5" />
          Change password
        </Link>
        <form id="signout-form" action={logout}>
          <button type="submit" className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-base font-semibold hover:bg-hover">
            <Icon name="logout" className="size-5" />
            Sign out
          </button>
        </form>
      </div>
    </MenuDetails>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?';
}
