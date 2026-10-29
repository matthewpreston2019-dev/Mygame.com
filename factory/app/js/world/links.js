// Information flow, drawn as glowing curves with travelling particles:
//   core → cloud     the manager assigning work (faster and brighter while a cloud is busy)
//   cloud → core     a pulse when a result is collected
//   cloud → cloud    one worker sharing results with another (task dependencies)
//   cloud ↔ cloud    a faint ring connecting neighbouring areas
import * as THREE from 'three';
import { glowSprite } from './backdrop.js';

const tmp = new THREE.Vector3();

function curveBetween(a, b, lift) {
  const mid = a.clone().add(b).multiplyScalar(0.5);
  mid.y += lift;
  return new THREE.QuadraticBezierCurve3(a.clone(), mid, b.clone());
}

function tube(curve, color, opacity, radius = 0.025) {
  return new THREE.Mesh(
    new THREE.TubeGeometry(curve, 48, radius, 6, false),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
}

export function createLinks(scene, clouds) {
  const root = new THREE.Group();
  scene.add(root);
  const origin = new THREE.Vector3(0, 0, 0);

  // Faint ring through all clouds
  const ringCurve = new THREE.CatmullRomCurve3(clouds.map((c) => c.group.position.clone()), true, 'centripetal');
  const ring = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(ringCurve.getPoints(200)),
    new THREE.LineBasicMaterial({ color: 0x6d74b8, transparent: true, opacity: 0.12 }),
  );
  root.add(ring);

  // Manager → cloud links, each with three particles
  const spokes = clouds.map((cloud) => {
    const curve = curveBetween(origin, cloud.group.position, 2.2);
    const line = tube(curve, cloud.color, 0.16);
    const particles = [0, 0.33, 0.66].map((offset) => {
      const p = glowSprite(cloud.color, 0.7, 0.5);
      root.add(p);
      return { sprite: p, t: offset };
    });
    root.add(line);
    return { cloud, curve, line, particles };
  });

  // Result pulses (cloud → core) and dependency arcs (cloud → cloud) come and go.
  const pulses = [];
  let arcs = [];

  return {
    /** A result was collected: send a bright pulse from the cloud back to the manager. */
    pulse(cloudId) {
      const spoke = spokes.find((s) => s.cloud.id === cloudId);
      if (!spoke) return;
      const sprite = glowSprite(0xffffff, 1.6, 0.9);
      root.add(sprite);
      pulses.push({ sprite, curve: spoke.curve, t: 1 });
    },

    /** pairs: [{ from: cloudId, to: cloudId, key }] for tasks waiting on another cloud's result. */
    setDependencies(pairs) {
      const keep = new Set(pairs.map((p) => p.key));
      arcs = arcs.filter((arc) => {
        if (keep.has(arc.key)) return true;
        root.remove(arc.line, ...arc.particles.map((p) => p.sprite));
        arc.line.geometry.dispose();
        return false;
      });
      for (const pair of pairs) {
        if (arcs.some((a) => a.key === pair.key)) continue;
        const from = clouds.find((c) => c.id === pair.from);
        const to = clouds.find((c) => c.id === pair.to);
        if (!from || !to || from === to) continue;
        const curve = curveBetween(from.group.position, to.group.position, 5);
        const line = tube(curve, 0xffffff, 0.22, 0.02);
        const particles = [0, 0.5].map((t) => ({ sprite: glowSprite(0xffffff, 0.8, 0.8), t }));
        root.add(line, ...particles.map((p) => p.sprite));
        arcs.push({ key: pair.key, curve, line, particles });
      }
    },

    setDim(focusId) {
      for (const s of spokes) s.line.material.opacity = !focusId || s.cloud.id === focusId ? 0.16 : 0.04;
      ring.material.opacity = focusId ? 0.05 : 0.12;
    },

    update(dt) {
      for (const s of spokes) {
        const busy = s.cloud.activity > 0;
        const speed = busy ? 0.32 : 0.05;
        for (const p of s.particles) {
          p.t = (p.t + dt * speed) % 1;
          p.sprite.position.copy(s.curve.getPoint(p.t));
          p.sprite.material.opacity = (busy ? 0.85 : 0.25) * Math.sin(p.t * Math.PI);
          p.sprite.scale.setScalar(busy ? 0.9 : 0.55);
        }
      }
      for (let i = pulses.length - 1; i >= 0; i--) {
        const p = pulses[i];
        p.t -= dt * 0.6;
        if (p.t <= 0) {
          root.remove(p.sprite);
          pulses.splice(i, 1);
          continue;
        }
        p.sprite.position.copy(p.curve.getPoint(p.t));
        p.sprite.material.opacity = Math.sin(p.t * Math.PI) * 0.95;
      }
      for (const arc of arcs) {
        for (const p of arc.particles) {
          p.t = (p.t + dt * 0.25) % 1;
          p.sprite.position.copy(arc.curve.getPoint(p.t, tmp));
          p.sprite.material.opacity = Math.sin(p.t * Math.PI) * 0.9;
        }
      }
    },
  };
}
