// Static scenery: stars, the polar grid, soft glow texture and the manager core.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

/** A soft radial glow, drawn once and shared by every glowing sprite. */
export const glowTexture = (() => {
  const size = 128;
  const canvas = Object.assign(document.createElement('canvas'), { width: size, height: size });
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
})();

export function glowSprite(color, scale, opacity) {
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowTexture, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  sprite.scale.setScalar(scale);
  return sprite;
}

export function addStars(scene) {
  const count = 1800;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = 70 + Math.random() * 80;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    positions.set([r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta)], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const stars = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xaab4ff, size: 0.32, transparent: true, opacity: 0.75, depthWrite: false, fog: false }));
  scene.add(stars);
  return stars;
}

export function addGrid(scene) {
  const grid = new THREE.PolarGridHelper(18, 12, 6, 96, 0x2a3160, 0x1a1f3d);
  grid.position.y = -4.5;
  grid.material.transparent = true;
  grid.material.opacity = 0.35;
  scene.add(grid);
  return grid;
}

/** The manager: a faceted core with a counter-rotating wireframe shell. */
export function addCore(scene) {
  const group = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1, 1),
    new THREE.MeshStandardMaterial({ color: 0x1b1d33, emissive: 0x6d6aff, emissiveIntensity: 0.55, flatShading: true, roughness: 0.4, metalness: 0.3 }),
  );
  const shell = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.55, 1),
    new THREE.MeshBasicMaterial({ color: 0x9a90ff, wireframe: true, transparent: true, opacity: 0.18 }),
  );
  const glow = glowSprite(0x7b6dff, 7, 0.45);
  const label = new CSS2DObject(Object.assign(document.createElement('div'), { className: 'core-label', textContent: 'Manager' }));
  label.position.y = 2.1;
  group.add(core, shell, glow, label);
  scene.add(group);

  return {
    group,
    update(t, activity) {
      core.rotation.y = t * 0.25;
      core.rotation.x = Math.sin(t * 0.3) * 0.2;
      shell.rotation.y = -t * 0.12;
      shell.rotation.z = t * 0.05;
      const target = 0.5 + Math.min(activity, 4) * 0.18;
      core.material.emissiveIntensity += (target + Math.sin(t * 2) * 0.05 - core.material.emissiveIntensity) * 0.05;
      glow.material.opacity = 0.35 + Math.min(activity, 4) * 0.06;
    },
  };
}
