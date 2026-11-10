'use client';

import { useState } from 'react';

/**
 * One preview page. Mayan generates images on demand and may answer "busy"
 * the first time, so a failed image is retried a few times.
 */
export function PageImage({ src, alt, eager }: { src: string; alt: string; eager: boolean }) {
  const [attempt, setAttempt] = useState(0);
  const failed = attempt >= 4;

  if (failed) {
    return (
      <p className="rounded-xl bg-white p-4 text-lg">
        {alt}: preview not available right now. Use Download to open the file.
      </p>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- authenticated stream, not a static asset
    <img
      key={attempt}
      src={`${src}?width=1200${attempt ? `&retry=${attempt}` : ''}`}
      alt={alt}
      loading={eager ? 'eager' : 'lazy'}
      onError={() => setTimeout(() => setAttempt((value) => value + 1), 1500 * (attempt + 1))}
      className="w-full rounded-xl border-2 border-line bg-white"
    />
  );
}
