'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

/** Polls the document status and reloads the page when the preview is ready. */
export function StatusWatcher({ documentId }: { documentId: number }) {
  const router = useRouter();
  const [message, setMessage] = useState('Preparing the preview. This usually takes under a minute.');

  useEffect(() => {
    let stopped = false;
    let attempts = 0;
    async function check() {
      if (stopped) return;
      attempts += 1;
      try {
        const response = await fetch(`/api/documents/${documentId}/status`, { cache: 'no-store' });
        if (response.status === 401) {
          router.push('/login?ended=1');
          return;
        }
        if (response.ok) {
          const { state } = (await response.json()) as { state: string };
          if (state === 'ready' || state === 'no_preview') {
            router.refresh();
            return;
          }
          if (state === 'delayed') {
            setMessage('The preview is taking longer than usual. You can still download the file.');
          }
        }
      } catch {
        // Network blip: keep trying.
      }
      // 3 s for the first minute, then every 15 s.
      setTimeout(check, attempts < 20 ? 3000 : 15000);
    }
    const timer = setTimeout(check, 2000);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [documentId, router]);

  return (
    <p role="status" aria-live="polite" className="flex items-center gap-3 rounded-xl bg-wait-soft px-4 py-3 text-lg text-wait">
      <span aria-hidden="true" className="size-5 shrink-0 animate-spin rounded-full border-4 border-wait border-t-transparent" />
      {message}
    </p>
  );
}
