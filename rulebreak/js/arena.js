// arena.js — map layout, static visuals, collision helpers and flow-field navigation
const ARENA = (() => {
  const HW = 22, HH = 15;           // half width / half height
  const COLS = HW * 2, ROWS = HH * 2;

  // Left half of the map; everything is mirrored through the centre (and the map is z-symmetric too).
  const LEFT_WALLS = [
    [-16, -4.5, 1, 3], [-16, 4.5, 1, 3],
    [-11, 0, 1.2, 4],
    [-10, -10.5, 5, 1.2], [-10, 10.5, 5, 1.2],
    [-5, -3.5, 1.2, 3], [-5, 3.5, 1.2, 3],
    [-13, -13.5, 1.2, 3], [-13, 13.5, 1.2, 3],
    [-7.5, -7, 3, 1.2], [-7.5, 7, 3, 1.2],
  ];
  const LEFT_CRATES = [[-8, 0], [-13, -7.5], [-13, 7.5], [-4, 12.5], [-4, -12.5], [-18.5, -8], [-18.5, 8]];
  const PYLONS = [[0, -12.5], [0, 12.5]];
  const LEFT_PADS = [[-19, -11.5, -6, -12.8], [-19, 11.5, -6, 12.8]];

  const mirror = (list) => list.concat(list.map((w) => [-w[0], -w[1], ...w.slice(2)]));
  const wallsDef = mirror(LEFT_WALLS);
  const cratesDef = mirror(LEFT_CRATES);
  const padsDef = LEFT_PADS.concat(LEFT_PADS.map((p) => [-p[0], -p[1], -p[2], -p[3]]));

  const rect = (x, z, w, d, kind) => ({ x, z, w, d, x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, kind, alive: true });
  const walls = wallsDef.map((w) => rect(w[0], w[1], w[2], w[3], 'wall'));

  // ---------- static visuals ----------
  const floorUniforms = { uTime: { value: 0 } };
  function buildStatic(scene) {
    // void backdrop stars
    const sg = new THREE.BufferGeometry(), sp = [];
    for (let i = 0; i < 900; i++) {
      const x = (Math.random() - 0.5) * 220, z = (Math.random() - 0.5) * 160, y = -6 - Math.random() * 40;
      if (Math.abs(x) < HW + 2 && Math.abs(z) < HH + 2 && y > -10) continue;
      sp.push(x, y, z);
    }
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ map: FX.glowTex, color: 0x8a7cff, size: 0.7, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8 })));

    // floor
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(HW * 2, HH * 2, 1, 1), new THREE.ShaderMaterial({
      uniforms: floorUniforms,
      extensions: { derivatives: true },
      vertexShader: `varying vec3 vP; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vP = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `
        varying vec3 vP; uniform float uTime;
        float gridLine(vec2 p, float s){ vec2 q = p / s; vec2 g = abs(fract(q - 0.5) - 0.5) / fwidth(q); return 1.0 - min(min(g.x, g.y), 1.0); }
        void main(){
          vec2 p = vP.xz;
          vec3 col = vec3(0.055, 0.05, 0.13);
          col += vec3(0.0, 0.035, 0.08) * smoothstep(0.0, -22.0, p.x);
          col += vec3(0.08, 0.0, 0.035) * smoothstep(0.0, 22.0, p.x);
          vec2 t = abs(fract(p) - 0.5);
          col += 0.018 * step(0.47, max(t.x, t.y));
          float g = gridLine(p, 4.0);
          vec3 gc = mix(vec3(0.25, 0.55, 1.0), vec3(1.0, 0.3, 0.5), smoothstep(-10.0, 10.0, p.x));
          col += gc * g * 0.16;
          float d = length(p);
          float wave = smoothstep(0.08, 0.0, abs(fract(d * 0.06 - uTime * 0.05) - 0.5));
          col += vec3(0.45, 0.25, 1.0) * wave * 0.05;
          vec2 e = vec2(22.0, 15.0) - abs(p);
          float edge = min(e.x, e.y);
          col += vec3(0.5, 0.35, 1.0) * smoothstep(1.2, 0.0, edge) * 0.25;
          gl_FragColor = vec4(col, 1.0);
        }`,
    }));
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    // platform body under the floor
    const base = new THREE.Mesh(new THREE.BoxGeometry(HW * 2 + 0.6, 3, HH * 2 + 0.6), new THREE.MeshLambertMaterial({ color: 0x14112e }));
    base.position.y = -1.52; scene.add(base);
    const edgeMat = new THREE.MeshBasicMaterial({ color: 0x8f6bff });
    const e1 = new THREE.BoxGeometry(HW * 2 + 0.7, 0.08, 0.08), e2 = new THREE.BoxGeometry(0.08, 0.08, HH * 2 + 0.7);
    [[0, -HH - 0.3, e1], [0, HH + 0.3, e1], [-HW - 0.3, 0, e2], [HW + 0.3, 0, e2]].forEach(([x, z, g]) => {
      const m = new THREE.Mesh(g, edgeMat); m.position.set(x, -0.05, z); scene.add(m);
      const m2 = m.clone(); m2.position.y = -2.9; scene.add(m2);
    });

    // spawn pads
    [[-19.5, 0x3fb8ff], [19.5, 0xff4d6d]].forEach(([x, c]) => {
      const hex = new THREE.Mesh(new THREE.CircleGeometry(2.2, 6), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false }));
      hex.rotation.x = -Math.PI / 2; hex.position.set(x, 0.015, 0); scene.add(hex);
      const r = new THREE.Mesh(new THREE.RingGeometry(2.05, 2.2, 6), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
      r.rotation.x = -Math.PI / 2; r.position.set(x, 0.02, 0); scene.add(r);
    });

    // walls (low so the camera reads over them) with glowing caps
    const wallMat = new THREE.MeshLambertMaterial({ color: 0x232048 });
    const capBlue = new THREE.MeshBasicMaterial({ color: 0x48c6ff }), capRed = new THREE.MeshBasicMaterial({ color: 0xff5a8a });
    const topMat = new THREE.MeshLambertMaterial({ color: 0x2f2a63, emissive: 0x0d0a26 });
    for (const w of walls) {
      const h = 1.5;
      const m = new THREE.Mesh(new THREE.BoxGeometry(w.w, h, w.d), wallMat); m.position.set(w.x, h / 2, w.z); scene.add(m);
      const top = new THREE.Mesh(new THREE.BoxGeometry(w.w - 0.16, 0.06, w.d - 0.16), topMat); top.position.set(w.x, h + 0.03, w.z); scene.add(top);
      const capMat = w.x < 0 ? capBlue : capRed;
      const t = 0.07;
      [[w.x, w.z0, w.w, t], [w.x, w.z1, w.w, t], [w.x0, w.z, t, w.d], [w.x1, w.z, t, w.d]].forEach(([x, z, ww, dd]) => {
        const c = new THREE.Mesh(new THREE.BoxGeometry(ww + t, 0.07, dd + t), capMat); c.position.set(x, h + 0.02, z); scene.add(c);
      });
      const sh = new THREE.Mesh(new THREE.PlaneGeometry(w.w + 1.2, w.d + 1.2), new THREE.MeshBasicMaterial({ map: FX.shadowTex, transparent: true, depthWrite: false, opacity: 0.8 }));
      sh.rotation.x = -Math.PI / 2; sh.position.set(w.x + 0.25, 0.012, w.z + 0.25); scene.add(sh);
    }

    // floating debris around the platform
    const deb = new THREE.Group();
    const dg = new THREE.OctahedronGeometry(1, 0), dm = new THREE.MeshLambertMaterial({ color: 0x2a2460, emissive: 0x0c0830 });
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2, rr = 34 + Math.random() * 22;
      const m = new THREE.Mesh(dg, dm);
      m.position.set(Math.cos(a) * rr, -4 - Math.random() * 10, Math.sin(a) * rr * 0.75);
      m.scale.setScalar(0.6 + Math.random() * 2.2); m.rotation.set(Math.random() * 3, Math.random() * 3, 0);
      m.userData.s = 0.1 + Math.random() * 0.3; m.userData.y = m.position.y;
      deb.add(m);
    }
    scene.add(deb);
    return { update(t) { floorUniforms.uTime.value = t; deb.children.forEach((m, i) => { m.rotation.y += m.userData.s * 0.01; m.position.y = m.userData.y + Math.sin(t * 0.4 + i) * 0.6; }); } };
  }

  // ---------- geometry helpers ----------
  function circleRect(px, pz, r, s) {
    const cx = Math.max(s.x0, Math.min(px, s.x1)), cz = Math.max(s.z0, Math.min(pz, s.z1));
    const dx = px - cx, dz = pz - cz;
    return dx * dx + dz * dz < r * r;
  }
  // resolve circle out of rect; returns true if moved
  function pushOut(u, r, s) {
    const cx = Math.max(s.x0, Math.min(u.x, s.x1)), cz = Math.max(s.z0, Math.min(u.z, s.z1));
    let dx = u.x - cx, dz = u.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) return false;
    if (d2 > 1e-8) {
      const d = Math.sqrt(d2), k = (r - d) / d;
      u.x += dx * k; u.z += dz * k;
    } else {
      const l = u.x - s.x0, rr = s.x1 - u.x, t = u.z - s.z0, b = s.z1 - u.z;
      const m = Math.min(l, rr, t, b);
      if (m === l) u.x = s.x0 - r; else if (m === rr) u.x = s.x1 + r; else if (m === t) u.z = s.z0 - r; else u.z = s.z1 + r;
    }
    return true;
  }
  // segment vs AABB (slab)
  function segRect(x0, z0, x1, z1, s, pad = 0) {
    const dx = x1 - x0, dz = z1 - z0;
    let tmin = 0, tmax = 1;
    const bx0 = s.x0 - pad, bx1 = s.x1 + pad, bz0 = s.z0 - pad, bz1 = s.z1 + pad;
    if (Math.abs(dx) < 1e-9) { if (x0 < bx0 || x0 > bx1) return false; }
    else { let a = (bx0 - x0) / dx, b = (bx1 - x0) / dx; if (a > b) [a, b] = [b, a]; tmin = Math.max(tmin, a); tmax = Math.min(tmax, b); if (tmin > tmax) return false; }
    if (Math.abs(dz) < 1e-9) { if (z0 < bz0 || z0 > bz1) return false; }
    else { let a = (bz0 - z0) / dz, b = (bz1 - z0) / dz; if (a > b) [a, b] = [b, a]; tmin = Math.max(tmin, a); tmax = Math.min(tmax, b); if (tmin > tmax) return false; }
    return true;
  }

  // ---------- navigation (Dijkstra flow fields on a 1m grid) ----------
  let blocked = new Uint8Array(COLS * ROWS);
  let navVersion = 0;
  const cellOf = (x, z) => {
    const i = Math.max(0, Math.min(COLS - 1, Math.floor(x + HW)));
    const j = Math.max(0, Math.min(ROWS - 1, Math.floor(z + HH)));
    return j * COLS + i;
  };
  const cellX = (c) => (c % COLS) - HW + 0.5, cellZ = (c) => Math.floor(c / COLS) - HH + 0.5;

  function rebuildNav(solids) {
    blocked.fill(0);
    for (let c = 0; c < COLS * ROWS; c++) {
      const x = cellX(c), z = cellZ(c);
      for (const s of solids) if (circleRect(x, z, 0.52, s)) { blocked[c] = 1; break; }
    }
    navVersion++;
  }

  const NB = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
  const heap = new Int32Array(COLS * ROWS * 8); let hn = 0;
  function field(tx, tz) {
    const dist = new Float32Array(COLS * ROWS).fill(1e9);
    let start = cellOf(tx, tz);
    if (blocked[start]) { // nearest open cell
      let best = -1, bd = 1e9;
      for (let c = 0; c < COLS * ROWS; c++) if (!blocked[c]) { const d = (cellX(c) - tx) ** 2 + (cellZ(c) - tz) ** 2; if (d < bd) { bd = d; best = c; } }
      if (best >= 0) start = best;
    }
    dist[start] = 0; hn = 0; push(start, dist);
    while (hn) {
      const c = pop(dist);
      const ci = c % COLS, cj = (c / COLS) | 0, dc = dist[c];
      for (const [di, dj, w] of NB) {
        const ni = ci + di, nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= COLS || nj >= ROWS) continue;
        const n = nj * COLS + ni;
        if (blocked[n]) continue;
        if (di && dj && (blocked[cj * COLS + ni] || blocked[nj * COLS + ci])) continue;
        const nd = dc + w;
        if (nd < dist[n]) { dist[n] = nd; push(n, dist); }
      }
    }
    return { dist, v: navVersion };
  }
  function push(c, dist) {
    let i = hn++; heap[i] = c;
    while (i > 0) { const p = (i - 1) >> 1; if (dist[heap[p]] <= dist[heap[i]]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
  }
  function pop(dist) {
    const top = heap[0]; heap[0] = heap[--hn];
    let i = 0;
    for (;;) {
      const l = i * 2 + 1, r = l + 1; let m = i;
      if (l < hn && dist[heap[l]] < dist[heap[m]]) m = l;
      if (r < hn && dist[heap[r]] < dist[heap[m]]) m = r;
      if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
    }
    return top;
  }
  // direction to follow on a field from (x,z); out = {x,z}; returns false if at goal
  function flowDir(f, x, z, out) {
    const c = cellOf(x, z), ci = c % COLS, cj = (c / COLS) | 0;
    let best = -1, bd = blocked[c] ? 1e9 : f.dist[c];
    for (const [di, dj] of NB) {
      const ni = ci + di, nj = cj + dj;
      if (ni < 0 || nj < 0 || ni >= COLS || nj >= ROWS) continue;
      const n = nj * COLS + ni;
      if (blocked[n]) continue;
      if (di && dj && (blocked[cj * COLS + ni] || blocked[nj * COLS + ci])) continue;
      if (f.dist[n] < bd) { bd = f.dist[n]; best = n; }
    }
    if (best < 0) { out.x = 0; out.z = 0; return false; }
    const dx = cellX(best) - x, dz = cellZ(best) - z, l = Math.hypot(dx, dz) || 1;
    out.x = dx / l; out.z = dz / l; return true;
  }

  return {
    HW, HH, walls, cratesDef, padsDef, pylonsDef: PYLONS, rect,
    buildStatic, circleRect, pushOut, segRect, rebuildNav, field, flowDir,
    get navVersion() { return navVersion; },
    isBlocked(x, z) { return !!blocked[cellOf(x, z)]; },
  };
})();
