function toWebPosition(position) {
  const coords = position?.coords || {};
  return {
    coords: {
      latitude: coords.latitude,
      longitude: coords.longitude,
      accuracy: coords.accuracy ?? null,
      altitude: coords.altitude ?? null,
      altitudeAccuracy: coords.altitudeAccuracy ?? null,
      heading: coords.heading ?? null,
      speed: coords.speed ?? null,
    },
    timestamp: position?.timestamp || Date.now(),
  };
}

function toWebError(err) {
  const message = String(err?.message || err || 'Location unavailable');
  const denied = /denied|permission/i.test(message);
  return { code: denied ? 1 : 2, message, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 };
}

export async function initGeolocationBridge() {
  if (!navigator.geolocation) return;
  let Geolocation;
  try {
    ({ Geolocation } = await import('@capacitor/geolocation'));
  } catch (err) {
    console.warn('[Native] Geolocation plugin unavailable:', err?.message || err);
    return;
  }

  const original = navigator.geolocation;
  const watches = new Map();
  let nextId = 1;

  navigator.geolocation.getCurrentPosition = (success, error, options = {}) => {
    Geolocation.getCurrentPosition({
      enableHighAccuracy: !!options.enableHighAccuracy,
      timeout: options.timeout,
      maximumAge: options.maximumAge,
    }).then((position) => success(toWebPosition(position))).catch((err) => {
      if (error) error(toWebError(err));
      else original.getCurrentPosition(success, error, options);
    });
  };

  navigator.geolocation.watchPosition = (success, error, options = {}) => {
    const id = nextId;
    nextId += 1;
    Geolocation.watchPosition({
      enableHighAccuracy: !!options.enableHighAccuracy,
      timeout: options.timeout,
      maximumAge: options.maximumAge,
    }, (position, err) => {
      if (err) error?.(toWebError(err));
      else if (position) success(toWebPosition(position));
    }).then((nativeId) => {
      watches.set(id, nativeId);
    }).catch((err) => error?.(toWebError(err)));
    return id;
  };

  navigator.geolocation.clearWatch = (id) => {
    const nativeId = watches.get(id);
    watches.delete(id);
    if (nativeId) Geolocation.clearWatch({ id: nativeId });
    else original.clearWatch(id);
  };
}
