import { useEffect, useState } from 'react';

/**
 * Opens after the browser has had a chance to paint the page shell.
 * Use this for secondary/bulk queries that should not compete with primary
 * navigation content. The timeout guarantees progress on busy browsers.
 */
export function usePostPaintGate(enabled, sectionName = 'page') {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(false);
    if (!enabled) return undefined;

    let cancelled = false;
    let idleId;
    let timeoutId;
    const activate = () => {
      if (cancelled) return;
      setReady(true);
      if (typeof window.performance?.mark === 'function') {
        window.performance.mark(`crm:${sectionName}:secondary-data-start`);
      }
    };

    if (typeof window.requestIdleCallback === 'function') {
      idleId = window.requestIdleCallback(activate, { timeout: 750 });
    } else {
      timeoutId = window.setTimeout(activate, 250);
    }

    return () => {
      cancelled = true;
      if (idleId !== undefined && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, [enabled, sectionName]);

  return ready;
}