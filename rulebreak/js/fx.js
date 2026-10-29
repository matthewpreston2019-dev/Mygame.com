// fx.js — pooled GPU particles, shockwave rings and shared glow textures
const FX = (() => {
  const MAX = 4000;
  let points, geo, uScale;
  const pos = new Float32Array(MAX * 3), col = new Float32Array(MAX * 3);
  const size = new Float32Array(MAX), alpha = new Float32Array(MAX);
  const vel = new Float32Array(MAX * 3), life = new Float32Array(MAX), maxLife = new Float32Array(MAX);
  const s0 = new Float32Array(MAX), s1 = new Float32Array(MAX), drag = new Float32Array(MAX), grav = new Float32Array(MAX);
  let cursor = 0;
  const rings = [];
  const tmpC = new THREE.Color();

  function makeGlowTexture(inner = 'rgba(255,255,255,1)', mid = 'rgba(255,255,255,0.35)') {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, inner); gr.addColorStop(0.25, mid); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c); return t;
  }
  const glowTex = makeGlowTexture();
  const shadowTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 4, 32, 32, 32);
    gr.addColorStop(0, 'rgba(0,0,0,0.6)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();

  function init(scene) {
    geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('pcolor', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('psize', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('palpha', new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    uScale = { value: 600 };
    const mat = new THREE.ShaderMaterial({
      uniforms: { uScale },
      vertexShader: `
        attribute vec3 pcolor; attribute float psize; attribute float palpha;
        varying vec3 vC; varying float vA;
        uniform float uScale;
        void main(){
          vC = pcolor; vA = palpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = psize * uScale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec3 vC; varying float vA;
        void main(){
          float d = length(gl_PointCoord - 0.5) * 2.0;
          if (d > 1.0) discard;
          float a = (1.0 - d); a *= a;
          gl_FragColor = vec4(vC * (1.0 + (1.0 - d) * 0.8), a * vA);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    points.renderOrder = 10;
    scene.add(points);

    const rg = new THREE.RingGeometry(0.86, 1, 64); rg.rotateX(-Math.PI / 2);
    for (let i = 0; i < 40; i++) {
      const m = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.visible = false; m.renderOrder = 9; scene.add(m);
      rings.push({ mesh: m, t: 0, life: 1, r0: 0, r1: 1, a: 1 });
    }
  }

  function setViewport(heightPx, fovDeg) {
    if (uScale) uScale.value = heightPx / (2 * Math.tan(fovDeg * Math.PI / 360));
  }

  // emit one particle
  function emit(x, y, z, vx, vy, vz, color, sz, lifeT, o) {
    const i = cursor; cursor = (cursor + 1) % MAX;
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    vel[i * 3] = vx; vel[i * 3 + 1] = vy; vel[i * 3 + 2] = vz;
    tmpC.set(color);
    col[i * 3] = tmpC.r; col[i * 3 + 1] = tmpC.g; col[i * 3 + 2] = tmpC.b;
    life[i] = maxLife[i] = lifeT;
    s0[i] = sz; s1[i] = o && o.s1 !== undefined ? o.s1 : 0;
    drag[i] = o && o.drag !== undefined ? o.drag : 3;
    grav[i] = o && o.grav !== undefined ? o.grav : 0;
    size[i] = sz; alpha[i] = 1;
  }

  function burst(x, y, z, color, n, speed, sz, lifeT, o = {}) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const up = o.up !== undefined ? o.up : 0.6;
      const sp = speed * (0.35 + Math.random() * 0.65);
      const vy = (Math.random() * 2 - 1 + up) * sp * (o.vyMul || 0.6);
      emit(x, y, z, Math.cos(a) * sp, vy, Math.sin(a) * sp, color, sz * (0.6 + Math.random() * 0.6), lifeT * (0.6 + Math.random() * 0.5), o);
    }
  }

  // directional spray (for impacts / muzzle)
  function spray(x, y, z, dx, dz, color, n, speed, spread, sz, lifeT, o = {}) {
    const base = Math.atan2(dz, dx);
    for (let k = 0; k < n; k++) {
      const a = base + (Math.random() - 0.5) * spread;
      const sp = speed * (0.4 + Math.random() * 0.6);
      emit(x, y, z, Math.cos(a) * sp, (Math.random() - 0.3) * sp * 0.4, Math.sin(a) * sp, color, sz * (0.6 + Math.random() * 0.5), lifeT * (0.6 + Math.random() * 0.5), o);
    }
  }

  function ring(x, z, color, r0, r1, lifeT, a = 1, y = 0.06) {
    let best = rings[0];
    for (const r of rings) { if (!r.mesh.visible) { best = r; break; } if (r.t / r.life > best.t / best.life) best = r; }
    best.t = 0; best.life = lifeT; best.r0 = r0; best.r1 = r1; best.a = a;
    best.mesh.material.color.set(color);
    best.mesh.position.set(x, y, z);
    best.mesh.visible = true;
    best.mesh.scale.setScalar(r0 || 0.01);
  }

  function update(dt) {
    for (let i = 0; i < MAX; i++) {
      if (life[i] <= 0) { if (alpha[i] !== 0) { alpha[i] = 0; size[i] = 0; } continue; }
      life[i] -= dt;
      const k = Math.max(0, life[i] / maxLife[i]);
      const dr = Math.exp(-drag[i] * dt);
      vel[i * 3] *= dr; vel[i * 3 + 1] = vel[i * 3 + 1] * dr - grav[i] * dt; vel[i * 3 + 2] *= dr;
      pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      if (pos[i * 3 + 1] < 0.03) { pos[i * 3 + 1] = 0.03; vel[i * 3 + 1] *= -0.4; }
      size[i] = s1[i] + (s0[i] - s1[i]) * k;
      alpha[i] = Math.min(1, k * 2.2);
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.pcolor.needsUpdate = true;
    geo.attributes.psize.needsUpdate = true;
    geo.attributes.palpha.needsUpdate = true;

    for (const r of rings) {
      if (!r.mesh.visible) continue;
      r.t += dt;
      const k = r.t / r.life;
      if (k >= 1) { r.mesh.visible = false; continue; }
      const e = 1 - Math.pow(1 - k, 3);
      r.mesh.scale.setScalar(r.r0 + (r.r1 - r.r0) * e);
      r.mesh.material.opacity = r.a * (1 - k);
    }
  }

  function clear() {
    life.fill(0);
    for (const r of rings) r.mesh.visible = false;
  }

  return { init, emit, burst, spray, ring, update, clear, setViewport, glowTex, shadowTex, makeGlowTexture };
})();
