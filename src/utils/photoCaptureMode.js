export const AI_ESTIMATOR_CAPTURE_MODE_KEY = 'aiestimator_capture_mode';

export function readCaptureMode(storage = globalThis.sessionStorage) {
  try {
    const mode = storage?.getItem(AI_ESTIMATOR_CAPTURE_MODE_KEY);
    return mode === 'camera' || mode === 'upload' ? mode : 'upload';
  } catch {
    return 'upload';
  }
}

export function persistCaptureMode(mode, storage = globalThis.sessionStorage) {
  const safeMode = mode === 'camera' ? 'camera' : 'upload';
  try {
    storage?.setItem(AI_ESTIMATOR_CAPTURE_MODE_KEY, safeMode);
  } catch {
    // Persistence is best-effort; the in-memory React state still changes.
  }
  return safeMode;
}

export function slotPickerAttributes(captureMode) {
  return captureMode === 'camera'
    ? { accept: 'image/*', capture: 'environment' }
    : { accept: 'image/jpeg,image/png,image/heic,image/heif,image/webp' };
}