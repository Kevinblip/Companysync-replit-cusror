import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, X } from 'lucide-react';

/**
 * Admin-only red banner shown when the configured email provider is rejecting
 * sends with an auth failure (invalid/suspended API key) — meaning ALL app
 * email (digests, storm alerts, drips) is down. Polls the lightweight
 * status endpoint every 5 minutes; renders nothing when email is healthy.
 */
export default function EmailDeliveryBanner({ isAdmin }) {
  const [status, setStatus] = useState(null);
  const [dismissed, setDismissed] = useState(() => {
    try { return sessionStorage.getItem('emailBannerDismissed') === '1'; } catch (_) { return false; }
  });

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch('/api/local/email-provider-status');
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setStatus(data);
      } catch (_) { /* network hiccup — keep last known status */ }
    };
    check();
    window.addEventListener('email-provider-health-changed', check);
    const t = setInterval(check, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      window.removeEventListener('email-provider-health-changed', check);
      clearInterval(t);
    };
  }, [isAdmin]);

  if (!isAdmin || dismissed || !status || status.state !== 'auth_failed') return null;

  const providerName = status.provider === 'postmark'
    ? 'Postmark'
    : status.provider === 'ses'
      ? 'Amazon SES'
      : 'CompanySync email delivery';
  const providerUrl = status.provider === 'postmark'
    ? 'postmarkapp.com'
    : status.provider === 'ses'
      ? 'console.aws.amazon.com'
      : '';
  const providerHelp = providerUrl ? ` Log in at ${providerUrl} to fix the account.` : '';

  const dismiss = () => {
    setDismissed(true);
    try { sessionStorage.setItem('emailBannerDismissed', '1'); } catch (_) { /* ignore */ }
  };

  return createPortal(
    <div
      className="fixed bottom-3 left-1/2 -translate-x-1/2 z-50 max-w-[92vw] rounded-full shadow-lg bg-red-600 text-white px-3 py-1.5 text-xs flex items-center gap-1.5"
      role="alert"
      title={`${providerName} is rejecting sends — digests, storm alerts, and customer emails are not being delivered.${providerHelp}`}
    >
      <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
      <span className="truncate">
        <span className="font-semibold">Customer emails are paused</span>
        <span className="hidden sm:inline"> — fix the {providerName} account{providerUrl ? ` at ${providerUrl}` : ''}</span>
      </span>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss email warning"
        className="ml-auto p-0.5 rounded hover:bg-red-700 flex-shrink-0"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>,
    document.body
  );
}
