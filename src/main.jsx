import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import ErrorBoundary from '@/components/ErrorBoundary'
import '@/index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <ErrorBoundary fullPage>
    <App />
  </ErrorBoundary>
)

// Becomes true only when the user explicitly clicks "Update now". The service
// worker's initial takeover (clients.claim() on first install) also fires a
// `controllerchange` event; without this flag we reloaded on that first
// takeover, causing an endless reload / "flashing" loop for visitors — e.g. a
// customer opening a public contract-signing link.
let pwaUpdateRequested = false;

function showUpdateBanner(registration) {
  if (document.getElementById('pwa-update-banner')) return;
  const banner = document.createElement('div');
  banner.id = 'pwa-update-banner';
  banner.style.cssText = [
    'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:99999',
    'background:#1d4ed8', 'color:white',
    'display:flex', 'align-items:center', 'justify-content:center', 'gap:12px',
    'padding:10px 16px',
    'font-family:system-ui,-apple-system,sans-serif',
    'font-size:14px', 'font-weight:500',
    'box-shadow:0 2px 8px rgba(0,0,0,0.3)',
  ].join(';');
  banner.innerHTML = `
    <span>🔄 A new version of CompanySync is available!</span>
    <button id="pwa-update-btn" style="background:white;color:#1d4ed8;border:none;border-radius:6px;padding:5px 14px;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap">Update now</button>
    <button id="pwa-dismiss-btn" style="background:transparent;color:rgba(255,255,255,0.7);border:none;padding:4px 8px;cursor:pointer;font-size:18px;line-height:1;">✕</button>
  `;
  document.body.prepend(banner);

  document.getElementById('pwa-update-btn').addEventListener('click', () => {
    if (registration.waiting) {
      pwaUpdateRequested = true;
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    }
    banner.remove();
  });

  document.getElementById('pwa-dismiss-btn').addEventListener('click', () => {
    banner.remove();
  });
}

if ('serviceWorker' in navigator) {
  let refreshing = false;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((registration) => {
        console.log('[PWA] Service worker registered, scope:', registration.scope);

        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              showUpdateBanner(registration);
            }
          });
        });

        navigator.serviceWorker.addEventListener('controllerchange', () => {
          // Only reload when the user opted into an update via the banner.
          // The initial service-worker takeover (clients.claim on first install)
          // also fires this event; reloading there caused an infinite reload loop.
          if (!pwaUpdateRequested || refreshing) return;
          refreshing = true;
          console.log('[PWA] New service worker active — reloading for fresh code');
          window.location.reload();
        });
      })
      .catch((error) => {
        console.error('[CompanySync_Error][PWA] Service worker registration failed:', error);
      });
  });
}
