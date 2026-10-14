// Native-shell helpers with no Capacitor imports, so the web bundle stays small
// and web behavior does not change when these return false.

export const DEFAULT_API_BASE_URL = 'https://getcompanysync.com';

export const NATIVE_CLIENT_HEADER = 'X-CompanySync-Native';

export const NATIVE_BILLING_MESSAGE =
  'Plan changes are not available in the app. This app does not sell subscriptions or take payment.';

export const NATIVE_SIGNUP_MESSAGE =
  'New accounts are created on the web. If you already have an account, sign in here.';

export function isNativeApp(win) {
  const target = win || (typeof window !== 'undefined' ? window : undefined);
  const cap = target?.Capacitor;
  if (!cap) return false;
  if (typeof cap.isNativePlatform === 'function') return cap.isNativePlatform() === true;
  const platform = typeof cap.getPlatform === 'function' ? cap.getPlatform() : cap.platform;
  return !!platform && platform !== 'web';
}

export function billingCopyIsStoreSafe(text) {
  const value = String(text || '');
  if (/https?:\/\//i.test(value)) return false;
  if (/www\./i.test(value)) return false;
  if (/stripe/i.test(value)) return false;
  if (/getcompanysync\.com/i.test(value)) return false;
  return value.length > 0;
}
