// Registration only. CompanySync does not send pushes from this app.
export async function initPush() {
  if (import.meta.env.VITE_PUSH_ENABLED !== 'true') {
    console.info('[Push] Off. Set VITE_PUSH_ENABLED=true after APNs and FCM exist. Nothing is sent.');
    return;
  }
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    const permission = await PushNotifications.requestPermissions();
    if (permission.receive !== 'granted') return;
    await PushNotifications.addListener('registration', (token) => {
      try {
        sessionStorage.setItem('companysync_push_token', token.value);
      } catch {
        // sessionStorage can be unavailable in a private webview.
      }
      console.info('[Push] Device registered. Token stored locally. No notification was sent.');
    });
    await PushNotifications.addListener('registrationError', (err) => {
      console.warn('[Push] Registration failed:', err);
    });
    await PushNotifications.register();
  } catch (err) {
    console.warn('[Push] Plugin unavailable:', err?.message || err);
  }
}
