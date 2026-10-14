export async function initBackButton() {
  try {
    const { App } = await import('@capacitor/app');
    await App.addListener('backButton', ({ canGoBack }) => {
      if (canGoBack || window.history.length > 1) {
        window.history.back();
        return;
      }
      App.exitApp();
    });
  } catch (err) {
    console.warn('[Native] Back button unavailable:', err?.message || err);
  }
}
