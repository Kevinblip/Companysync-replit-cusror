export async function initStatusBarAndSplash() {
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setOverlaysWebView({ overlay: false });
    await StatusBar.setBackgroundColor({ color: '#1e3a5f' });
    await StatusBar.setStyle({ style: Style.Dark });
  } catch (err) {
    console.warn('[Native] Status bar unavailable:', err?.message || err);
  }
  try {
    const { SplashScreen } = await import('@capacitor/splash-screen');
    await SplashScreen.hide();
  } catch (err) {
    console.warn('[Native] Splash screen unavailable:', err?.message || err);
  }
}
