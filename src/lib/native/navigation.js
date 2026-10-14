import { isNativeApp } from './platform';

export function nativeLoginPath() {
  return '/login';
}

export async function logoutKeepingBundle() {
  try {
    await fetch('/api/logout-app', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.warn('[Native] Logout request failed:', err?.message || err);
  }
  window.location.replace('/login');
}

export function redirectToLogin() {
  if (isNativeApp()) {
    window.location.assign('/login');
    return;
  }
  window.location.href = '/api/login';
}

export function logoutFromApp() {
  if (isNativeApp()) {
    logoutKeepingBundle();
    return;
  }
  window.location.href = '/api/logout';
}
