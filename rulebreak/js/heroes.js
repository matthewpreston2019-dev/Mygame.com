// heroes.js — hero definitions and procedural models
const HEROES = {
  vex: {
    id: 'vex', name: 'VEX', title: 'GRAVITY BREAKER', role: 'Close-range bruiser',
    color: 0xb06bff, css: '#b06bff', light: 0xe2c8ff,
    hp: 170, speed: 4.6, pref: 0.55,
    stats: { Health: 0.95, Speed: 0.45, Range: 0.4, Damage: 0.85 },
    attack: { name: 'Shard Burst', desc: 'Fires a wide fan of five gravity shards. Devastating up close.',
      pellets: 5, spread: 0.5, dmg: 12, speed: 19, range: 7.5, ammo: 3, reload: 1.35, cd: 0.42, size: 0.55 },
    move: { name: 'Ram', desc: 'Charge forward, bulldozing and knocking back enemies in your path.', cd: 4.5 },
    rule: { name: 'UPFALL', icon: '⇡', desc: 'Inverts gravity in a target zone. Enemies inside float helplessly, enemy shots fall into the sky, then everyone caught slams down for damage.',
      cd: 12, range: 9, radius: 3.4, dur: 2.4, targeted: true },
  },
  mirra: {
    id: 'mirra', name: 'MIRRA', title: 'PARADOX TWIN', role: 'Agile skirmisher',
    color: 0x3ef0d0, css: '#3ef0d0', light: 0xc8fff5,
    hp: 130, speed: 5.4, pref: 0.75,
    stats: { Health: 0.65, Speed: 0.72, Range: 0.65, Damage: 0.6 },
    attack: { name: 'Twin Bolts', desc: 'Rapid paired bolts. High fire rate, steady damage.',
      dmg: 11, speed: 24, range: 10, ammo: 3, reload: 1.0, cd: 0.28, size: 0.5 },
    move: { name: 'Blink', desc: 'Instantly teleport a short distance in the direction you are moving.', cd: 3.5 },
    rule: { name: 'ECHO', icon: '◐', desc: 'Splits reality: a Twin appears that copies your every move and shot. Press again to swap places with it. It detonates when it fades.',
      cd: 11, dur: 6, targeted: false },
  },
  prism: {
    id: 'prism', name: 'PRISM', title: 'LIGHT BENDER', role: 'Long-range marksman',
    color: 0xffc23d, css: '#ffc23d', light: 0xfff0c0,
    hp: 110, speed: 5.9, pref: 0.82,
    stats: { Health: 0.45, Speed: 0.9, Range: 0.95, Damage: 0.75 },
    attack: { name: 'Lance', desc: 'A fast, piercing beam of light that hits hard at long range.',
      dmg: 30, speed: 30, range: 13, ammo: 3, reload: 1.3, cd: 0.5, size: 0.7 },
    move: { name: 'Glide', desc: 'Skate on light at high speed. Refunds one Lance charge.', cd: 3 },
    rule: { name: 'BENDLIGHT', icon: '↯', desc: 'For 5 seconds light stops travelling straight: your shots curve around walls and corners to hunt the nearest enemy, and you reload twice as fast.',
      cd: 13, dur: 5, targeted: false },
  },
};
const HERO_ORDER = ['vex', 'mirra', 'prism'];

const HeroModels = (() => {
  const G = {};
  function geo(key, make) { return G[key] || (G[key] = make()); }

  function build(id, teamColor, ghost = false) {
    const h = HEROES[id];
    const root = new THREE.Group(), tilt = new THREE.Group(), body = new THREE.Group();
    root.add(tilt); tilt.add(body);
    const mats = [], spinners = [];

    const lam = (color, emissive = 0x000000) => {
      const m = new THREE.MeshLambertMaterial({ color, emissive });
      if (ghost) { m.transparent = true; m.opacity = 0.5; m.emissive.set(h.color).multiplyScalar(0.5); }
      m.userData.base = m.emissive.clone();
      mats.push(m); return m;
    };
    const glow = (color) => {
      const m = new THREE.MeshBasicMaterial({ color });
      if (ghost) { m.transparent = true; m.opacity = 0.7; }
      return m;
    };
    const add = (g, m, x, y, z, parent = body) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); parent.add(o); return o; };

    // ground: shadow + team ring
    const shadow = new THREE.Mesh(geo('plane', () => new THREE.PlaneGeometry(1.8, 1.8)),
      new THREE.MeshBasicMaterial({ map: FX.shadowTex, transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.02; root.add(shadow);
    const ring = new THREE.Mesh(geo('teamring', () => new THREE.RingGeometry(0.62, 0.78, 40)),
      new THREE.MeshBasicMaterial({ color: teamColor, transparent: true, opacity: ghost ? 0.45 : 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04; root.add(ring);

    const dark = 0x1c1a33;
    if (id === 'vex') {
      add(geo('vexTorso', () => new THREE.CapsuleGeometry(0.42, 0.42, 4, 14)), lam(0x6a49b8), 0, 0.78, 0);
      add(geo('vexCore', () => new THREE.SphereGeometry(0.15, 12, 10)), glow(0xe8d0ff), 0, 0.86, 0.38);
      const sh = geo('vexShoulder', () => new THREE.BoxGeometry(0.36, 0.3, 0.46));
      add(sh, lam(dark, 0x150c2a), 0.5, 1.08, 0); add(sh, lam(dark, 0x150c2a), -0.5, 1.08, 0);
      add(geo('vexHead', () => new THREE.SphereGeometry(0.27, 16, 12)), lam(0x7d5bd0), 0, 1.45, 0);
      add(geo('vexVisor', () => new THREE.BoxGeometry(0.42, 0.1, 0.14)), glow(0xf0e0ff), 0, 1.47, 0.2);
      const orbit = new THREE.Group(); orbit.position.y = 0.95; body.add(orbit);
      const og = geo('orb', () => new THREE.SphereGeometry(0.11, 10, 8));
      add(og, glow(0xd5a8ff), 0.82, 0, 0, orbit); add(og, glow(0xd5a8ff), -0.82, 0, 0, orbit);
      spinners.push((t) => { orbit.rotation.y = t * 3; orbit.rotation.z = Math.sin(t * 1.3) * 0.4; });
      const gun = add(geo('vexGun', () => new THREE.BoxGeometry(0.3, 0.3, 0.55)), lam(dark, 0x1a0d33), 0.42, 0.82, 0.32);
      add(geo('vexTip', () => new THREE.BoxGeometry(0.22, 0.22, 0.08)), glow(h.color), 0, 0, 0.3, gun);
    } else if (id === 'mirra') {
      add(geo('mirTorso', () => new THREE.CapsuleGeometry(0.3, 0.5, 4, 14)), lam(0x1e8c84), 0, 0.85, 0);
      add(geo('mirSkirt', () => new THREE.ConeGeometry(0.44, 0.62, 14, 1, true)), lam(0x123a48, 0x041a1a), 0, 0.5, 0).material.side = THREE.DoubleSide;
      add(geo('mirHead', () => new THREE.SphereGeometry(0.25, 16, 12)), lam(0x2fb3a7), 0, 1.47, 0);
      add(geo('mirVisor', () => new THREE.BoxGeometry(0.36, 0.07, 0.12)), glow(0xd0fff8), 0, 1.49, 0.19);
      const halo = add(geo('mirHalo', () => new THREE.TorusGeometry(0.36, 0.035, 8, 36)), glow(h.color), 0, 1.5, -0.16);
      spinners.push((t) => { halo.rotation.z = t * 1.5; halo.scale.setScalar(1 + Math.sin(t * 4) * 0.05); });
      const sg = geo('shard', () => new THREE.OctahedronGeometry(0.12));
      const s1 = add(sg, glow(0x9ffff0), 0.55, 1.15, 0), s2 = add(sg, glow(0x9ffff0), -0.55, 1.15, 0);
      spinners.push((t) => { s1.position.y = 1.15 + Math.sin(t * 3) * 0.1; s2.position.y = 1.15 - Math.sin(t * 3) * 0.1; s1.rotation.y = s2.rotation.y = t * 2; });
      const bg = geo('mirGun', () => new THREE.BoxGeometry(0.09, 0.09, 0.5));
      add(bg, glow(h.color), 0.26, 0.9, 0.36); add(bg, glow(h.color), -0.26, 0.9, 0.36);
    } else {
      add(geo('priTorso', () => new THREE.CapsuleGeometry(0.29, 0.66, 4, 14)), lam(0x9a7424), 0, 0.86, 0);
      add(geo('priBelt', () => new THREE.CylinderGeometry(0.31, 0.31, 0.08, 16)), glow(0xffd36b), 0, 0.72, 0);
      const pad = geo('priPad', () => new THREE.ConeGeometry(0.18, 0.3, 4));
      add(pad, lam(dark, 0x2a1d05), 0.36, 1.22, 0).rotation.z = -0.6;
      add(pad, lam(dark, 0x2a1d05), -0.36, 1.22, 0).rotation.z = 0.6;
      add(geo('priHead', () => new THREE.OctahedronGeometry(0.27, 0)), lam(0xc9a040, 0x3a2a00), 0, 1.58, 0);
      add(geo('priVisor', () => new THREE.BoxGeometry(0.3, 0.06, 0.1)), glow(0xfff6d0), 0, 1.6, 0.17);
      const pr = add(geo('priPrism', () => { const g = new THREE.OctahedronGeometry(0.18); g.scale(1, 1.8, 1); return g; }), glow(0xfff0a0), 0, 2.12, 0);
      spinners.push((t) => { pr.rotation.y = t * 2.4; pr.position.y = 2.12 + Math.sin(t * 2.2) * 0.08; });
      const gun = add(geo('priGun', () => new THREE.BoxGeometry(0.11, 0.13, 0.95)), lam(dark, 0x221800), 0.3, 0.98, 0.42);
      add(geo('priGunLine', () => new THREE.BoxGeometry(0.04, 0.04, 0.9)), glow(h.color), 0, 0.08, 0, gun);
    }

    // ice shell shown while time-frozen
    const ice = new THREE.Mesh(geo('ice', () => new THREE.BoxGeometry(1.15, 2.0, 1.15)),
      new THREE.MeshLambertMaterial({ color: 0xa6ecff, emissive: 0x1d5a78, transparent: true, opacity: 0.45, depthWrite: false }));
    ice.position.y = 1.0; ice.visible = false; root.add(ice);

    return { root, tilt, body, mats, spinners, ring, ice, shadow, kick: 0, flash: 0 };
  }

  function setFlash(m, f) {
    if (m.flash === f) return;
    m.flash = f;
    for (const mat of m.mats) mat.emissive.copy(mat.userData.base).lerp(WHITE, f);
  }
  const WHITE = new THREE.Color(1, 1, 1);

  function dispose(m) {
    m.root.traverse((o) => { if (o.material) o.material.dispose(); });
  }

  return { build, setFlash, dispose };
})();
