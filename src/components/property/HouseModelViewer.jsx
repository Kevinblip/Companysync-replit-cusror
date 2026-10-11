import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { materialColor } from '@/lib/houseGeometry';

function makeShingleTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#2c2c30';
  ctx.fillRect(0, 0, 256, 256);
  for (let row = 0; row < 16; row++) {
    const y = row * 16;
    const offset = row % 2 ? 16 : 0;
    for (let col = -1; col < 10; col++) {
      const x = col * 32 + offset;
      const shade = 38 + ((row * 7 + col * 13) % 18);
      ctx.fillStyle = `rgb(${shade},${shade},${shade + 4})`;
      ctx.fillRect(x + 1, y + 1, 30, 14);
      ctx.strokeStyle = '#1a1a1c';
      ctx.strokeRect(x + 1, y + 1, 30, 14);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 4);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function triangulate(vertices) {
  if (!vertices || vertices.length < 3) return { positions: [], uvs: [] };
  const pts = vertices.map(v => new THREE.Vector3(v.x, v.z, -v.y));
  const positions = [];
  const uvIndex = [];
  for (let i = 1; i < pts.length - 1; i++) {
    positions.push(pts[0], pts[i], pts[i + 1]);
    uvIndex.push(0, i, i + 1);
  }
  return { positions, uvIndex };
}

function faceUVs(face, triIndices) {
  const verts = face.vertices || [];
  const uvRect = face.uv || { u0: 0, v0: 0, u1: 1, v1: 1 };
  const box = {
    minX: Math.min(...verts.map(v => v.x)),
    maxX: Math.max(...verts.map(v => v.x)),
    minY: Math.min(...verts.map(v => v.y)),
    maxY: Math.max(...verts.map(v => v.y)),
    minZ: Math.min(...verts.map(v => v.z)),
    maxZ: Math.max(...verts.map(v => v.z)),
  };
  const n = {
    x: Math.abs(box.maxX - box.minX),
    y: Math.abs(box.maxY - box.minY),
  };
  const useY = n.y >= n.x;
  const width = useY ? (box.maxY - box.minY) : (box.maxX - box.minX);
  const height = box.maxZ - box.minZ || 1;
  const out = [];
  for (const idx of triIndices) {
    const v = verts[idx];
    const uLin = useY ? (v.y - box.minY) / (width || 1) : (v.x - box.minX) / (width || 1);
    const vLin = (v.z - box.minZ) / height;
    const u = uvRect.u0 + uLin * (uvRect.u1 - uvRect.u0);
    const vv = uvRect.v0 + vLin * (uvRect.v1 - uvRect.v0);
    out.push(u, vv);
  }
  return out;
}

function buildMesh(face, highlighted, texture, roofTexture) {
  const tri = triangulate(face.vertices);
  if (!tri.positions?.length) return null;
  const geom = new THREE.BufferGeometry();
  const arr = new Float32Array(tri.positions.length * 3);
  tri.positions.forEach((v, i) => {
    arr[i * 3] = v.x;
    arr[i * 3 + 1] = v.y;
    arr[i * 3 + 2] = v.z;
  });
  geom.setAttribute('position', new THREE.BufferAttribute(arr, 3));

  const uvArr = new Float32Array(faceUVs(face, tri.uvIndex));
  geom.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));
  geom.computeVertexNormals();

  const isRoof = String(face.type || '').toUpperCase().includes('ROOF');
  const map = isRoof ? roofTexture : texture;
  const color = map ? 0xffffff : materialColor(face.material);
  const mat = new THREE.MeshStandardMaterial({
    color,
    map: map || null,
    roughness: isRoof ? 0.92 : 0.72,
    metalness: 0,
    side: THREE.DoubleSide,
    emissive: highlighted ? 0x224466 : 0x000000,
    emissiveIntensity: highlighted ? 0.22 : 0,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.userData.faceId = face.id;
  mesh.userData.material = face.material;
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geom),
    new THREE.LineBasicMaterial({ color: 0x1f1f1f, transparent: true, opacity: 0.28 }),
  );
  mesh.add(edges);
  return mesh;
}

function fitCamera(camera, controls, root) {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(size.x, size.y, size.z, 10);
  camera.near = 0.1;
  camera.far = radius * 40;
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  camera.position.set(center.x + radius * 1.2, center.y + radius * 0.7, center.z + radius * 1.4);
  controls.update();
}

function loadTexture(url, loader) {
  return new Promise(resolve => {
    if (!url) {
      resolve(null);
      return;
    }
    loader.load(
      url,
      tex => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 8;
        resolve(tex);
      },
      undefined,
      () => resolve(null),
    );
  });
}

export default function HouseModelViewer({
  model,
  selectedMaterial,
  selectedFacade,
  onSelectMaterial,
  onSelectFacade,
}) {
  const mountRef = useRef(null);
  const threeRef = useRef({});
  const [ready, setReady] = useState(false);
  const texturesRef = useRef({ byUrl: {}, roof: null });

  const highlightIds = useMemo(() => {
    if (!model?.faces) return new Set();
    if (selectedMaterial) {
      return new Set(model.faces.filter(f => f.material === selectedMaterial).map(f => f.id));
    }
    if (selectedFacade) {
      const facade = model.facades?.find(f => f.id === selectedFacade);
      return new Set(
        model.faces
          .filter(f => f.compass === selectedFacade || f.id === facade?.faceId)
          .map(f => f.id),
      );
    }
    return new Set();
  }, [model, selectedMaterial, selectedFacade]);

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return undefined;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf3f4f6);
    const camera = new THREE.PerspectiveCamera(45, el.clientWidth / Math.max(el.clientHeight, 1), 0.1, 2000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(el.clientWidth, el.clientHeight);
    el.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.72));
    const sun = new THREE.DirectionalLight(0xffffff, 0.9);
    sun.position.set(40, 80, 30);
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0xcfe8ff, 0.38);
    fill.position.set(-30, 20, -40);
    scene.add(fill);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400),
      new THREE.MeshStandardMaterial({ color: 0xe8edf2, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    scene.add(ground);

    const house = new THREE.Group();
    house.name = 'house';
    scene.add(house);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI / 2.05;

    const loader = new THREE.TextureLoader();
    loader.crossOrigin = 'anonymous';

    texturesRef.current.roof = makeShingleTexture();

    let raf;
    const tick = () => {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    tick();

    const onResize = () => {
      if (!el.clientWidth) return;
      camera.aspect = el.clientWidth / Math.max(el.clientHeight, 1);
      camera.updateProjectionMatrix();
      renderer.setSize(el.clientWidth, el.clientHeight);
    };
    window.addEventListener('resize', onResize);

    threeRef.current = { scene, camera, renderer, controls, house, loader };
    setReady(true);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      controls.dispose();
      renderer.dispose();
      texturesRef.current.roof?.dispose();
      Object.values(texturesRef.current.byUrl).forEach(t => t?.dispose?.());
      texturesRef.current.byUrl = {};
      if (renderer.domElement.parentNode === el) el.removeChild(renderer.domElement);
      threeRef.current = {};
    };
  }, []);

  useEffect(() => {
    const { house, camera, controls, loader } = threeRef.current;
    if (!house || !model?.faces || !ready) return undefined;
    let cancelled = false;

    const rebuild = async () => {
      const urls = [...new Set(model.faces.map(f => f.photoUrl).filter(Boolean))];
      await Promise.all(urls.map(async url => {
        if (!texturesRef.current.byUrl[url]) {
          texturesRef.current.byUrl[url] = await loadTexture(url, loader);
        }
      }));
      if (cancelled) return;

      while (house.children.length) {
        const child = house.children[0];
        child.traverse(obj => {
          if (obj.geometry) obj.geometry.dispose();
          if (obj.material) {
            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            mats.forEach(m => {
              if (m.map && m.map.userData?.owned) m.map.dispose?.();
              m.dispose?.();
            });
          }
        });
        house.remove(child);
      }

      for (const face of model.faces) {
        if (String(face.type || '').includes('PENETRATION')) continue;
        const tex = face.photoUrl ? texturesRef.current.byUrl[face.photoUrl] : null;
        const mesh = buildMesh(face, highlightIds.has(face.id), tex, texturesRef.current.roof);
        if (mesh) house.add(mesh);
      }

      fitCamera(camera, controls, house);
    };

    rebuild();
    return () => { cancelled = true; };
  }, [model, highlightIds, ready]);

  useEffect(() => {
    const { camera, controls, house } = threeRef.current;
    if (!camera || !controls || !house) return;
    const box = new THREE.Box3().setFromObject(house);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const r = Math.max(size.x, size.y, size.z, 10);

    if (selectedFacade === 'customer' || !selectedFacade) {
      camera.position.set(center.x + r * 1.2, center.y + r * 0.7, center.z + r * 1.4);
    } else if (selectedFacade === 'N') {
      camera.position.set(center.x, center.y + r * 0.35, center.z - r * 1.8);
    } else if (selectedFacade === 'S') {
      camera.position.set(center.x, center.y + r * 0.35, center.z + r * 1.8);
    } else if (selectedFacade === 'E') {
      camera.position.set(center.x + r * 1.8, center.y + r * 0.35, center.z);
    } else if (selectedFacade === 'W') {
      camera.position.set(center.x - r * 1.8, center.y + r * 0.35, center.z);
    }
    controls.target.copy(center);
    controls.update();
  }, [selectedFacade, ready, model]);

  const texturedCount = (model?.faces || []).filter(f => f.type === 'WALL' && f.photoUrl).length;

  return (
    <div className="relative rounded-xl overflow-hidden border bg-gray-100" style={{ height: 420 }}>
      <div ref={mountRef} className="absolute inset-0" data-testid="house-3d-canvas" />
      <div className="absolute top-3 left-3 flex flex-wrap gap-2 z-10 max-w-[90%]">
        <button
          type="button"
          onClick={() => onSelectFacade?.('customer')}
          className={`text-xs px-2.5 py-1 rounded-full border ${selectedFacade === 'customer' || !selectedFacade ? 'bg-emerald-600 text-white border-emerald-700' : 'bg-white/90'}`}
          data-testid="chip-customer-view"
        >
          🏠 Customer view
        </button>
        {(model?.materials || []).filter(m => m.id !== 'roof' && m.id !== 'opening').map(m => (
          <button
            key={m.id}
            type="button"
            onClick={() => onSelectMaterial?.(selectedMaterial === m.id ? null : m.id)}
            className={`text-xs px-2.5 py-1 rounded-full border ${selectedMaterial === m.id ? 'bg-slate-700 text-white' : 'bg-white/90'}`}
            data-testid={`chip-material-${m.id}`}
          >
            {m.label}
          </button>
        ))}
        {(model?.facades || []).map(f => (
          <button
            key={f.id}
            type="button"
            onClick={() => onSelectFacade?.(selectedFacade === f.id ? 'customer' : f.id)}
            className={`text-xs px-2.5 py-1 rounded-full border ${selectedFacade === f.id ? 'bg-blue-600 text-white border-blue-700' : 'bg-white/90'}`}
            data-testid={`chip-facade-${f.id}`}
          >
            {f.label}
          </button>
        ))}
      </div>
      <p className="absolute bottom-2 right-3 text-[10px] text-gray-400 pointer-events-none">
        {texturedCount ? `${texturedCount} facade photo${texturedCount === 1 ? '' : 's'} on walls` : 'Drag · scroll to zoom'}
      </p>
    </div>
  );
}
