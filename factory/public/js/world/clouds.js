// A cloud = an area of work: soft puffs, a glow, a label, and its workers orbiting as small orbs.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { glowSprite } from './backdrop.js';

const puffGeometry = new THREE.SphereGeometry(1, 28, 18);
const orbGeometry = new THREE.SphereGeometry(0.2, 16, 12);

// Deterministic randomness so each cloud keeps its shape between visits.
function seeded(str) {
  let s = [...str].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

const ORB_COLORS = { idle: new THREE.Color(0x5b6178), waiting: new THREE.Color(0xfbbf24) };

export function createCloud(cloud) {
  const color = new THREE.Color(cloud.color);
  const rand = seeded(cloud.id);
  const group = new THREE.Group();
  group.position.fromArray(cloud.position);

  // Puffs: a flattened cluster of spheres sharing one material.
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0xffffff).lerp(color, 0.28),
    emissive: color,
    emissiveIntensity: 0.32,
    roughness: 0.95,
    transparent: true,
    opacity: 0.94,
  });
  const body = new THREE.Group();
  const puffs = [];
  for (let i = 0; i < 8; i++) {
    const puff = new THREE.Mesh(puffGeometry, material);
    const angle = (i / 8) * Math.PI * 2 + rand();
    const r = i === 0 ? 0 : 0.7 + rand() * 0.7;
    puff.position.set(Math.cos(angle) * r * 1.3, (rand() - 0.4) * 0.6, Math.sin(angle) * r * 0.8);
    puff.scale.setScalar(i === 0 ? 1.15 : 0.55 + rand() * 0.5);
    puff.userData.cloudId = cloud.id;
    puffs.push(puff);
    body.add(puff);
  }
  const glow = glowSprite(color, 8.5, 0.32);
  group.add(body, glow);

  // Label
  const labelEl = document.createElement('div');
  labelEl.className = 'cloud-label';
  labelEl.innerHTML = `<div class="name"></div><div class="meta"></div>`;
  labelEl.querySelector('.name').textContent = cloud.name;
  const label = new CSS2DObject(labelEl);
  label.position.set(0, 2.4, 0);
  group.add(label);

  // Worker orbs
  const orbs = cloud.workers.map((workerId, i) => {
    const mat = new THREE.MeshStandardMaterial({ color: 0x9aa0b8, emissive: ORB_COLORS.idle.clone(), emissiveIntensity: 0.6, roughness: 0.4 });
    const mesh = new THREE.Mesh(orbGeometry, mat);
    const halo = glowSprite(color, 1.4, 0);
    mesh.add(halo);
    const tag = document.createElement('div');
    tag.className = 'worker-label';
    const tagObj = new CSS2DObject(tag);
    tagObj.position.y = 0.5;
    tagObj.visible = false;
    mesh.add(tagObj);
    group.add(mesh);
    return { workerId, mesh, mat, halo, tag, tagObj, phase: (i / cloud.workers.length) * Math.PI * 2, radius: 2.6 + (i % 2) * 0.35, tilt: 0.25 + i * 0.12, busy: 0 };
  });

  let hover = 0;
  let hoverTarget = 0;
  let dim = 1;
  let dimTarget = 1;
  let activity = 0;
  const bob = rand() * Math.PI * 2;
  const baseY = group.position.y;

  return {
    id: cloud.id,
    group,
    puffs,
    color,
    get activity() { return activity; },

    setHover(on) {
      hoverTarget = on ? 1 : 0;
      labelEl.classList.toggle('hover', on);
    },
    setDim(on) {
      dimTarget = on ? 0.28 : 1;
      labelEl.classList.toggle('dim', on);
    },
    setFocused(on) {
      for (const o of orbs) o.tagObj.visible = on;
    },

    /** info: { projects, running, queued, workers: { [id]: { status, title } } } */
    setInfo(info, workerNames) {
      activity = info.running;
      const parts = [`${info.projects} project${info.projects === 1 ? '' : 's'}`];
      if (info.running) parts.push(`<b>${info.running} running</b>`);
      if (info.queued) parts.push(`${info.queued} queued`);
      labelEl.querySelector('.meta').innerHTML = parts.join(' · ');
      for (const o of orbs) {
        const w = info.workers[o.workerId] || { status: 'idle' };
        o.state = w.status;
        const title = w.title?.length > 28 ? `${w.title.slice(0, 27)}…` : w.title;
        o.tag.textContent = `${workerNames[o.workerId]?.name || o.workerId}${w.status === 'running' ? ` · ${title}` : w.status === 'waiting' ? ' · waiting' : ''}`;
        o.tag.classList.toggle('busy', w.status === 'running');
      }
    },

    update(t, dt) {
      hover += (hoverTarget - hover) * Math.min(1, dt * 8);
      dim += (dimTarget - dim) * Math.min(1, dt * 5);
      group.position.y = baseY + Math.sin(t * 0.6 + bob) * 0.25;
      body.rotation.y = Math.sin(t * 0.15 + bob) * 0.25;
      const s = 1 + hover * 0.07 + Math.sin(t * 1.1 + bob) * 0.012;
      body.scale.setScalar(s);
      material.opacity = 0.94 * dim;
      material.emissiveIntensity = (0.3 + hover * 0.25 + Math.min(activity, 3) * 0.1 + (activity ? Math.sin(t * 3) * 0.05 : 0)) * dim;
      glow.material.opacity = (0.26 + hover * 0.12 + Math.min(activity, 3) * 0.08) * dim;

      for (const o of orbs) {
        const speed = o.state === 'running' ? 0.9 : 0.3;
        o.phase += dt * speed;
        o.mesh.position.set(Math.cos(o.phase) * o.radius, Math.sin(o.phase * 0.7) * o.tilt + 0.2, Math.sin(o.phase) * o.radius * 0.75);
        const target = o.state === 'running' ? 1 : 0;
        o.busy += (target - o.busy) * Math.min(1, dt * 4);
        if (o.state === 'waiting') o.mat.emissive.lerp(ORB_COLORS.waiting, 0.1);
        else o.mat.emissive.lerp(o.busy > 0.5 ? color : ORB_COLORS.idle, 0.1);
        o.mat.emissiveIntensity = 0.6 + o.busy * (0.8 + Math.sin(t * 5) * 0.3);
        o.mesh.scale.setScalar(1 + o.busy * 0.35);
        o.halo.material.opacity = o.busy * 0.7 * dim;
        o.mat.opacity = dim;
        o.mat.transparent = dim < 1;
      }
    },
  };
}
