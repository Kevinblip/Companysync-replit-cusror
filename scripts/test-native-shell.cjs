'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

async function main() {
  const urlRewrite = await import('../src/lib/native/urlRewrite.js');
  const platform = await import('../src/lib/native/platform.js');
  const photoAccept = await import('../src/lib/native/photoAccept.js');
  const cookies = require('../lib/nativeSessionCookie.cjs');
  const mobile = require('../mobile.config.json');

  assert.strictEqual(platform.DEFAULT_API_BASE_URL, mobile.apiBaseUrl);
  assert.strictEqual(platform.billingCopyIsStoreSafe(platform.NATIVE_BILLING_MESSAGE), true);
  assert.strictEqual(platform.billingCopyIsStoreSafe(platform.NATIVE_SIGNUP_MESSAGE), true);
  assert.strictEqual(platform.billingCopyIsStoreSafe('Buy at https://getcompanysync.com'), false);
  assert.strictEqual(platform.isNativeApp({}), false);
  assert.strictEqual(platform.isNativeApp({ Capacitor: { isNativePlatform: () => false } }), false);
  assert.strictEqual(platform.isNativeApp({ Capacitor: { isNativePlatform: () => true } }), true);

  const api = 'https://getcompanysync.com';
  const native = { native: true, apiBase: api };
  const web = { native: false, apiBase: api };
  assert.strictEqual(urlRewrite.rewriteRequestUrl('/api/auth/user', web), '/api/auth/user');
  assert.strictEqual(urlRewrite.rewriteRequestUrl('/api/auth/user', native), 'https://getcompanysync.com/api/auth/user');
  assert.strictEqual(urlRewrite.rewriteRequestUrl('/assets/index.js', native), '/assets/index.js');
  assert.strictEqual(
    urlRewrite.rewriteRequestUrl('ws://localhost/ws/lexi-native?companyId=1', native),
    'wss://getcompanysync.com/ws/lexi-native?companyId=1'
  );
  assert.strictEqual(
    urlRewrite.rewriteRequestUrl('capacitor://localhost/api/functions/invoke', native),
    'https://getcompanysync.com/api/functions/invoke'
  );
  assert.strictEqual(
    urlRewrite.rewriteRequestUrl('https://accounts.google.com/o/oauth2/v2/auth', native),
    'https://accounts.google.com/o/oauth2/v2/auth'
  );

  assert.strictEqual(photoAccept.acceptsOnlyImages('image/*'), true);
  assert.strictEqual(photoAccept.acceptsOnlyImages('image/jpeg,image/png'), true);
  assert.strictEqual(photoAccept.acceptsOnlyImages('.pdf,.png,.jpg'), false);
  assert.strictEqual(photoAccept.acceptsOnlyImages(''), false);
  assert.strictEqual(photoAccept.shouldUseNativePhotoPicker({ type: 'file', accept: 'image/*', getAttribute: () => null }), true);
  assert.strictEqual(photoAccept.shouldUseNativePhotoPicker({ type: 'file', accept: '.pdf,.png', getAttribute: () => null }), false);

  assert.strictEqual(
    cookies.applyNativeSameSite('connect.sid=abc; Path=/; HttpOnly; SameSite=Lax; Secure'),
    'connect.sid=abc; Path=/; HttpOnly; SameSite=None; Secure'
  );
  assert.strictEqual(cookies.isNativeClient({ headers: {} }), false);
  assert.strictEqual(cookies.isNativeClient({ headers: { 'x-companysync-native': '1' } }), true);
  assert.strictEqual(cookies.isCapacitorOrigin('https://localhost'), true);
  assert.strictEqual(cookies.isCapacitorOrigin('https://localhost.evil.com'), false);
  assert.strictEqual(cookies.isCapacitorOrigin('https://getcompanysync.com'), false);

  const plist = path.join(__dirname, '..', 'ios', 'App', 'App', 'Info.plist');
  assert.ok(fs.existsSync(plist), 'ios Info.plist missing');
  const plistText = fs.readFileSync(plist, 'utf8');
  for (const key of [
    'NSCameraUsageDescription',
    'NSPhotoLibraryUsageDescription',
    'NSPhotoLibraryAddUsageDescription',
    'NSMicrophoneUsageDescription',
    'NSLocationWhenInUseUsageDescription',
    'ITSAppUsesNonExemptEncryption',
  ]) {
    assert.ok(plistText.includes(key), `missing ${key}`);
  }
  assert.ok(!plistText.includes('NSLocationAlways'), 'background location must not be requested');

  const manifest = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
  assert.ok(fs.existsSync(manifest), 'AndroidManifest missing');
  const manifestText = fs.readFileSync(manifest, 'utf8');
  for (const perm of [
    'android.permission.CAMERA',
    'android.permission.RECORD_AUDIO',
    'android.permission.MODIFY_AUDIO_SETTINGS',
    'android.permission.ACCESS_FINE_LOCATION',
    'android.permission.ACCESS_COARSE_LOCATION',
    'android.permission.POST_NOTIFICATIONS',
  ]) {
    assert.ok(manifestText.includes(perm), `missing ${perm}`);
  }
  assert.ok(!manifestText.includes('ACCESS_BACKGROUND_LOCATION'), 'background location must not be requested');

  console.log('native shell checks passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
