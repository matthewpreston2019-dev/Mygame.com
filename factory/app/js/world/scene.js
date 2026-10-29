// The 3D world: renderer, camera, controls, picking and the zoom-in / zoom-out animation.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { addStars, addGrid, addCore } from './backdrop.js';
import { createCloud } from './clouds.js';
import { createLinks } from './links.js';

const HOME = { position: new THREE.Vector3(0, 12, 29), portrait: new THREE.Vector3(0, 20, 27), target: new THREE.Vector3(0, -0.5, 0) };
// Portrait screens (phones) look from higher up and further back so every cloud fits.
function homePosition() {
  const aspect = innerWidth / innerHeight;
  return aspect < 1 ? HOME.portrait.clone().multiplyScalar(Math.max(1, 0.62 / aspect)) : HOME.position.clone();
}
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);

export function createWorld(container, { onSelect }) {
  // Renderer
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0x05060b, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.append(renderer.domElement);

  const labels = new CSS2DRenderer();
  labels.domElement.className = 'labels';
  container.append(labels.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x05060b, 0.018);
  scene.add(new THREE.HemisphereLight(0xc4d0ff, 0x14142a, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(6, 12, 8);
  scene.add(sun);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
  camera.position.copy(HOME.position);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = 3.5;
  controls.maxDistance = 90;
  controls.autoRotate = !reducedMotion;
  controls.autoRotateSpeed = 0.35;
  controls.target.copy(HOME.target);
  controls.addEventListener('start', () => {
    controls.autoRotate = false;
    flight = null;
  });

  addStars(scene);
  addGrid(scene);
  const core = addCore(scene);

  let clouds = [];
  let links = null;
  let focusId = null;
  let flight = null; // camera animation in progress

  // ── Building from data ──
  function setClouds(list) {
    if (clouds.length) return; // clouds are fixed once built
    clouds = list.map(createCloud);
    for (const c of clouds) scene.add(c.group);
    links = createLinks(scene, clouds);
  }

  // ── Camera flights ──
  function flyTo(position, target, duration = 1.1) {
    flight = { fromPos: camera.position.clone(), fromTarget: controls.target.clone(), toPos: position, toTarget: target, start: performance.now(), duration: reducedMotion ? 10 : duration * 1000 };
  }

  function focus(id) {
    const cloud = clouds.find((c) => c.id === id);
    if (!cloud) return;
    focusId = id;
    controls.autoRotate = false;
    const pos = cloud.group.position.clone();
    const outward = pos.clone().setY(0).normalize();
    const distance = 11 * Math.max(1, 0.62 / (innerWidth / innerHeight)); // further back on phones
    const camPos = pos.clone().add(outward.multiplyScalar(distance)).add(new THREE.Vector3(0, 3.8, 0));
    // Leave room for the panel: right side on desktop, bottom sheet on phones.
    const viewDir = pos.clone().sub(camPos).normalize();
    const right = new THREE.Vector3().crossVectors(viewDir, camera.up).normalize();
    const target = innerWidth > 760 ? pos.clone().add(right.multiplyScalar(3)) : pos.clone().add(new THREE.Vector3(0, -3.4, 0));
    flyTo(camPos.add(target.clone().sub(pos)), target);
    for (const c of clouds) {
      c.setDim(c.id !== id);
      c.setFocused(c.id === id);
    }
    links.setDim(id);
  }

  function home() {
    focusId = null;
    flyTo(homePosition(), HOME.target.clone());
    for (const c of clouds) {
      c.setDim(false);
      c.setFocused(false);
    }
    links?.setDim(null);
    setTimeout(() => (controls.autoRotate = !reducedMotion && !focusId), 1300);
  }

  // ── Picking: click (not drag) a cloud to open it ──
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let down = null;
  let hovered = null;

  function pick(e) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(clouds.flatMap((c) => c.puffs), false)[0];
    return hit ? clouds.find((c) => c.id === hit.object.userData.cloudId) : null;
  }

  renderer.domElement.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }));
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
    const cloud = pick(e);
    if (cloud) onSelect(cloud.id);
  });
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || e.buttons) return;
    const cloud = pick(e);
    if (cloud !== hovered) {
      hovered?.setHover(false);
      cloud?.setHover(true);
      hovered = cloud;
      renderer.domElement.style.cursor = cloud ? 'pointer' : 'grab';
    }
  });
  renderer.domElement.addEventListener('dblclick', (e) => {
    if (focusId && !pick(e)) onSelect(null);
  });

  // ── Resize & render loop ──
  function resize() {
    const { clientWidth: w, clientHeight: h } = container;
    renderer.setSize(w, h);
    labels.setSize(w, h);
    camera.aspect = w / h;
    camera.fov = w < 760 ? 62 : 50;
    camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize);
  resize();
  camera.position.copy(homePosition());

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    if (flight) {
      // Real time, not frame count, so the flight takes the same time on slow devices.
      const p = Math.min(1, (performance.now() - flight.start) / flight.duration);
      camera.position.lerpVectors(flight.fromPos, flight.toPos, ease(p));
      controls.target.lerpVectors(flight.fromTarget, flight.toTarget, ease(p));
      if (p >= 1) flight = null;
    }
    controls.update(dt);
    core.update(t, clouds.reduce((n, c) => n + c.activity, 0));
    for (const c of clouds) c.update(t, dt);
    links?.update(dt);
    renderer.render(scene, camera);
    labels.render(scene, camera);
  });

  return {
    setClouds,
    focus,
    home,
    /** Push live data into the world: per-cloud activity and cross-cloud information flow. */
    update(infoByCloud, workerNames, dependencies) {
      for (const c of clouds) if (infoByCloud[c.id]) c.setInfo(infoByCloud[c.id], workerNames);
      links?.setDependencies(dependencies);
    },
    pulse: (cloudId) => links?.pulse(cloudId),
  };
}
