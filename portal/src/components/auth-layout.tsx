import Image from 'next/image';

/**
 * Layout for the sign-in and first-login password screens.
 *
 * Desktop (lg+): one card (max 1040px) split 42% branding / 58% form; the
 * form column is centred vertically at about 390px wide. Phones and tablets:
 * only the form, with the logo above it. All text uses the same system
 * sans-serif (--font-sans). Heights follow the content (no fixed heights),
 * so short screens, 200% zoom and an open on-screen keyboard scroll.
 */
export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main id="main" className="flex min-h-dvh items-start justify-center bg-canvas-warm px-4 py-8 sm:items-center sm:py-12">
      <div className="grid w-full max-w-md overflow-hidden rounded-lg border border-line bg-surface shadow-[0_1px_2px_rgb(16_24_40/0.04),0_12px_32px_-8px_rgb(16_24_40/0.10)] lg:max-w-[65rem] lg:grid-cols-[39fr_61fr]">
        <BrandPanel />
        <div className="flex items-center px-5 py-8 sm:px-10 sm:py-10 lg:px-14 lg:py-20">
          <div className="mx-auto flex w-full max-w-[25rem] flex-col">
            <div className="mb-6 lg:hidden">
              <LogoTile size="mobile" />
            </div>
            {children}
          </div>
        </div>
      </div>
    </main>
  );
}

/*
 * The logo artwork, cropped to its own bounding box (public/recafco-logo-mark.png,
 * made from the original recafco-logo.png without changing the artwork). The
 * original file has about 30% empty space around the artwork, which made it
 * look small in any container. Width:height = 640:501, never stretched.
 */
const MARK_RATIO = 501 / 640;

function LogoTile({ size }: { size: 'panel' | 'mobile' }) {
  const panel = size === 'panel';
  const box = panel ? 'size-24' : 'size-[4.5rem]';
  const width = panel ? 80 : 60;
  return (
    <span className={`flex ${box} shrink-0 items-center justify-center rounded-lg border border-line bg-white`}>
      <Image
        src="/recafco-logo-mark.png"
        alt={panel ? '' : 'RECAFCO'}
        width={width}
        height={Math.round(width * MARK_RATIO)}
        priority
        className="h-auto max-w-full"
      />
    </span>
  );
}

function BrandPanel() {
  return (
    <section aria-label="RECAFCO Document Management" className="hidden flex-col bg-charcoal p-10 text-white lg:flex">
      <div className="flex items-center gap-4">
        <LogoTile size="panel" />
        <span className="flex flex-col text-lg leading-snug font-medium">
          <span>Document</span>
          <span>Management</span>
        </span>
      </div>
      {/* Centred a little above the middle, so the headline stays close to
          the logo even when the form column is tall. */}
      <div className="flex flex-1 flex-col justify-center pt-10 pb-12">
        <span aria-hidden="true" className="mb-5 block h-1 w-10 rounded-full bg-brand" />
        <p className="text-[1.875rem] leading-[1.3] font-semibold tracking-tight">
          <span className="block">Documents across</span>
          <span className="block">departments.</span>
          <span className="block">Together in one place.</span>
        </p>
      </div>
    </section>
  );
}
