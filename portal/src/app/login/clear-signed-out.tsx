'use client';

import { useEffect } from 'react';

/**
 * Clears the one-time "signed out" note after it has been shown, and removes
 * ?signedout=1 from the address bar, so a reload does not show it again.
 */
export function ClearSignedOut({ cookie }: { cookie: string }) {
  useEffect(() => {
    document.cookie = `${cookie}=; Max-Age=0; Path=/login; SameSite=Lax`;
    const url = new URL(window.location.href);
    if (url.searchParams.has('signedout')) {
      url.searchParams.delete('signedout');
      window.history.replaceState(null, '', url.pathname + url.search);
    }
  }, [cookie]);
  return null;
}
