import Image from 'next/image';

/**
 * Layout for the sign-in and first-login password screens.
 *
 * Desktop (lg+): a charcoal branding panel beside a white form panel
 * (about 430px wide), centred. Phones and tablets: only the form, with a
 * modest logo. Heights follow the content (no fixed heights), so short
 * screens, 200% zoom and an open on-screen keyboard simply scroll.
 */
export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main id="main" className="flex min-h-dvh items-start justify-center bg-canvas px-4 py-8 sm:items-center sm:py-12">
      <div className="grid w-full max-w-md overflow-hidden rounded-lg border border-line bg-surface shadow-sm lg:max-w-[60rem] lg:grid-cols-[minmax(0,1fr)_27rem]">
        <BrandPanel />
        <div className="flex flex-col px-5 py-7 sm:px-10 sm:py-10">
          <Image
            src="/recafco-logo.png"
            alt="RECAFCO"
            width={72}
            height={72}
            priority
            className="mb-5 self-start lg:hidden"
          />
          {children}
        </div>
      </div>
    </main>
  );
}

function BrandPanel() {
  return (
    <section aria-label="RECAFCO Documents" className="relative hidden overflow-hidden bg-ink p-10 text-white lg:flex lg:flex-col">
      <PrecastLines />
      <div className="relative flex items-center gap-3">
        <span className="flex size-14 items-center justify-center rounded-lg bg-white p-1.5">
          <Image src="/recafco-logo.png" alt="" width={48} height={48} priority />
        </span>
        <span className="text-xl font-bold">RECAFCO Documents</span>
      </div>
      <div className="relative mt-auto pt-16">
        <span aria-hidden="true" className="mb-5 block h-1 w-12 bg-brand" />
        <p className="text-3xl leading-tight font-bold text-balance">Company documents. Easy to find.</p>
        <p className="mt-3 max-w-sm text-lg text-white/80">Find and share documents across departments.</p>
      </div>
    </section>
  );
}

/**
 * Decorative linework after precast concrete facade panels: panel joints,
 * a stepped edge and lifting-anchor marks. Hidden from assistive technology.
 */
function PrecastLines() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 480 560"
      preserveAspectRatio="xMaxYMin slice"
      className="pointer-events-none absolute top-0 right-0 h-[58%] w-[72%] text-white/[0.09]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      {/* Panel grid (vertical and horizontal joints) */}
      <path d="M200 0v380M320 0v560M440 0v560M200 120h280M200 250h280M320 380h160M200 380h120" />
      {/* Stepped edge of the panel stack */}
      <path d="M200 380v60h120" />
      {/* Joint reveals: short double lines */}
      <path d="M206 0v380M326 0v560M446 0v560" strokeWidth="0.75" />
      {/* Lifting anchors */}
      <path d="M248 52h16M392 52h16M248 182h16M392 182h16M392 312h16M392 452h16" strokeWidth="2" />
      {/* Window opening in one panel */}
      <rect x="344" y="150" width="72" height="72" />
      {/* Red accent joint (the brand's restrained accent) */}
      <path d="M320 250h120" stroke="var(--color-brand)" strokeOpacity="0.6" strokeWidth="2" />
    </svg>
  );
}
