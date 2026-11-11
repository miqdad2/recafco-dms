'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Keeps a page toolbar (search, filters, Upload) visible while the page
 * scrolls, directly below the app header (64px + 1px border).
 *
 * - position: sticky against the window (the page's only scroller); the
 *   toolbar keeps its normal place in the document flow.
 * - Opaque background; a bottom border appears only while it is stuck.
 * - Publishes its height as --sticky-toolbar-height, which globals.css adds
 *   to scroll-padding-top, so focused fields and anchored content scroll
 *   into view below it instead of behind it.
 * - Turns sticky off when it would cover too much of the visible screen
 *   (short screens, 200% zoom, phone keyboard open): more than 30% of the
 *   visual viewport height.
 * Without JavaScript it renders as a normal, non-sticky toolbar.
 */
// App header: 64px (h-16) plus its 1px bottom border.
const HEADER_PX = 65;
const MAX_SHARE = 0.3;

export function StickyToolbar({ label, children }: { label: string; children: React.ReactNode }) {
  const bar = useRef<HTMLDivElement>(null);
  const [enabled, setEnabled] = useState(false);
  const [stuck, setStuck] = useState(false);

  // Decide whether sticking is sensible for the current screen and toolbar size.
  useEffect(() => {
    const element = bar.current;
    if (!element) return;
    const viewport = window.visualViewport;
    const update = () => {
      const visible = viewport?.height ?? window.innerHeight;
      const height = element.offsetHeight;
      const ok = HEADER_PX + height <= visible * (1 - MAX_SHARE) && height <= visible * MAX_SHARE;
      setEnabled(ok);
      document.documentElement.style.setProperty('--sticky-toolbar-height', ok ? `${height}px` : '0px');
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    viewport?.addEventListener('resize', update);
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      viewport?.removeEventListener('resize', update);
      window.removeEventListener('resize', update);
      document.documentElement.style.removeProperty('--sticky-toolbar-height');
    };
  }, []);

  // Show the bottom border only while the toolbar is actually stuck: its
  // top sits at the header's bottom edge and the page has scrolled.
  useEffect(() => {
    const element = bar.current;
    if (!element || !enabled) return;
    let frame = 0;
    const check = () => {
      frame = 0;
      setStuck(window.scrollY > 0 && Math.round(element.getBoundingClientRect().top) <= HEADER_PX);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [enabled]);

  const showStuck = enabled && stuck;

  return (
    <div
        ref={bar}
        role="region"
        aria-label={label}
        data-stuck={showStuck ? 'true' : undefined}
        className={`z-20 -mx-4 bg-canvas px-4 py-2 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 ${
          enabled ? 'sticky top-[65px]' : ''
        } ${showStuck ? 'border-b border-line shadow-[0_1px_2px_rgb(16_24_40/0.06)]' : 'border-b border-transparent'}`}
      >
        {children}
    </div>
  );
}
