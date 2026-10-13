/**
 * Replit injects the Umami tracker only for published apps with analytics
 * enabled. Keep calls optional and failure-isolated so local development and
 * tracker outages never affect product behavior.
 */
export function trackEvent(name, data) {
  if (typeof window === 'undefined') return;

  try {
    window.umami?.track(name, data);
  } catch {
    // Analytics must never break the app.
  }
}