import { installNativeApiBase } from './installApiBase';
import { initBackButton } from './backButton';
import { initStatusBarAndSplash } from './chrome';
import { initGeolocationBridge } from './geolocationBridge';
import { initPhotoPicker } from './photoPicker';
import { initPush } from './push';

export async function bootNativeShell() {
  installNativeApiBase();
  document.documentElement.classList.add('capacitor-native');
  await initStatusBarAndSplash();
  await initBackButton();
  await initPhotoPicker();
  await initGeolocationBridge();
  await initPush();
}

bootNativeShell().catch((err) => {
  console.error('[Native] Shell failed to start:', err);
});
