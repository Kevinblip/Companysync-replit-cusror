import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

function computeBearing(fromLat, fromLng, toLat, toLng) {
  const toRad = d => d * Math.PI / 180;
  const dLng = toRad(toLng - fromLng);
  const lat1 = toRad(fromLat);
  const lat2 = toRad(toLat);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

// Compute a lat/lng that is `meters` away from (lat,lng) in `bearingDeg` direction.
function offsetLatLng(lat, lng, meters, bearingDeg) {
  const R = 6371000;
  const d = meters / R;
  const φ1 = lat * Math.PI / 180;
  const λ1 = lng * Math.PI / 180;
  const θ = bearingDeg * Math.PI / 180;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(d) + Math.cos(φ1) * Math.sin(d) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(d) * Math.cos(φ1), Math.cos(d) - Math.sin(φ1) * Math.sin(φ2));
  return { lat: φ2 * 180 / Math.PI, lng: λ2 * 180 / Math.PI };
}

// Promisified wrapper around the callback-based StreetViewService.
function getPanoAt(sv, lat, lng) {
  return new Promise(resolve => {
    sv.getPanorama(
      { location: { lat, lng }, radius: 100, source: "outdoor" },
      (data, svStatus) => {
        if (svStatus !== "OK") { resolve(null); return; }
        resolve({
          panoId:  data.location.pano,
          panoLat: data.location.latLng?.lat() ?? lat,
          panoLng: data.location.latLng?.lng() ?? lng,
        });
      }
    );
  });
}

// Single-face Street View aimed at the house from a compass direction.
// compassDeg: 0=N face (camera south of house looking north),
//             90=E face, 180=S face, 270=W face.
export function CompassStreetView({ latitude, longitude, compassDeg, googleMapsLoaded }) {
  const divRef = useRef(null);
  const panoRef = useRef(null);
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    if (!googleMapsLoaded || !latitude || !longitude) return;
    setStatus("loading");
    if (panoRef.current) { try { panoRef.current.setVisible(false); } catch (_) {} panoRef.current = null; }
    if (!window.google?.maps?.StreetViewService) return;

    const sv = new window.google.maps.StreetViewService();
    // Stand OPPOSITE the compass direction so we're looking AT that face.
    // e.g. to see North face: stand to the North (offset 0°) and look South.
    const candidate = offsetLatLng(latitude, longitude, 80, compassDeg);
    let cancelled = false;

    (async () => {
      let info = await getPanoAt(sv, candidate.lat, candidate.lng);
      if (!info) info = await getPanoAt(sv, latitude, longitude); // fallback to front
      if (cancelled) return;
      if (!info || !divRef.current) { setStatus("none"); return; }
      const heading = computeBearing(info.panoLat, info.panoLng, latitude, longitude);
      const pano = new window.google.maps.StreetViewPanorama(divRef.current, {
        pano: info.panoId,
        pov: { heading, pitch: 5 },
        zoom: 0,
        disableDefaultUI: true,
        clickToGo: false,
        motionTracking: false,
        motionTrackingControl: false,
      });
      panoRef.current = pano;
      setStatus("ok");
    })();

    return () => {
      cancelled = true;
      if (panoRef.current) { try { panoRef.current.setVisible(false); } catch (_) {} panoRef.current = null; }
    };
  }, [googleMapsLoaded, latitude, longitude, compassDeg]);

  const DIR = { 0: "North", 90: "East", 180: "South", 270: "West" };
  const dirLabel = DIR[compassDeg] ?? "";

  return (
    <div className="space-y-1">
      {status === "loading" && (
        <div className="flex items-center gap-2 text-blue-600 text-sm py-4">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Finding {dirLabel} face street view…</span>
        </div>
      )}
      {status === "none" && (
        <div className="text-sm text-orange-600 py-3">No street coverage on the {dirLabel} side.</div>
      )}
      <div
        ref={divRef}
        style={{
          width: "100%",
          height: status === "ok" ? "260px" : "0px",
          display: status === "ok" ? "block" : "none",
          borderRadius: "8px",
          overflow: "hidden",
        }}
      />
      {status === "ok" && (
        <p className="text-xs text-gray-400 pt-1">Drag to look around · {dirLabel} face of the house</p>
      )}
    </div>
  );
}

export default function StreetViewPanel({ latitude, longitude, address, googleMapsLoaded, onStreetViewReady }) {
  const divRef = useRef(null);
  const panoramaRef = useRef(null);
  const [status, setStatus] = useState("loading");
  const [panoInfo, setPanoInfo] = useState(null);
  const onStreetViewReadyRef = useRef(onStreetViewReady);

  useEffect(() => {
    onStreetViewReadyRef.current = onStreetViewReady;
  }, [onStreetViewReady]);

  useEffect(() => {
    if (!googleMapsLoaded || !latitude || !longitude) return;
    if (!window.google?.maps?.StreetViewService) return;

    let cancelled = false;
    const sv = new window.google.maps.StreetViewService();
    setStatus("loading");
    setPanoInfo(null);

    getPanoAt(sv, latitude, longitude).then((frontPano) => {
      if (cancelled) return;
      if (!frontPano) {
        setStatus("none");
        onStreetViewReadyRef.current?.({ panoId: null, latitude, longitude, mode: "none" });
        return;
      }
      setPanoInfo(frontPano);
      setStatus("ok");
    });

    return () => {
      cancelled = true;
      if (panoramaRef.current) {
        try { panoramaRef.current.setVisible(false); } catch (_) {}
        panoramaRef.current = null;
      }
    };
  }, [googleMapsLoaded, latitude, longitude]);

  useEffect(() => {
    if (status !== "ok" || !panoInfo || !divRef.current) return;
    if (!window.google?.maps?.StreetViewPanorama) return;

    const heading = computeBearing(panoInfo.panoLat, panoInfo.panoLng, latitude, longitude);
    const pano = new window.google.maps.StreetViewPanorama(divRef.current, {
      pano: panoInfo.panoId,
      pov: { heading, pitch: 5 },
      zoom: 0,
      addressControl: false,
      showRoadLabels: false,
      clickToGo: false,
      motionTracking: false,
      motionTrackingControl: false,
    });
    panoramaRef.current = pano;

    onStreetViewReadyRef.current?.({
      panoId: panoInfo.panoId,
      latitude, longitude,
      mode: "street",
    });
  }, [status, panoInfo, latitude, longitude]);

  if (status === "loading") {
    return (
      <div className="flex items-center gap-2 text-blue-600 text-sm py-3">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span>Finding the street-facing view…</span>
      </div>
    );
  }

  if (status === "none") {
    return (
      <div className="rounded-lg border border-orange-200 bg-orange-50 p-4 text-sm text-orange-700">
        No street-facing Street View coverage was found for this address. Use the aerial map and site photos to verify the property.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative rounded-lg overflow-hidden border-2 border-indigo-200 bg-gray-100">
        <div ref={divRef} style={{ height: "380px", width: "100%" }} />
        <div className="absolute top-3 left-3 bg-black/75 text-white text-sm px-3 py-1 rounded font-bold pointer-events-none z-20">
          Front of house
        </div>
      </div>
      <p className="text-xs text-gray-400">
        Street-facing reference from the nearest road position · Drag to look around
      </p>
    </div>
  );
}
