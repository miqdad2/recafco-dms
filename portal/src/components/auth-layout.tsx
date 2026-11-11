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
    <main id="main" className="flex min-h-dvh items-start justify-center bg-canvas px-4 py-8 sm:items-center sm:py-12">
      <div className="grid w-full max-w-md overflow-hidden rounded-lg border border-line bg-surface shadow-[0_1px_2px_rgb(16_24_40/0.04),0_12px_32px_-8px_rgb(16_24_40/0.10)] lg:max-w-[65rem] lg:grid-cols-[42fr_58fr]">
        <BrandPanel />
        <div className="flex items-center px-5 py-8 sm:px-10 sm:py-12 lg:px-14 lg:py-16">
          <div className="mx-auto flex w-full max-w-[24.5rem] flex-col">
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

/** The original logo, never stretched: square image in a white square. */
function LogoTile({ size }: { size: 'panel' | 'mobile' }) {
  const box = size === 'panel' ? 'size-14' : 'size-16';
  const pixels = size === 'panel' ? 44 : 52;
  return (
    <span className={`flex ${box} shrink-0 items-center justify-center rounded-lg border border-line bg-white`}>
      <Image src="/recafco-logo.png" alt={size === 'panel' ? '' : 'RECAFCO'} width={pixels} height={pixels} priority className="object-contain" />
    </span>
  );
}

function BrandPanel() {
  return (
    <section aria-label="RECAFCO Documents" className="hidden flex-col bg-charcoal p-10 text-white lg:flex">
      <div className="flex items-center gap-3">
        <LogoTile size="panel" />
        <span className="text-lg font-semibold">RECAFCO Documents</span>
      </div>
      {/* Centred a little above the middle, so the headline stays close to
          the logo even when the form column is tall. */}
      <div className="flex flex-1 flex-col justify-center pt-10 pb-16">
        <span aria-hidden="true" className="mb-5 block h-1 w-10 rounded-full bg-brand" />
        <p className="text-[1.75rem] leading-[1.25] font-semibold tracking-tight">
          <span className="block">Your company documents,</span>
          <span className="block">in one place.</span>
        </p>
        <p className="mt-3 max-w-sm text-lg leading-relaxed text-white/80">Find and share documents across departments.</p>
      </div>
    </section>
  );
}
