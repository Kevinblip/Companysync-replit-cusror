import React, { useState, useEffect } from "react";

// App-wide PWA install banner. Listens for beforeinstallprompt (Android/desktop
// Chrome) and shows a dismissible banner. Dismissal is remembered in
// localStorage under the same key the old InspectionCapture banner used.
export default function PwaInstallBanner() {
  const [installPrompt, setInstallPrompt] = useState(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (localStorage.getItem("pwaBannerDismissed")) return;
    // Already running as an installed app — nothing to offer
    if (window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone) return;
    const handler = (e) => {
      e.preventDefault();
      setInstallPrompt(e);
      setVisible(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (!visible) return null;

  return (
    <div
      className="fixed bottom-0 inset-x-0 z-[600] bg-blue-700 text-white px-4 py-3 flex items-center justify-between gap-3 shadow-xl"
      style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      data-testid="banner-pwa-install"
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold leading-tight">📲 Add CompanySync to your home screen</p>
        <p className="text-xs text-blue-200 mt-0.5">Runs full-screen like a native app — faster, no browser chrome.</p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          data-testid="button-pwa-install"
          className="bg-white text-blue-700 text-xs font-bold px-3 py-1.5 rounded-full"
          onClick={async () => {
            if (installPrompt) {
              installPrompt.prompt();
              const { outcome } = await installPrompt.userChoice;
              if (outcome === "accepted") localStorage.setItem("pwaBannerDismissed", "1");
            }
            setVisible(false);
          }}
        >Install</button>
        <button
          data-testid="button-pwa-dismiss"
          className="text-blue-200 hover:text-white text-xs px-2 py-1"
          onClick={() => {
            localStorage.setItem("pwaBannerDismissed", "1");
            setVisible(false);
          }}
        >Not now</button>
      </div>
    </div>
  );
}
