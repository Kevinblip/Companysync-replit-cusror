import { useEffect, useRef, useState, useCallback } from "react";
import { Loader2 } from "lucide-react";

const AERIAL_VIEWS = [
  { label: "North",  heading: 0 },
  { label: "East",   heading: 90 },
  { label: "South",  heading: 180 },
  { label: "West",   heading: 270 },
];

export default function StreetViewPanel({ latitude, longitude, address, googleMapsLoaded, onStreetViewReady }) {
  const mapRefs = useRef([null, null, null, null]);
  const mapInstances = useRef([]);
  const [status, setStatus] = useState("loading");
  const initAttempted = useRef(false);
  const coordsKey = useRef("");

  const initMaps = useCallback(() => {
    if (!googleMapsLoaded || !latitude || !longitude) return;
    if (!window.google?.maps?.Map) return;

    const key = `${latitude},${longitude}`;
    if (initAttempted.current && coordsKey.current === key) return;

    const anyReady = mapRefs.current.some(el => el && el.offsetWidth > 0);
    if (!anyReady) return;

    initAttempted.current = true;
    coordsKey.current = key;
    mapInstances.current = [];

    const center = { lat: latitude, lng: longitude };

    AERIAL_VIEWS.forEach((view, i) => {
      const el = mapRefs.current[i];
      if (!el) return;

      const map = new window.google.maps.Map(el, {
        center,
        zoom: 19,
        mapTypeId: "satellite",
        tilt: 45,
        heading: view.heading,
        disableDefaultUI: true,
        gestureHandling: "none",
        keyboardShortcuts: false,
        clickableIcons: false,
      });

      new window.google.maps.Marker({
        position: center,
        map,
        icon: {
          path: window.google.maps.SymbolPath.CIRCLE,
          scale: 6,
          fillColor: "#EF4444",
          fillOpacity: 0.9,
          strokeColor: "#FFFFFF",
          strokeWeight: 2,
        },
      });

      mapInstances.current.push(map);
    });

    setStatus("ok");
    if (onStreetViewReady) {
      onStreetViewReady({ panoId: null, latitude, longitude, headings: AERIAL_VIEWS, mode: "aerial" });
    }
  }, [googleMapsLoaded, latitude, longitude, onStreetViewReady]);

  useEffect(() => {
    const key = `${latitude},${longitude}`;
    if (coordsKey.current !== key) {
      initAttempted.current = false;
      mapInstances.current = [];
      setStatus("loading");
    }
  }, [latitude, longitude]);

  useEffect(() => {
    if (!googleMapsLoaded || !latitude || !longitude) return;
    if (initAttempted.current && coordsKey.current === `${latitude},${longitude}`) return;

    initMaps();

    const interval = setInterval(() => {
      if (initAttempted.current) {
        clearInterval(interval);
        return;
      }
      initMaps();
    }, 100);

    const timeout = setTimeout(() => {
      clearInterval(interval);
      if (!initAttempted.current) setStatus("none");
    }, 3000);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [googleMapsLoaded, latitude, longitude, initMaps]);

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        {AERIAL_VIEWS.map((view, i) => (
          <div key={view.label} className="relative rounded-lg overflow-hidden border-2 border-indigo-200">
            <div
              ref={el => { mapRefs.current[i] = el; }}
              style={{ height: "160px", width: "100%" }}
            />
            {status === "loading" && (
              <div className="absolute inset-0 bg-gray-100 flex items-center justify-center z-10">
                <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
              </div>
            )}
            {status === "none" && (
              <div className="absolute inset-0 bg-gray-50 flex flex-col items-center justify-center z-10 text-gray-400">
                <span className="text-xs">No imagery</span>
              </div>
            )}
            <div className="absolute top-1 left-1 bg-black/70 text-white text-xs px-2 py-0.5 rounded font-bold pointer-events-none z-20">
              {view.label}
            </div>
          </div>
        ))}
      </div>

      {status === "ok" && (
        <p className="text-xs text-gray-400">
          Roof from 4 compass directions · Red dot = property center
        </p>
      )}
      {status === "none" && (
        <p className="text-xs text-orange-600">
          Aerial views unavailable. Satellite pitch estimate will be used.
        </p>
      )}
    </div>
  );
}
