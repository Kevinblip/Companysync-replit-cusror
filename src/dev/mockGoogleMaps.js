/**
 * Minimal Google Maps double for the manual roof trace.
 * The visual mode draws Esri imagery and the polygons the real component creates,
 * so a browser can exercise the same drawing manager the estimator uses.
 */

function mercatorPoint(lat, lng) {
  const x = ((lng + 180) / 360) * 256;
  const clamped = Math.max(-85, Math.min(85, lat));
  const sin = Math.sin((clamped * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * 256;
  return { x, y };
}

function readLatLng(ll) {
  if (!ll) return null;
  const lat = typeof ll.lat === 'function' ? ll.lat() : ll.lat;
  const lng = typeof ll.lng === 'function' ? ll.lng() : ll.lng;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function pointToLatLng(x, y, LatLng) {
  const lng = (x / 256) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / 256;
  const lat = (180 / Math.PI) * Math.atan(Math.sinh(n));
  return new LatLng(lat, lng);
}

function haversineMeters(a, b) {
  const R = 6371000;
  const dLat = ((b.lat() - a.lat()) * Math.PI) / 180;
  const dLng = ((b.lng() - a.lng()) * Math.PI) / 180;
  const lat1 = (a.lat() * Math.PI) / 180;
  const lat2 = (b.lat() * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function installMockGoogleMaps(options = {}) {
  const listenersOf = (target) => {
    if (!target.__listeners) target.__listeners = {};
    return target.__listeners;
  };
  const addTargetListener = (target, name, fn) => {
    const bag = listenersOf(target);
    bag[name] = bag[name] || [];
    bag[name].push(fn);
    return { remove: () => { bag[name] = (bag[name] || []).filter((f) => f !== fn); } };
  };

  class LatLng {
    constructor(lat, lng) {
      this._lat = lat;
      this._lng = lng;
    }
    lat() { return this._lat; }
    lng() { return this._lng; }
  }
  class Point {
    constructor(x, y) { this.x = x; this.y = y; }
  }
  class Size {
    constructor(width, height) { this.width = width; this.height = height; }
  }
  class InfoWindow {
    constructor() {}
    open() {}
    close() {}
  }
  class Geocoder {
    geocode(_req, cb) { cb?.([], 'ZERO_RESULTS'); }
  }
  class MVCArray {
    constructor(items = []) { this._arr = [...items]; }
    getLength() { return this._arr.length; }
    getAt(i) { return this._arr[i]; }
    setAt(i, value) { this._arr[i] = value; scheduleDraw(); }
    insertAt(i, value) { this._arr.splice(i, 0, value); scheduleDraw(); }
  }

  const shapes = { polygons: [], polylines: [], markers: [] };
  let mapInstance = null;
  let drawScheduled = false;

  function scheduleDraw() {
    if (!options.visual || !mapInstance || drawScheduled) return;
    drawScheduled = true;
    requestAnimationFrame(() => {
      drawScheduled = false;
      mapInstance.draw();
    });
  }

  class Marker {
    constructor(opts = {}) {
      this._position = opts.position || null;
      this._map = opts.map || null;
      this._title = opts.title || '';
      this._icon = opts.icon || null;
      this._clickable = opts.clickable !== false;
      shapes.markers.push(this);
      scheduleDraw();
    }
    setMap(map) { this._map = map; scheduleDraw(); }
    getMap() { return this._map; }
    setPosition(position) { this._position = position; scheduleDraw(); }
    getPosition() { return this._position; }
    setOptions() {}
    addListener(name, fn) { return addTargetListener(this, name, fn); }
  }

  class Polygon {
    constructor(opts = {}) {
      this._opts = opts;
      this._path = new MVCArray(opts.paths || opts.path || []);
      this._map = opts.map || null;
      shapes.polygons.push(this);
      scheduleDraw();
    }
    getPath() { return this._path; }
    setPath(path) { this._path = new MVCArray(path); scheduleDraw(); }
    setOptions(opts) { Object.assign(this._opts, opts || {}); scheduleDraw(); }
    setMap(map) { this._map = map; scheduleDraw(); }
    getMap() { return this._map; }
  }

  class Polyline {
    constructor(opts = {}) {
      this._opts = opts;
      this._path = new MVCArray(opts.path || []);
      this._map = opts.map || null;
      shapes.polylines.push(this);
      scheduleDraw();
    }
    getPath() { return this._path; }
    setPath(path) { this._path = new MVCArray(path); scheduleDraw(); }
    setOptions(opts) { Object.assign(this._opts, opts || {}); scheduleDraw(); }
    setMap(map) { this._map = map; scheduleDraw(); }
    getMap() { return this._map; }
  }

  class Map {
    constructor(el, opts = {}) {
      this._el = el;
      this._zoom = (options.visual && options.zoom) || opts.zoom || options.zoom || 20;
      this._center = opts.center || options.center || { lat: 0, lng: 0 };
      this._listeners = {};
      this._disableDoubleClickZoom = false;
      this._mapOptions = {};
      this.controls = new Proxy({}, { get: (t, key) => (t[key] || (t[key] = [])) });
      mapInstance = this;
      window.__roofMap = this;
      if (options.visual && el) this._mountVisual();
    }
    _mountVisual() {
      const el = this._el;
      el.style.position = 'relative';
      el.innerHTML = '';
      const canvas = document.createElement('canvas');
      canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;touch-action:none;';
      el.appendChild(canvas);
      this._canvas = canvas;
      const resize = () => {
        const w = Math.max(320, Math.round(el.clientWidth || 800));
        const h = Math.max(280, Math.round(el.clientHeight || 480));
        canvas.width = w;
        canvas.height = h;
        this.draw();
      };
      this._resize = resize;
      requestAnimationFrame(resize);
      window.addEventListener('resize', resize);
      this._loadImagery();
      const forward = (domEvent, mapEvent) => {
        canvas.addEventListener(domEvent, (e) => {
          if (mapEvent !== 'mousemove') e.preventDefault();
          const rect = canvas.getBoundingClientRect();
          const latLng = this.containerPixelToLatLng(e.clientX - rect.left, e.clientY - rect.top);
          const evt = { latLng, stop() { e.stopPropagation(); e.preventDefault(); } };
          (this._listeners[mapEvent] || []).forEach((fn) => fn(evt));
        });
      };
      forward('click', 'click');
      forward('dblclick', 'dblclick');
      forward('mousemove', 'mousemove');
    }
    async _loadImagery() {
      const zoom = 19;
      const center = this._center;
      const world = mercatorPoint(center.lat, center.lng);
      const scale = 2 ** zoom;
      const tx = Math.floor((world.x * scale) / 256);
      const ty = Math.floor((world.y * scale) / 256);
      const tileCanvas = document.createElement('canvas');
      tileCanvas.width = 256 * 3;
      tileCanvas.height = 256 * 3;
      const ctx = tileCanvas.getContext('2d');
      await Promise.all([-1, 0, 1].flatMap((dy) => [-1, 0, 1].map(async (dx) => {
        try {
          const url = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${ty + dy}/${tx + dx}`;
          const img = await loadImage(url);
          ctx.drawImage(img, (dx + 1) * 256, (dy + 1) * 256);
        } catch { /* imagery is optional for the trace itself */ }
      })));
      this._imagery = { canvas: tileCanvas, tx, ty, zoom };
      this.draw();
    }
    _viewSize() {
      const canvas = this._canvas;
      const rect = canvas?.getBoundingClientRect?.();
      return {
        w: rect?.width || canvas?.clientWidth || this._el?.clientWidth || 800,
        h: rect?.height || canvas?.clientHeight || this._el?.clientHeight || 480,
      };
    }
    containerPixelToLatLng(px, py) {
      const { w, h } = this._viewSize();
      const scale = 2 ** this._zoom;
      const center = mercatorPoint(this._center.lat, this._center.lng);
      const worldX = center.x * scale + (px - w / 2);
      const worldY = center.y * scale + (py - h / 2);
      return pointToLatLng(worldX / scale, worldY / scale, LatLng);
    }
    latLngToContainerPixel(latLng) {
      const coords = readLatLng(latLng);
      if (!coords) return { x: 0, y: 0 };
      const { w, h } = this._viewSize();
      const scale = 2 ** this._zoom;
      const center = mercatorPoint(this._center.lat, this._center.lng);
      const point = mercatorPoint(coords.lat, coords.lng);
      return {
        x: w / 2 + (point.x - center.x) * scale,
        y: h / 2 + (point.y - center.y) * scale,
      };
    }
    draw() {
      const canvas = this._canvas;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      const w = canvas.width;
      const h = canvas.height;
      ctx.fillStyle = '#1f2937';
      ctx.fillRect(0, 0, w, h);
      if (this._imagery) {
        const { canvas: tiles, tx, ty, zoom } = this._imagery;
        const scale = 2 ** this._zoom;
        const tileScale = 2 ** zoom;
        const center = mercatorPoint(this._center.lat, this._center.lng);
        const originX = (tx - 1) * 256;
        const originY = (ty - 1) * 256;
        const centerPx = { x: center.x * tileScale, y: center.y * tileScale };
        const factor = scale / tileScale;
        const dx = w / 2 - (centerPx.x - originX) * factor;
        const dy = h / 2 - (centerPx.y - originY) * factor;
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(tiles, dx, dy, tiles.width * factor, tiles.height * factor);
      }
      const strokeOf = (shape, fallback) => shape._opts?.strokeColor || fallback;
      shapes.polygons.forEach((poly) => {
        if (poly._map == null) return;
        const path = poly.getPath();
        if (!path.getLength()) return;
        ctx.beginPath();
        for (let i = 0; i < path.getLength(); i++) {
          const p = this.latLngToContainerPixel(path.getAt(i));
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        }
        ctx.closePath();
        ctx.fillStyle = shapeFill(strokeOf(poly, '#3b82f6'));
        ctx.strokeStyle = strokeOf(poly, '#1d4ed8');
        ctx.lineWidth = 3;
        ctx.fill();
        ctx.stroke();
      });
      shapes.polylines.forEach((line) => {
        if (line._map == null) return;
        const path = line.getPath();
        if (path.getLength() < 2) return;
        ctx.beginPath();
        for (let i = 0; i < path.getLength(); i++) {
          const p = this.latLngToContainerPixel(path.getAt(i));
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        }
        ctx.strokeStyle = strokeOf(line, '#334155');
        ctx.lineWidth = line._opts?.strokeWeight || 4;
        ctx.stroke();
      });
      shapes.markers.forEach((marker) => {
        if (marker._map == null || !marker._position) return;
        const p = this.latLngToContainerPixel(marker._position);
        const scale = marker._icon?.scale || 5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(4, scale), 0, Math.PI * 2);
        ctx.fillStyle = marker._icon?.fillColor || '#fff';
        ctx.globalAlpha = marker._icon?.fillOpacity ?? 1;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.lineWidth = marker._icon?.strokeWeight || 2;
        ctx.strokeStyle = marker._icon?.strokeColor || '#111';
        ctx.stroke();
      });
    }
    setTilt() {}
    setHeading() {}
    getTilt() { return 0; }
    getHeading() { return 0; }
    setMapTypeId() {}
    getMapTypeId() { return 'satellite'; }
    getZoom() { return this._zoom; }
    get(key) { return this._mapOptions[key]; }
    setOptions(opts = {}) {
      Object.assign(this._mapOptions, opts);
      if (opts.disableDoubleClickZoom != null) this._disableDoubleClickZoom = !!opts.disableDoubleClickZoom;
    }
    setZoom(zoom) {
      const next = Number(zoom);
      if (!Number.isFinite(next)) return;
      this._zoom = next;
      this.draw();
    }
    getBounds() { return null; }
    panTo() {}
    getStreetView() {
      return { getVisible: () => false, setVisible() {}, setPosition() {}, setPov() {} };
    }
    getProjection() {
      return {
        fromLatLngToPoint: (ll) => new Point(...Object.values(mercatorPoint(ll.lat(), ll.lng()))),
        fromPointToLatLng: (pt) => pointToLatLng(pt.x, pt.y, LatLng),
      };
    }
    addListener(name, fn) {
      this._listeners[name] = this._listeners[name] || [];
      this._listeners[name].push(fn);
      return {
        remove: () => {
          this._listeners[name] = (this._listeners[name] || []).filter((f) => f !== fn);
        },
      };
    }
  }

  const event = {
    addListener(target, name, fn) {
      if (target?.addListener) return target.addListener(name, fn);
      return { remove() {} };
    },
    addListenerOnce(target, name, fn) {
      const sub = event.addListener(target, name, (...args) => {
        sub.remove();
        fn(...args);
      });
      return sub;
    },
    removeListener(sub) { sub?.remove?.(); },
  };

  class StreetViewService {
    getPanorama(_req, cb) { cb?.(null, 'ZERO_RESULTS'); }
  }

  window.google = {
    maps: {
      Map,
      Marker,
      Polygon,
      Polyline,
      LatLng,
      Point,
      Size,
      InfoWindow,
      Geocoder,
      event,
      SymbolPath: { CIRCLE: 0 },
      ControlPosition: { RIGHT_CENTER: 1, BOTTOM_CENTER: 2, TOP_RIGHT: 3, TOP_LEFT: 4 },
      MapTypeControlStyle: { HORIZONTAL_BAR: 1 },
      StreetViewService,
      StreetViewStatus: { OK: 'OK' },
      StreetViewSource: { OUTDOOR: 'OUTDOOR' },
      geometry: {
        spherical: {
          computeDistanceBetween: haversineMeters,
          computeLength(path) {
            let total = 0;
            for (let i = 1; i < path.getLength(); i++) total += haversineMeters(path.getAt(i - 1), path.getAt(i));
            return total;
          },
          computeArea(path) {
            // Planar shoelace in meters, accurate enough for the footprint label.
            const origin = path.getAt(0);
            if (!origin) return 0;
            const pts = [];
            for (let i = 0; i < path.getLength(); i++) {
              const p = path.getAt(i);
              pts.push({
                x: haversineMeters(origin, new LatLng(origin.lat(), p.lng())) * Math.sign(p.lng() - origin.lng() || 1),
                y: haversineMeters(origin, new LatLng(p.lat(), origin.lng())) * Math.sign(p.lat() - origin.lat() || 1),
              });
            }
            let area = 0;
            for (let i = 0; i < pts.length; i++) {
              const q = pts[(i + 1) % pts.length];
              area += pts[i].x * q.y - q.x * pts[i].y;
            }
            return Math.abs(area / 2);
          },
        },
      },
    },
  };

  window.__roofMapShapes = shapes;
  return {
    LatLng,
    getMap: () => mapInstance,
    fireMapClick(lat, lng) {
      const latLng = new LatLng(lat, lng);
      (mapInstance?._listeners?.click || []).forEach((fn) => fn({ latLng, stop() {} }));
    },
    fireMapDblClick(lat, lng) {
      const latLng = new LatLng(lat, lng);
      if (mapInstance && !mapInstance._disableDoubleClickZoom) mapInstance._zoom += 1;
      (mapInstance?._listeners?.dblclick || []).forEach((fn) => fn({ latLng, stop() {} }));
    },
    shapes,
  };
}

function shapeFill(color) {
  return `${color}55`;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}
