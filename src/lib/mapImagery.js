// ─────────────────────────────────────────────────────────────────────────────
// Shared satellite-imagery controls for the roof measurement maps.
//
// Both the MANUAL drawing map (components/satellite/InteractiveRoofMap.jsx) and
// the AUTO / AI estimator map (pages/AIEstimator.jsx) share alternate imagery
// sources and tilt controls.
//
// They used to carry two independent copies. The auto copy was the weaker one
// (crude zoom-18 clamp, no placeholder detection, no pointer-event shielding),
// which is why Winter looked usable in manual and not in auto. This module is
// the single implementation; both maps now render the identical control.
// ─────────────────────────────────────────────────────────────────────────────

import { listPropertyImagery } from './historicalImagery.js';

// Esri serves a small "no data here" placeholder image instead of a 404 for
// missing LODs. Anything at or under this size is treated as "no real tile".
export const ESRI_PLACEHOLDER_MAX_BYTES = 4000;

// Exported because the SERVER-side measurement takeoff must pull the exact same
// tiles the reviewer is looking at. If these diverge, the report cites imagery
// that never produced the measurement.
export const ESRI_CLARITY_TILES =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
export const WAYBACK_TILES =
  'https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile';
const WAYBACK_CONFIG_URL =
  'https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json';

export const IMAGERY_SOURCES = [
  { key: 'google', label: 'Default' },
  { key: 'esri_clarity', label: 'Current' },
];

export const TILT_ANGLES = [
  { label: '0°', tilt: 0, title: 'Top-down (flat)' },
  { label: '30°', tilt: 30, title: '30° angle' },
  { label: '45°', tilt: 45, title: '45° oblique (classic)' },
  { label: '60°', tilt: 60, title: '60° angle — more perspective' },
  { label: '67°', tilt: 67, title: 'Maximum tilt (~67°)' },
];

// Google satellite imagery supports closer inspection at zoom 22. Alternate
// imagery sources may upscale their sharpest available tile at this level.
// Never put current satellite imagery underneath a dated historical capture.
export const MAX_MEASUREMENT_ZOOM = 22;
const selectedBaseTypes = new WeakMap();

// Compass/Top controls must preserve the selected photo rather than putting
// Google satellite back underneath a historical layer.
export function getImageryBaseType(map) {
  return selectedBaseTypes.get(map) || 'satellite';
}

// Same Mercator coordinates, with no current Google photograph underneath.
// Missing historical tiles must look missing, not like a successful switch.
export function setAlternateImageryBase(map) {
  map.setTilt?.(0);
  if (map.mapTypes?.set && window.google.maps.ImageMapType) {
    map.mapTypes.set('cs-imagery-empty', new window.google.maps.ImageMapType({
      getTileUrl: () => null,
      tileSize: new window.google.maps.Size(256, 256),
      maxZoom: MAX_MEASUREMENT_ZOOM,
      minZoom: 0,
      name: 'Selected imagery',
    }));
    selectedBaseTypes.set(map, 'cs-imagery-empty');
    map.setMapTypeId('cs-imagery-empty');
  } else {
    // No satellite pixels can bleed through even on a map implementation that
    // does not support custom base types.
    selectedBaseTypes.set(map, 'roadmap');
    map.setMapTypeId('roadmap');
  }
}

export function chooseWinterCapture(options) {
  // Deep-winter captures are more likely to be leaf-off than early November.
  // This uses acquisition dates, never the archive release date.
  const priority = date => {
    const month = Number(date?.slice(5, 7));
    return [1, 2, 12].includes(month) ? 3 : month === 3 ? 2 : month === 11 ? 1 : 0;
  };
  return options.filter(option => priority(option.captureDate) > 0)
    .sort((a, b) => priority(b.captureDate) - priority(a.captureDate) ||
      b.captureDate.localeCompare(a.captureDate))[0] || null;
}

/**
 * Look up the newest ArcGIS Wayback release and the newest winter release.
 *
 * The config shape drifts between ArcGIS revisions. Currently it is an object
 * keyed by release number whose values carry an itemTitle like
 * "World Imagery (Wayback 2026-02-26)". Release numbers are NOT chronological,
 * so the date is parsed out of the title and sorted on. The older array and
 * `versionsInfo` shapes are still tolerated.
 *
 * Resolves to { winter, recent } with null entries on any failure — callers
 * fall back to Esri Clarity, never to a broken tile URL.
 */
export async function fetchWaybackIds() {
  try {
    const res = await fetch(WAYBACK_CONFIG_URL);
    const data = await res.json();
    const raw = Array.isArray(data)
      ? data
      : Array.isArray(data.versionsInfo)
        ? data.versionsInfo
        : Object.entries(data).map(([id, v]) => ({ ...v, releaseNum: v?.releaseNum ?? id }));
    const parsed = raw
      .map((v) => {
        const m = /(\d{4})-(\d{2})-(\d{2})/.exec(v?.itemTitle || v?.releaseDatetime || '');
        return m
          ? { id: v.releaseNum, date: Date.parse(`${m[1]}-${m[2]}-${m[3]}`), month: Number(m[2]) }
          : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.date - a.date);
    if (!parsed.length) return { winter: null, recent: null };
    const recent = parsed[0];
    const winter = parsed.find((p) => p.month === 12 || p.month === 1 || p.month === 2);
    return { recent: recent?.id || null, winter: winter?.id || null };
  } catch {
    return { winter: null, recent: null };
  }
}

// Esri/Wayback top out well below Google's zoom 22. A plain ImageMapType would
// show gray tiles past their max LOD, so we hand-build tiles: the overlay stays
// pinned to the Google satellite base (which stays the map's coordinate system,
// so the house never shifts) and we crop/scale the correct sub-region of the
// parent tile.
//
// For sharpness we request the tile at the highest zoom Esri might serve
// (`preferMax`): when that native tile exists, scale=1 and it's crisp. Where
// Esri lacks that LOD we step DOWN one zoom at a time (upscaling the parent
// crop) until we hit a real tile, so we get the sharpest imagery that actually
// exists and never a gray "no data" tile. If nothing real is found down to
// `floor`, the tile stays empty; current Google imagery must not show through.
export function makeEsriOverzoomOverlay({ urlTemplate, preferMax, floor, name, onQuality }) {
  const tileFor = (z, x, y) => {
    const world = 20037508.342789244;
    const span = world * 2;
    const scale = span / (2 ** z);
    const xmin = -world + x * scale;
    const xmax = xmin + scale;
    const ymax = world - y * scale;
    const ymin = ymax - scale;
    const bbox = `${xmin},${ymin},${xmax},${ymax}`;
    return urlTemplate
      .replaceAll('{bbox}', bbox)
      .replace('{z}', z)
      .replace('{x}', x)
      .replace('{y}', y);
  };
  let qualityReported = false;
  const reportQuality = (quality) => {
    if (qualityReported) return;
    qualityReported = true;
    onQuality?.(quality);
  };
  return {
    tileSize: new window.google.maps.Size(256, 256),
    maxZoom: MAX_MEASUREMENT_ZOOM,
    minZoom: 0,
    name,
    alt: `${name} Imagery`,
    getTile(coord, zoom, ownerDocument) {
      const div = ownerDocument.createElement('div');
      div.style.cssText = 'width:256px;height:256px;overflow:hidden;position:relative;';
      const ctrl = new AbortController();
      div._abort = ctrl;
      div.style.background = '#e5e7eb';
      div.setAttribute('aria-label', `${name}: imagery loading`);

      const load = async (z) => {
        // floor bounds the step-DOWN (how far we upscale), but must never block
        // the initial native request when the map itself is zoomed out below it.
        if (z < Math.min(zoom, floor) || ctrl.signal.aborted) {
          reportQuality({ status: 'unavailable', name });
          div.setAttribute('aria-label', `${name}: imagery unavailable`);
          return;
        }
        const scale = Math.pow(2, Math.max(0, zoom - z));
        const tx = Math.floor(coord.x / scale);
        const ty = Math.floor(coord.y / scale);
        try {
          const res = await fetch(tileFor(z, tx, ty), { signal: ctrl.signal });
          if (!res.ok) return load(z - 1); // Wayback missing → 404
          const blob = await res.blob();
          if (blob.size <= ESRI_PLACEHOLDER_MAX_BYTES) return load(z - 1); // placeholder
          if (!blob.type.startsWith('image/')) return load(z - 1);
          if (ctrl.signal.aborted) return;
          const qualityStatus = z < zoom ? 'upscaled' : 'native';
          const objectUrl = URL.createObjectURL(blob);
          div._objectUrl = objectUrl;
          const img = ownerDocument.createElement('img');
          img.onload = () => {
            if (ctrl.signal.aborted) return;
            div.setAttribute('aria-label', `${name}: imagery loaded`);
            reportQuality({ status: qualityStatus, name, nativeZoom: z, mapZoom: zoom });
          };
          img.onerror = () => {
            img.remove();
            URL.revokeObjectURL(objectUrl);
            if (div._objectUrl === objectUrl) div._objectUrl = null;
            if (!ctrl.signal.aborted) load(z - 1);
          };
          img.style.cssText =
            `position:absolute;width:${256 * scale}px;height:${256 * scale}px;` +
            `left:${-(coord.x - tx * scale) * 256}px;top:${-(coord.y - ty * scale) * 256}px;`;
          img.src = objectUrl;
          div.appendChild(img);
        } catch {
          if (!ctrl.signal.aborted) return load(z - 1);
        }
      };

      load(Math.min(zoom, preferMax));
      return div;
    },
    releaseTile(tile) {
      if (tile && tile._abort) tile._abort.abort();
      if (tile && tile._objectUrl) URL.revokeObjectURL(tile._objectUrl);
    },
  };
}

/**
 * Swap the map to one imagery source.
 *
 * Alternate sources use an empty base, retaining the same Mercator coordinates.
 * Google satellite is restored only by explicitly selecting Default.
 *
 * Winter/Recent silently degrade to Esri Clarity when the Wayback lookup has
 * not resolved (or failed), so a click is never a no-op.
 */
export function applyImagerySource(map, sourceKey, waybackIds, onQuality) {
  if (!map) return;
  map.overlayMapTypes.clear();
  if (sourceKey === 'google') {
    selectedBaseTypes.delete(map);
    map.setMapTypeId('satellite');
    onQuality?.({ status: 'native', name: 'Default' });
    return;
  }
  setAlternateImageryBase(map);

  const ids = waybackIds || {};
  // preferMax = sharpest LOD to try first (native, no upscale when it exists);
  // the loader steps down to the first REAL tile, so overshoot is safe.
  // floor = don't upscale below this (too blurry to be useful).
  let urlTemplate = ESRI_CLARITY_TILES;
  let preferMax = 21;
  // Do not cover the sharp Google base with a very blurry parent tile. Four
  // times enlargement is the maximum useful fallback for these overlays.
  const floor = 18;
  if (sourceKey === 'esri_wayback_winter' && ids.winter) {
    urlTemplate = `${WAYBACK_TILES}/${ids.winter}/{z}/{y}/{x}`;
    preferMax = 20;
  } else if (sourceKey === 'esri_wayback_recent' && ids.recent) {
    urlTemplate = `${WAYBACK_TILES}/${ids.recent}/{z}/{y}/{x}`;
    preferMax = 20;
  }
  const name = IMAGERY_SOURCES.find((s) => s.key === sourceKey)?.label || 'Imagery';
  map.overlayMapTypes.push(makeEsriOverzoomOverlay({ urlTemplate, preferMax, floor, name, onQuality }));
}

// Google Maps fires its own click handler on mousedown/pointerdown, before the
// button's click event — so stopPropagation on the click alone is too late and
// the map pans out from under the control. Block pointer events on the
// container so the map never sees them.
function shieldFromMap(el) {
  ['mousedown', 'pointerdown', 'touchstart'].forEach((evt) =>
    el.addEventListener(evt, (e) => e.stopPropagation())
  );
}

/**
 * Build the imagery-source picker as a Google Maps custom control element.
 *
 * @param {object}   opts.map          the google.maps.Map instance
 * @param {function} opts.getWaybackIds  () => { winter, recent } — read lazily
 *                                       so a click after the async lookup lands
 *                                       still gets the real release ids
 * @param {string}   [opts.hint]       small caption under the buttons
 * @param {function} [opts.onChange]   called with the selected source key
 * @param {function} [opts.onQuality]  called with imagery quality status
 * @returns {HTMLElement}
 */
const IMAGERY_CONTROL_STYLE = `
  .cs-imagery-panel{box-sizing:border-box;margin:10px;display:flex;flex-direction:column;gap:5px;
    width:min(218px,calc(100vw - 36px));max-height:min(58vh,440px);overflow:hidden;
    padding:7px;background:rgba(248,247,241,.97);border:1px solid #c9c7bb;border-radius:8px;
    box-shadow:0 2px 10px rgba(29,43,43,.18);color:#263b3b;font:12px/1.35 system-ui,sans-serif;}
  .cs-imagery-top{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px}
  .cs-imagery-btn{min-height:30px;padding:5px 9px;border:1px solid #bdc8c3;border-radius:5px;
    background:#f8f7f1;color:#354b49;font:600 11px system-ui,sans-serif;cursor:pointer}
  .cs-imagery-btn:hover{background:#e8eee8}
  .cs-imagery-btn[aria-pressed="true"]{background:#315b55;border-color:#315b55;color:#fff}
  .cs-imagery-scroll{min-height:0;overflow-y:auto;overscroll-behavior:contain;padding-right:2px}
  .cs-imagery-meta{margin:2px 1px;color:#4c5d59;font-size:10px}
  .cs-imagery-note{padding:6px 7px;border-left:2px solid #bd8d49;background:#f1eee3;color:#4c5148;font-size:10px}
  .cs-imagery-status{min-height:14px;color:#354b49;font-size:10px}
  .cs-imagery-select{box-sizing:border-box;width:100%;min-height:32px;padding:5px 22px 5px 7px;
    border:1px solid #aab9b1;border-radius:5px;background:#fff;color:#263b3b;font:11px system-ui,sans-serif}
  .cs-imagery-warning{margin:3px 0;padding:6px 7px;border-radius:4px;background:#f2e8d5;color:#5b482b;font-size:10px}
  .cs-imagery-provider{margin:3px 1px 0;padding-top:4px;border-top:1px solid #deded4;color:#59635d;font-size:9px}
  .cs-imagery-panel button:focus-visible,.cs-imagery-panel select:focus-visible{outline:2px solid #bd8d49;outline-offset:1px}
  @media(max-width:600px){.cs-imagery-panel{margin:6px;width:min(196px,calc(100vw - 24px));max-height:48vh;padding:6px}}
`;

export function createImageryPickerControl({ map, getWaybackIds, hint, onChange, onQuality }) {
  const panel = document.createElement('div');
  panel.className = 'cs-imagery-panel';
  panel.setAttribute('aria-label', 'Map imagery controls');
  if (!document.getElementById('cs-imagery-control-style')) {
    const style = document.createElement('style');
    style.id = 'cs-imagery-control-style';
    style.textContent = IMAGERY_CONTROL_STYLE;
    document.head.appendChild(style);
  }
  shieldFromMap(panel);

  const buttonRow = document.createElement('div');
  buttonRow.className = 'cs-imagery-top';
  const buttons = [];
  const status = document.createElement('div');
  status.className = 'cs-imagery-status';
  status.setAttribute('role', 'status');
  const details = document.createElement('div');
  details.className = 'cs-imagery-scroll';
  const archiveCredit = document.createElement('div');
  archiveCredit.className = 'cs-imagery-provider';
  let archiveCreditText = '';
  let selectedMetadata = null;
  let lookupController = null;
  let lookupOrigin = null;
  let lookupMapListener = null;
  let requestId = 0;
  let currentOptions = [];

  const detachLookup = () => {
    if (lookupController) lookupController.abort();
    lookupController = null;
    if (lookupMapListener && window.google?.maps?.event) {
      window.google.maps.event.removeListener(lookupMapListener);
    }
    lookupMapListener = null;
    lookupOrigin = null;
  };
  const centerOfMap = () => {
    const center = map?.getCenter?.();
    if (!center) return null;
    return {
      lat: typeof center.lat === 'function' ? center.lat() : center.lat,
      lng: typeof center.lng === 'function' ? center.lng() : center.lng,
    };
  };
  const distanceMeters = (a, b) => {
    if (!a || !b) return Infinity;
    const radians = (deg) => (deg * Math.PI) / 180;
    const dLat = radians(b.lat - a.lat);
    const dLng = radians(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 +
      Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 6371000 * 2 * Math.asin(Math.sqrt(h));
  };
  const dateText = (value) => {
    if (!value) return 'Unknown';
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? String(value)
      : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
  };
  const qualityLabel = (quality) => {
    if (!quality) return '';
    if (quality.status === 'unavailable') return `${quality.name || 'Selected imagery'} tiles unavailable. Empty areas are not replaced with current Google photos.`;
    if (quality.status === 'upscaled') return `${quality.name || 'Selected imagery'} enlarged from zoom ${quality.nativeZoom}. Missing tiles stay empty.`;
    if (quality.status === 'native') return `${quality.name || 'Selected imagery'} tiles available at native detail.`;
    return '';
  };
  let qualityVersion = 0;
  const nextQualityHandler = () => {
    const version = ++qualityVersion;
    return (quality) => {
      if (version !== qualityVersion) return;
      status.textContent = qualityLabel(quality);
      onQuality?.(quality);
    };
  };
  const selectSourceButton = (key) => {
    buttons.forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.imagerySource === key));
    });
  };
  const renderOptionDetails = (option) => {
    if (!selectedMetadata) {
      selectedMetadata = document.createElement('div');
      selectedMetadata.className = 'cs-imagery-option-details';
      details.appendChild(selectedMetadata);
    }
    selectedMetadata.replaceChildren();
    const capture = document.createElement('div');
    capture.className = 'cs-imagery-meta';
    capture.textContent = `Capture date: ${dateText(option.captureDate)}`;
    selectedMetadata.appendChild(capture);
    const release = document.createElement('div');
    release.className = 'cs-imagery-meta';
    release.textContent = `Archive release: ${dateText(option.releaseDate)}`;
    selectedMetadata.appendChild(release);
    const leafOff = document.createElement('div');
    leafOff.className = 'cs-imagery-meta';
    leafOff.textContent = option.leafOffCandidate
      ? 'Possible leaf-off candidate — NOT verified leaf-off'
      : 'Leaf-off status not verified';
    selectedMetadata.appendChild(leafOff);
    if (option.resolution) {
      const resolution = document.createElement('div');
      resolution.className = 'cs-imagery-meta';
      resolution.textContent = `Resolution: ${option.resolution}`;
      selectedMetadata.appendChild(resolution);
    }
    const attribution = document.createElement('div');
    attribution.className = 'cs-imagery-provider';
    attribution.textContent = option.attribution || option.source || 'Imagery provider attribution unavailable';
    selectedMetadata.appendChild(attribution);
    archiveCreditText = attribution.textContent;
    archiveCredit.textContent = `Imagery credit: ${archiveCreditText}`;
    archiveCredit.hidden = false;
  };
  const applyHistoricalOption = (option, selectedButton = 'historical') => {
    if (!option?.urlTemplate || !map) return;
    if (distanceMeters(lookupOrigin, centerOfMap()) >= 100) {
      detachLookup();
      currentOptions = [];
      details.replaceChildren();
      status.textContent = 'Map moved to a different area. Search again for this property.';
      return;
    }
    setAlternateImageryBase(map);
    map.overlayMapTypes.clear();
    selectSourceButton(selectedButton);
    renderOptionDetails(option);
    status.textContent = `${option.label || option.source || 'Historical imagery'} selected; checking tile availability…`;
    const qualityHandler = nextQualityHandler();
    map.overlayMapTypes.push(makeEsriOverzoomOverlay({
      urlTemplate: option.urlTemplate,
      preferMax: 20,
      floor: 18,
      name: option.label || option.source || 'Historical imagery',
      onQuality: qualityHandler,
    }));
    onChange?.(option.source);
  };
  const historicalButtonClick = async (preferWinter = false) => {
    if (!map) return;
    detachLookup();
    const id = ++requestId;
    qualityVersion += 1;
    const center = centerOfMap();
    if (!center || !Number.isFinite(center.lat) || !Number.isFinite(center.lng)) {
      status.textContent = 'Move the map to a property before searching historical imagery.';
      return;
    }
    lookupOrigin = center;
    lookupController = new AbortController();
    currentOptions = [];
    selectSourceButton(preferWinter ? 'leaf_off' : 'historical');
    if (preferWinter) {
      setAlternateImageryBase(map);
      map.overlayMapTypes.clear();
    }
    details.replaceChildren();
    const loading = document.createElement('div');
    loading.className = 'cs-imagery-meta';
    loading.textContent = preferWinter
      ? 'Finding a dated winter capture for this property…'
      : 'Searching archives for imagery near this property…';
    details.appendChild(loading);
    status.textContent = 'Historical imagery lookup in progress.';
    if (window.google?.maps?.event && typeof map.addListener === 'function') {
      lookupMapListener = map.addListener('idle', () => {
        if (distanceMeters(lookupOrigin, centerOfMap()) >= 100) {
          requestId += 1;
          qualityVersion += 1;
          detachLookup();
          currentOptions = [];
          details.replaceChildren();
          selectedMetadata = null;
          status.textContent = 'Map moved to a different area. Select Historical to search this property.';
        }
      });
    }
    try {
      const result = await listPropertyImagery({
        lat: center.lat,
        lng: center.lng,
        signal: lookupController.signal,
      });
      if (id !== requestId || lookupController?.signal.aborted) return;
      lookupController = null;
      currentOptions = Array.isArray(result?.options) ? result.options : [];
      details.replaceChildren();
      selectedMetadata = null;
      (Array.isArray(result?.warnings) ? result.warnings : []).forEach((warning) => {
        const warningEl = document.createElement('div');
        warningEl.className = 'cs-imagery-warning';
        warningEl.textContent = warning;
        details.appendChild(warningEl);
      });
      if (!currentOptions.length) {
        const empty = document.createElement('div');
        empty.className = 'cs-imagery-meta';
        empty.textContent = 'No historical imagery options were found for this location.';
        details.appendChild(empty);
        status.textContent = result?.partial
          ? 'Archive search was partial; no options are currently available.'
          : 'No historical imagery is available here.';
        return;
      }
      const select = document.createElement('select');
      select.className = 'cs-imagery-select';
      select.setAttribute('aria-label', 'Historical imagery captures');
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'Choose an archive capture…';
      select.appendChild(placeholder);
      currentOptions.forEach((option, index) => {
        const item = document.createElement('option');
        item.value = String(index);
        const archiveDate = ` · archive ${dateText(option.releaseDate)}`;
        item.textContent = `${option.label || option.source || 'Aerial survey'} · capture ${dateText(option.captureDate)}${archiveDate}`;
        select.appendChild(item);
      });
      select.addEventListener('change', () => {
        if (select.value === '') return;
        const option = currentOptions[Number(select.value)];
        if (option) applyHistoricalOption(option);
      });
      details.appendChild(select);
      if (result?.partial) {
        const partial = document.createElement('div');
        partial.className = 'cs-imagery-meta';
        partial.textContent = 'Some archive providers could not be checked.';
        details.appendChild(partial);
      }
      status.textContent = `${currentOptions.length} property-specific archive ${currentOptions.length === 1 ? 'capture' : 'captures'} found.`;
      if (preferWinter) {
        const winter = chooseWinterCapture(currentOptions);
        if (winter) {
          select.value = String(currentOptions.indexOf(winter));
          applyHistoricalOption(winter, 'leaf_off');
        } else {
          status.textContent = 'No dated winter capture found here. Choose a historical image from the list, or Default to restore Google.';
        }
      }
    } catch (error) {
      if (id !== requestId || error?.name === 'AbortError') return;
      detachLookup();
      details.replaceChildren();
      status.textContent = 'Historical imagery could not be loaded. Try again when the map is centered on the property.';
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'cs-imagery-btn';
      retry.textContent = 'Retry search';
      retry.addEventListener('click', () => historicalButtonClick(preferWinter));
      details.appendChild(retry);
    }
  };

  IMAGERY_SOURCES.forEach((src) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = src.label;
    btn.className = 'cs-imagery-btn';
    btn.dataset.imagerySource = src.key;
    btn.setAttribute('aria-pressed', String(src.key === 'google'));
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (lookupController) {
        lookupController.abort();
        lookupController = null;
        details.replaceChildren();
        selectedMetadata = null;
      }
      requestId += 1;
      selectSourceButton(src.key);
      if (archiveCreditText) {
        archiveCredit.textContent = `Historical source credit (last selected): ${archiveCreditText}`;
      }
      const qualityHandler = nextQualityHandler();
      applyImagerySource(map, src.key, getWaybackIds?.(), qualityHandler);
      onChange?.(src.key);
    });
    buttons.push(btn);
    buttonRow.appendChild(btn);
  });
  const leafOffButton = document.createElement('button');
  leafOffButton.type = 'button';
  leafOffButton.textContent = 'Leaf-off';
  leafOffButton.title = 'Automatically select a dated winter capture; bare-tree coverage varies';
  leafOffButton.className = 'cs-imagery-btn';
  leafOffButton.dataset.imagerySource = 'leaf_off';
  leafOffButton.setAttribute('aria-pressed', 'false');
  leafOffButton.addEventListener('click', event => {
    event.stopPropagation();
    historicalButtonClick(true);
  });
  buttons.push(leafOffButton);
  buttonRow.appendChild(leafOffButton);
  const historicalButton = document.createElement('button');
  historicalButton.type = 'button';
  historicalButton.textContent = 'Historical';
  historicalButton.className = 'cs-imagery-btn';
  historicalButton.dataset.imagerySource = 'historical';
  historicalButton.setAttribute('aria-pressed', 'false');
  historicalButton.addEventListener('click', (event) => {
    event.stopPropagation();
    historicalButtonClick();
  });
  buttons.push(historicalButton);
  buttonRow.appendChild(historicalButton);
  panel.appendChild(buttonRow);

  if (hint) {
    const hintEl = document.createElement('div');
    hintEl.textContent = hint;
    hintEl.className = 'cs-imagery-meta';
    panel.appendChild(hintEl);
  }
  panel.appendChild(status);
  const limitation = document.createElement('div');
  limitation.className = 'cs-imagery-note';
  limitation.textContent = 'Historical images are not guaranteed snow-free or tree-free; Solar roof measurements do not change.';
  panel.appendChild(limitation);
  archiveCredit.hidden = true;
  panel.appendChild(archiveCredit);
  panel.appendChild(details);
  return panel;
}

/**
 * Build the tilt-angle row (0/30/45/60/67) as a Google Maps custom control.
 *
 * Only meaningful on a vector map (one created with a `mapId`) — the raster
 * renderer supports 0° and 45° only. Callers gate on that themselves.
 *
 * Registers a tilt_changed listener that keeps the active highlight in sync
 * when tilt changes by drag or by another control.
 *
 * @param {object}   opts.map      the google.maps.Map instance
 * @param {function} [opts.onTiltChange] called with the chosen tilt
 * @returns {HTMLElement}
 */
export function createTiltControl({ map, onTiltChange }) {
  const panel = document.createElement('div');
  panel.style.cssText = 'margin:0 0 6px 0;display:flex;gap:3px;align-items:center;justify-content:center;';
  shieldFromMap(panel);

  const label = document.createElement('span');
  label.textContent = 'Tilt:';
  label.style.cssText = 'font-size:10px;font-weight:700;color:#374151;margin-right:2px;';
  panel.appendChild(label);

  const syncHighlight = (current) => {
    Array.from(panel.children).forEach((child) => {
      if (child.tagName !== 'BUTTON') return;
      const ang = TILT_ANGLES.find((a) => String(a.label) === child.textContent);
      child.style.background = ang && Math.abs(ang.tilt - current) < 5 ? '#1d4ed8' : '#6b7280';
    });
  };

  TILT_ANGLES.forEach((a) => {
    const btn = document.createElement('button');
    btn.textContent = a.label;
    btn.title = a.title;
    btn.dataset.tilt = String(a.tilt);
    btn.style.cssText =
      'padding:0 7px;height:30px;border:none;border-radius:4px;font-size:11px;font-weight:700;' +
      `cursor:pointer;background:${a.tilt === 0 ? '#111827' : '#6b7280'};color:#fff;` +
      'box-shadow:0 2px 4px rgba(0,0,0,0.3);';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      map.setTilt(a.tilt);
      syncHighlight(a.tilt);
      btn.style.background = '#1d4ed8';
      onTiltChange?.(a.tilt);
    });
    panel.appendChild(btn);
  });

  map.addListener('tilt_changed', () => syncHighlight(Math.round(map.getTilt() || 0)));

  return panel;
}
