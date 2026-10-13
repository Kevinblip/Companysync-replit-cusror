/**
 * photoTextures.js — photo-texture mode for the 3D house viewer.
 *
 * Illustrative layer ONLY: wraps real facade photos onto wall meshes whose
 * outward-normal azimuth matches the photo's face. Measurement math never
 * reads this. A wall with no matching photo keeps its procedural siding.
 *
 * Extracted from HouseModel3D.jsx so the texture lifecycle (including the
 * stale-callback race) is unit-testable in plain Node.
 */
import * as THREE from 'three';

function azDiffDeg(a, b) {
  const d = Math.abs(((a - b) % 360 + 360) % 360);
  return d > 180 ? 360 - d : d;
}

/**
 * @param wallMeshes  [{ mesh, az, lenFt, upperH, uvNormalized, flipU }]
 * @param photoAzs    [{ url, az }]  (face already converted to azimuth by caller)
 * @param loader      THREE.TextureLoader (or compatible mock)
 * @param isCurrent   () => boolean — must check scene IDENTITY (not just
 *                    truthiness) so a callback that resolves after the effect
 *                    was torn down/rebuilt cannot mutate a detached mesh.
 * @param toDispose   effect-scoped disposal list
 * @returns number of texture loads started
 */
export function applyPhotoTextures(wallMeshes, photoAzs, { loader, isCurrent, toDispose, onSettled }) {
  if (!loader || !(photoAzs || []).length) return 0;
  let started = 0;
  for (const w of wallMeshes || []) {
    let best = null, bestD = 46; // face azimuth must match within 45°
    for (const p of photoAzs) {
      const d = azDiffDeg(p.az, w.az);
      if (d < bestD) { bestD = d; best = p; }
    }
    if (!best?.url) continue;
    started++;
    loader.load(best.url, (tex) => {
      if (!isCurrent || !isCurrent()) {
        try { tex.dispose(); } catch { /* noop */ }
        onSettled?.();
        return;
      }
      tex.colorSpace = THREE.SRGBColorSpace;
      if (!w.uvNormalized) {
        // Polygon-wall UVs are raw (u,v) feet — normalize to 0..1, flipping
        // horizontally when the edge runs right-to-left viewed from outside.
        if (w.flipU) { tex.wrapS = THREE.RepeatWrapping; tex.repeat.set(-1 / w.lenFt, 1 / w.upperH); tex.offset.x = 1; }
        else { tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.repeat.set(1 / w.lenFt, 1 / w.upperH); }
      }
      const old = w.mesh.material;
      const pm = old.clone(); pm.map = tex; pm.color?.set?.(0xffffff);
      // The procedural siding doubles as a bump map; a real facade photo brings
      // its own shading, so keep the lap relief from embossing the photograph.
      pm.bumpMap = null;
      pm.needsUpdate = true;
      w.mesh.material = pm;
      // The replaced siding material/texture are uniquely owned by this wall
      // mesh — free GPU memory now rather than at next rebuild.
      try { old.map?.dispose?.(); } catch { /* noop */ }
      try { old.dispose?.(); } catch { /* noop */ }
      toDispose?.push(tex, pm);
      onSettled?.();
    }, undefined, () => {
      // Photo failed to load (CORS/404) — keep siding texture, but unblock a
      // pending presentation capture rather than waiting forever.
      onSettled?.();
    });
  }
  return started;
}
