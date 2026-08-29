import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { materialColor } from '@/lib/houseGeometry';

function triangulate(vertices) {
  if (!vertices || vertices.length < 3) return { positions: [] };
  const pts = vertices.map(v => new THREE.Vector3(v.x, v.z, -v.y));
  const out = [];
  for (let i = 1; i < pts.length - 1; i++) {
    out.push(pts[0], pts[i], pts[i + 1]);
  }
  return { positions: out };
}

function buildMesh(face, highlighted) {
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
  geom.computeVertexNormals();
  const color = materialColor(face.material);
  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness: face.material === 'roof' ? 0.85 : 0.7,
    metalness: 0,
    side: THREE.DoubleSide,
    emissive: highlighted ? 0x224466 : 0x000000,
    emissiveIntensity: highlighted ? 0.25 : 0,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.userData.faceId = face.id;
  mesh.userData.material = face.material;
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geom),
    new THREE.LineBasicMaterial({ color: 0x1f1f1f, transparent: true, opacity: 0.35 }),
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

  const highlightIds = useMemo(() => {
    if (!model?.faces) return new Set();
    if (selectedMaterial) {
      return new Set(model.faces.filter(f => f.material === selectedMaterial).map(f => f.id));
    }
    if (selectedFacade) {
      const facade = model.facades?.find(f => f.id === selectedFacade);
      return new Set(facade?.faceId ? [facade.faceId] : []);
    }
    return new Set();
  }, [model, selectedMaterial, selectedFacade]);

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return undefined;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf3f4f6);
    const camera = new THREE.PerspectiveCamera(45, el.clientWidth / Math.max(el.clientHeight, 1), 0.1, 2000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(el.clientWidth, el.clientHeight);
    el.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const sun = new THREE.DirectionalLight(0xffffff, 0.85);
    sun.position.set(40, 80, 30);
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0xcfe8ff, 0.35);
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

    threeRef.current = { scene, camera, renderer, controls, house };
    setReady(true);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === el) el.removeChild(renderer.domElement);
      threeRef.current = {};
    };
  }, []);

  useEffect(() => {
    const { house, camera, controls } = threeRef.current;
    if (!house || !model?.faces) return;

    while (house.children.length) {
      const child = house.children[0];
      child.traverse(obj => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          mats.forEach(m => m.dispose?.());
        }
      });
      house.remove(child);
    }

    for (const face of model.faces) {
      if (String(face.type || '').includes('PENETRATION')) continue;
      const mesh = buildMesh(face, highlightIds.has(face.id));
      if (mesh) house.add(mesh);
    }

    fitCamera(camera, controls, house);
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

  return (
    <div className="relative rounded-xl overflow-hidden border bg-gray-100" style={{ height: 420 }}>
      <div ref={mountRef} className="absolute inset-0" data-testid="house-3d-canvas" />
      <div className="absolute top-3 left-3 flex flex-wrap gap-2 z-10">
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
      <p className="absolute bottom-2 right-3 text-[10px] text-gray-400 pointer-events-none">Drag · scroll to zoom</p>
    </div>
  );
}
