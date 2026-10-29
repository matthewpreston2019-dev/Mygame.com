// game.js — simulation, abilities, bots, match flow, camera, HUD and menus
'use strict';

// ============================================================ constants
const TEAM_COL = [0x3fb8ff, 0xff4d6d], TEAM_CSS = ['#3fb8ff', '#ff4d6d'];
const SPAWN = [{ x: -19.5, z: 0 }, { x: 19.5, z: 0 }];
const ZONES = [{ x: 0, z: 0 }, { x: 0, z: -8 }, { x: 0, z: 8 }];
const ZONE_R = 3.4, MATCH_TIME = 180, ZONE_SHIFT = 40, WIN = 100, ZONE_RATE = 1.5, KO_PTS = 3, RESPAWN_T = 3.5;
const PROJ_Y = 0.95;
const DIFF = {
  easy: { aimErr: 0.2, react: 0.55, dodge: 0.06, turn: 5, lead: 0.3, think: 0.22, fireGate: 0.5, abil: 0.35 },
  normal: { aimErr: 0.1, react: 0.32, dodge: 0.25, turn: 9, lead: 0.75, think: 0.15, fireGate: 0.85, abil: 0.75 },
  hard: { aimErr: 0.04, react: 0.16, dodge: 0.55, turn: 16, lead: 1, think: 0.1, fireGate: 1, abil: 1 },
};
const BOT_NAMES = ['ZEPH', 'KORA', 'NYX-3', 'PELL', 'ROOK', 'QUILL', 'JUNO', 'SABLE', 'TEK', 'ORRI', 'VALE', 'MOTH'];

const settings = Object.assign({ difficulty: 'normal', sfx: true, music: true, shake: true, hero: 'vex' }, (() => {
  try { return JSON.parse(localStorage.getItem('rulebreak.settings')) || {}; } catch (e) { return {}; }
})());
function saveSettings() { try { localStorage.setItem('rulebreak.settings', JSON.stringify(settings)); } catch (e) { /* storage unavailable */ } }

// ============================================================ helpers
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
function angDiff(a, b) { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; }
function turnToward(a, b, max) { const d = angDiff(a, b); return a + clamp(d, -max, max); }
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; }
const V = { x: 0, z: 0 };
const tmpCol = new THREE.Color();
const $ = (id) => document.getElementById(id);

// ============================================================ renderer / scene
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
renderer.autoClear = false;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07061a);
scene.fog = new THREE.Fog(0x07061a, 48, 120);
const camera = new THREE.PerspectiveCamera(42, 1, 0.5, 300);
scene.add(new THREE.HemisphereLight(0x9aa6ff, 0x2a1240, 0.95));
const sun = new THREE.DirectionalLight(0xffffff, 0.75); sun.position.set(6, 12, 5); scene.add(sun);
FX.init(scene);
const arenaFx = ARENA.buildStatic(scene);

// ============================================================ interactive arena objects
const crateGeo = new THREE.BoxGeometry(1.3, 1.1, 1.3), bandGeo = new THREE.BoxGeometry(1.34, 0.07, 1.34);
const crates = ARENA.cratesDef.map(([x, z]) => {
  const s = ARENA.rect(x, z, 1.3, 1.3, 'crate');
  const g = new THREE.Group(); g.position.set(x, 0, z);
  const mat = new THREE.MeshLambertMaterial({ color: 0x3b2c55, emissive: 0x000000 });
  const box = new THREE.Mesh(crateGeo, mat); box.position.y = 0.55; g.add(box);
  const band = new THREE.MeshBasicMaterial({ color: 0xffb13d });
  [0.3, 0.8].forEach((y) => { const b = new THREE.Mesh(bandGeo, band); b.position.y = y; g.add(b); });
  scene.add(g);
  Object.assign(s, { mesh: g, box, mat, hp: 70, max: 70, shake: 0 });
  return s;
});

const pylons = ARENA.pylonsDef.map(([x, z]) => {
  const s = ARENA.rect(x, z, 1, 1, 'pylon');
  const g = new THREE.Group(); g.position.set(x, 0, z);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.7, 0.45, 6), new THREE.MeshLambertMaterial({ color: 0x1d2a4a, emissive: 0x06101e }));
  base.position.y = 0.22; g.add(base);
  const crystalMat = new THREE.MeshLambertMaterial({ color: 0x9feaff, emissive: 0x2a8ab8, transparent: true, opacity: 0.92 });
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.42, 0), crystalMat); crystal.scale.set(1, 1.9, 1); crystal.position.y = 1.35; g.add(crystal);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: FX.glowTex, color: 0x5fd8ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.6 }));
  halo.scale.set(2.6, 2.6, 1); halo.position.y = 1.35; g.add(halo);
  const ring = new THREE.Mesh(new THREE.RingGeometry(4.0, 4.2, 64), new THREE.MeshBasicMaterial({ color: 0x5fd8ff, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03; g.add(ring);
  scene.add(g);
  Object.assign(s, { mesh: g, crystal, crystalMat, halo, ring, hp: 45, max: 45, state: 'ready', charge: 0, flash: 0 });
  return s;
});

const pads = ARENA.padsDef.map(([x, z, tx, tz]) => {
  const g = new THREE.Group(); g.position.set(x, 0, z);
  const add = (geo, color, op, y) => { const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.position.y = y; g.add(m); return m; };
  add(new THREE.CircleGeometry(0.95, 32), 0x8dff9e, 0.18, 0.02);
  const ring = add(new THREE.RingGeometry(0.82, 0.95, 32), 0x8dff9e, 0.9, 0.03);
  const arrows = new THREE.Group(); arrows.rotation.y = -Math.atan2(tz - z, tx - x); g.add(arrows);
  const chev = new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(-0.15, -0.35), new THREE.Vector2(0.2, 0), new THREE.Vector2(-0.15, 0.35), new THREE.Vector2(-0.02, 0)]));
  chev.rotateX(-Math.PI / 2);
  const chevs = [];
  for (let i = 0; i < 3; i++) {
    const m = new THREE.Mesh(chev, new THREE.MeshBasicMaterial({ color: 0xc8ffd0, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.position.set(-0.35 + i * 0.32, 0.05, 0); arrows.add(m); chevs.push(m);
  }
  scene.add(g);
  const land = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.8, 32), new THREE.MeshBasicMaterial({ color: 0x8dff9e, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false }));
  land.rotation.x = -Math.PI / 2; land.position.set(tx, 0.03, tz); scene.add(land);
  return { x, z, tx, tz, ring, chevs };
});

// ---- the Rift (capture zone)
const zoneU = { uTime: { value: 0 }, uColor: { value: new THREE.Color(0xb59bff) }, uAlpha: { value: 1 } };
const zoneDisc = new THREE.Mesh(new THREE.CircleGeometry(ZONE_R, 72), new THREE.ShaderMaterial({
  uniforms: zoneU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  vertexShader: `varying vec2 vL; void main(){ vL = position.xy / ${ZONE_R.toFixed(2)}; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    varying vec2 vL; uniform float uTime; uniform vec3 uColor; uniform float uAlpha;
    void main(){
      float r = length(vL), a = atan(vL.y, vL.x);
      float edge = smoothstep(0.86, 0.97, r) * (1.0 - smoothstep(0.97, 1.0, r));
      float dash = 0.55 + 0.45 * step(0.5, fract(a * 3.8197 + uTime * 0.25));
      float swirl = 0.5 + 0.5 * sin(a * 5.0 + r * 13.0 - uTime * 2.6);
      float inner = smoothstep(0.62, 0.6, r) * smoothstep(0.55, 0.6, r);
      float fill = (0.07 + 0.09 * swirl) * smoothstep(1.0, 0.15, r);
      float v = edge * 1.6 * dash + fill + inner * 0.5;
      gl_FragColor = vec4(uColor * v * uAlpha, 1.0);
    }`,
}));
zoneDisc.rotation.x = -Math.PI / 2; zoneDisc.position.y = 0.035; scene.add(zoneDisc);
const zonePillar = new THREE.Mesh(new THREE.CylinderGeometry(ZONE_R, ZONE_R, 7, 64, 1, true), new THREE.ShaderMaterial({
  uniforms: zoneU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `varying vec2 vUv; uniform float uTime; uniform vec3 uColor; uniform float uAlpha;
    void main(){ float a = pow(1.0 - vUv.y, 2.5) * 0.22; a *= 0.75 + 0.25 * sin(vUv.x * 62.83 + uTime * 3.0 + vUv.y * 10.0); gl_FragColor = vec4(uColor * a * uAlpha, 1.0); }`,
}));
zonePillar.position.y = 3.5; scene.add(zonePillar);
const zoneGhost = new THREE.Mesh(new THREE.RingGeometry(ZONE_R - 0.12, ZONE_R, 72), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
zoneGhost.rotation.x = -Math.PI / 2; zoneGhost.position.y = 0.04; scene.add(zoneGhost);

// ---- player aim helpers
const aimMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false });
const aimMesh = new THREE.Mesh(new THREE.BufferGeometry(), aimMat); aimMesh.position.y = 0.05; aimMesh.visible = false; scene.add(aimMesh);
const rulePreview = new THREE.Group(); rulePreview.visible = false; scene.add(rulePreview);
const rpRing = new THREE.Mesh(new THREE.RingGeometry(3.25, 3.4, 64), new THREE.MeshBasicMaterial({ color: 0xc9a2ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
const rpFill = new THREE.Mesh(new THREE.CircleGeometry(3.25, 64), new THREE.MeshBasicMaterial({ color: 0x8a4bff, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false }));
[rpRing, rpFill].forEach((m) => { m.rotation.x = -Math.PI / 2; m.position.y = 0.06; rulePreview.add(m); });
const rpRange = new THREE.Mesh(new THREE.RingGeometry(8.9, 9, 96), new THREE.MeshBasicMaterial({ color: 0xc9a2ff, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false }));
rpRange.rotation.x = -Math.PI / 2; rpRange.position.y = 0.05; rpRange.visible = false; scene.add(rpRange);

function buildAimGeo(hero) {
  const A = hero.attack;
  if (hero.id === 'vex') { const g = new THREE.CircleGeometry(A.range, 24, -A.spread / 2 - 0.05, A.spread + 0.1); g.rotateX(-Math.PI / 2); return g; }
  const g = new THREE.PlaneGeometry(A.range - 0.6, hero.id === 'mirra' ? 0.55 : 0.28); g.translate((A.range - 0.6) / 2 + 0.6, 0, 0); g.rotateX(-Math.PI / 2); return g;
}

// ============================================================ projectiles
const projs = [];
for (let i = 0; i < 240; i++) {
  const group = new THREE.Group(); group.visible = false;
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: FX.glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: FX.glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  group.add(glow); group.add(core); scene.add(group);
  projs.push({ active: false, group, glow, core, hitSet: new Set() });
}
let projCursor = 0;

// ============================================================ state
const S = {
  units: [], fields: [], pops: [], solids: [],
  time: 0, clock: MATCH_TIME, score: [0, 0], kos: [0, 0],
  zone: { i: 0, x: 0, z: 0, next: 1, alpha: 1 }, shiftT: ZONE_SHIFT, warned: false,
  running: false, demo: true, over: false, overT: 0, countdown: 0, paused: false,
  player: null, trauma: 0, hitstop: 0, lastCount: 0, mode: 'menu', zoneOwner: -2,
};

// ============================================================ fields & navigation
const fieldCache = {};
function cachedField(key, x, z, maxAge) {
  const c = fieldCache[key];
  if (c && c.f.v === ARENA.navVersion && S.time - c.t < maxAge) return c.f;
  const f = ARENA.field(x, z);
  fieldCache[key] = { f, t: S.time };
  return f;
}
const zoneField = () => cachedField('zone' + S.zone.i, S.zone.x, S.zone.z, 1e9);
const spawnField = (team) => cachedField('spawn' + team, SPAWN[team].x, SPAWN[team].z, 1e9);
const unitField = (u) => cachedField('u' + u.id, Math.round(u.x), Math.round(u.z), 0.3);

function rebuildSolids() {
  S.solids = ARENA.walls.concat(crates.filter((c) => c.alive), pylons);
  ARENA.rebuildNav(S.solids);
}
function los(x0, z0, x1, z1) {
  for (const s of S.solids) if (ARENA.segRect(x0, z0, x1, z1, s, 0.05)) return false;
  return true;
}
function blockedAt(x, z, r) {
  if (Math.abs(x) > ARENA.HW - r || Math.abs(z) > ARENA.HH - r) return true;
  for (const s of S.solids) if (ARENA.circleRect(x, z, r, s)) return true;
  return false;
}
function inFreeze(x, z) {
  for (const f of S.fields) if (f.type === 'freeze' && f.t < f.dur && (x - f.x) ** 2 + (z - f.z) ** 2 < f.r * f.r) return true;
  return false;
}

// ============================================================ units
let uidSeq = 1;
function createUnit(heroId, team, o = {}) {
  const h = HEROES[heroId];
  const model = HeroModels.build(heroId, TEAM_COL[team], !!o.clone);
  scene.add(model.root);
  const u = {
    id: uidSeq++, hero: h, heroId, team, name: o.name || h.name, isPlayer: !!o.player, isClone: !!o.clone, owner: o.owner || null,
    x: o.x || 0, z: o.z || 0, y: 0, vy: 0, vx: 0, vz: 0, kx: 0, kz: 0, r: 0.52,
    hp: h.hp, maxHp: h.hp, shownHp: h.hp, ammo: h.attack.ammo, reloadT: 0, fireCd: 0, moveCd: 0, ruleCd: h.rule.cd * 0.45,
    alive: true, respawnT: 0, invuln: 0, flash: 0, lastHurt: -99, lastFire: -99, yaw: team === 0 ? Math.PI / 2 : -Math.PI / 2,
    lifted: null, frozen: false, air: null, dash: null, padCd: 0, clone: null, bendT: 0, life: 0, animT: Math.random() * 10,
    slamFx: false, swapT: 0, wasReady: false,
    intent: { mx: 0, mz: 0, ax: team === 0 ? 1 : -1, az: 0, tx: 0, tz: 0, fire: false, move: false, rule: false },
    ai: null, model, stats: { ko: 0, deaths: 0, dmg: 0, rules: 0, zoneT: 0 },
  };
  if (o.bot) {
    u.ai = { D: DIFF[o.diff || 'normal'], thinkT: Math.random() * 0.2, react: 0, target: null, tvis: false, retreat: false,
      mx: 0, mz: 0, aimX: u.x + (team ? -3 : 3), aimZ: u.z, aimA: team === 0 ? 0 : Math.PI, wantFire: false, wantMove: false, wantRule: false,
      moveX: 0, moveZ: 0, strafe: 1, strafeT: 0, wanderT: 0, wx: 0, wz: 0, lx: u.x, lz: u.z, stuckT: 0, unstickT: 0, unstickA: 0, dodgeT: 0 };
  }
  S.units.push(u);
  return u;
}

function removeUnit(u) {
  scene.remove(u.model.root);
  HeroModels.dispose(u.model);
  u.removed = true;
}

function respawn(u) {
  const sp = SPAWN[u.team];
  const slot = S.units.filter((o) => o.team === u.team && !o.isClone).indexOf(u);
  u.x = sp.x + (slot === 0 ? 0 : (u.team ? -1 : 1)); u.z = sp.z + (slot === 0 ? 0 : slot === 1 ? -2.2 : 2.2);
  Object.assign(u, { hp: u.maxHp, shownHp: u.maxHp, ammo: u.hero.attack.ammo, reloadT: 0, alive: true, invuln: 1.6, vx: 0, vz: 0, kx: 0, kz: 0, y: 0, vy: 0,
    lifted: null, dash: null, air: null, frozen: false, bendT: 0, lastHurt: -99 });
  u.model.root.visible = true;
  FX.ring(u.x, u.z, TEAM_COL[u.team], 0.3, 2.4, 0.6);
  FX.burst(u.x, 0.8, u.z, u.hero.color, 24, 5, 0.35, 0.6, { up: 1.5 });
  if (u.isPlayer) $('respawn').classList.add('hidden');
}

// ---------- combat
function addShake(a) { if (settings.shake) S.trauma = Math.min(1, S.trauma + a); }
function popText(x, y, z, text, color, big) { S.pops.push({ x, y, z, text, color, big: !!big, t: 0 }); }
function volAt(x, z) { const d = Math.hypot(x - camFocus.x, z - camFocus.z); return S.demo ? 0.25 * clamp(1 - d / 40, 0, 1) : clamp(1.15 - d / 26, 0.08, 1); }

function damage(u, amt, src) {
  if (!u.alive || u.invuln > 0 || u.air || S.over) return;
  u.hp -= amt; u.lastHurt = S.time; u.flash = 1;
  if (src && src !== u) {
    src.stats.dmg += amt;
    if (src.ruleCd > 0) src.ruleCd = Math.max(0, src.ruleCd - amt * 0.022);
  }
  if (src && src.isPlayer) { popText(u.x, u.y + 1.9, u.z, Math.round(amt), '#fff7c2', amt >= 25); Sound.sfx.hit(); }
  else if (u.isPlayer) { popText(u.x, u.y + 1.9, u.z, Math.round(amt), '#ff6b85'); Sound.sfx.hurt(); addShake(0.22); }
  if (u.hp <= 0) kill(u, src);
}

function kill(u, src) {
  u.hp = 0;
  const col = u.hero.color;
  FX.burst(u.x, 0.9 + u.y, u.z, col, 46, 11, 0.5, 0.9, { grav: 9, drag: 2, up: 1 });
  FX.burst(u.x, 0.9 + u.y, u.z, 0xffffff, 18, 7, 0.35, 0.5);
  FX.ring(u.x, u.z, TEAM_COL[u.team], 0.2, 3.6, 0.55);
  if (u.isClone) { cloneGone(u, false); return; }
  u.alive = false; u.respawnT = RESPAWN_T; u.lifted = null; u.dash = null; u.air = null;
  u.model.root.visible = false;
  u.stats.deaths++;
  if (u.clone) cloneGone(u.clone, false);
  const killer = src && src.team !== u.team ? src : null;
  if (killer) {
    killer.stats.ko++; S.kos[killer.team]++;
    if (!S.over) S.score[killer.team] = Math.min(WIN, S.score[killer.team] + KO_PTS);
  }
  Sound.sfx.ko(volAt(u.x, u.z));
  if (!S.demo) killFeed(killer, u);
  if (u.isPlayer) { addShake(0.6); $('respawn').classList.remove('hidden'); }
  if (killer && killer.isPlayer) { S.hitstop = 0.07; addShake(0.35); popText(u.x, 2.6, u.z, 'KNOCKOUT', '#ffd84d', true); }
}

function killFeed(k, v) {
  const el = document.createElement('div'); el.className = 'kf';
  const nm = (u) => `<span style="color:${u.isPlayer ? '#5dff8a' : TEAM_CSS[u.team]}">${u.isPlayer ? 'YOU' : u.name}</span>`;
  el.style.setProperty('--c', TEAM_CSS[k ? k.team : 1 - v.team]);
  el.innerHTML = k ? `${nm(k)}<span class="x">✦</span>${nm(v)}` : `${nm(v)}<span class="x">✦ fell</span>`;
  const feed = $('killfeed'); feed.prepend(el);
  while (feed.children.length > 5) feed.lastChild.remove();
  setTimeout(() => el.classList.add('out'), 3600);
  setTimeout(() => el.remove(), 4100);
}

// ---------- attacks
function spawnProj(src, team, x, z, dx, dz, o) {
  let p = null;
  for (let i = 0; i < projs.length; i++) { const q = projs[(projCursor + i) % projs.length]; if (!q.active) { p = q; projCursor = (projCursor + i + 1) % projs.length; break; } }
  if (!p) return;
  Object.assign(p, { active: true, src, team, x, z, y: PROJ_Y, speed: o.speed, vx: dx * o.speed, vz: dz * o.speed, dmg: o.dmg, life: o.range / o.speed,
    r: o.r || 0.22, kind: o.kind, bend: !!o.bend, pierce: !!o.pierce, rising: 0, target: null, retarget: 0, trail: o.trail, knock: o.knock || 0, frozen: false });
  p.hitSet.clear();
  p.glow.material.color.set(o.glow); p.glow.material.opacity = 1;
  p.core.material.color.set(o.core); p.core.material.opacity = 1;
  const s = o.size;
  if (o.kind === 'prism') { p.glow.scale.set(s * 2.6, s * 1.1, 1); p.core.scale.set(s * 1.8, s * 0.45, 1); }
  else { p.glow.scale.set(s * 1.7, s * 1.7, 1); p.core.scale.set(s * 0.7, s * 0.7, 1); }
  p.group.position.set(x, PROJ_Y, z);
  p.group.visible = true;
}

function fire(u, fromClone) {
  const h = u.hero, A = h.attack, I = u.intent;
  const shooter = fromClone || u;
  let ax = I.ax, az = I.az;
  if (fromClone) { // twin converges on the owner's aim point
    const dx = I.tx - shooter.x, dz = I.tz - shooter.z, l = Math.hypot(dx, dz);
    if (l > 0.5) { ax = dx / l; az = dz / l; }
  } else {
    u.ammo -= 1; u.fireCd = A.cd; u.lastFire = S.time;
  }
  const credit = u;
  const mul = fromClone ? 0.6 : 1;
  let mx = shooter.x + ax * 0.6, mz = shooter.z + az * 0.6;
  if (!los(shooter.x, shooter.z, mx, mz)) { mx = shooter.x; mz = shooter.z; }
  const glow = TEAM_COL[u.team], base = Math.atan2(az, ax);
  if (h.id === 'vex') {
    for (let i = 0; i < A.pellets; i++) {
      const a = base + (i / (A.pellets - 1) - 0.5) * A.spread + rand(-0.04, 0.04);
      spawnProj(credit, u.team, mx, mz, Math.cos(a), Math.sin(a), { speed: A.speed * rand(0.92, 1.08), dmg: A.dmg * mul, range: A.range * rand(0.9, 1.05), size: A.size, glow, core: h.light, kind: 'vex', trail: h.color, knock: 1.6 });
    }
    if (!fromClone) { u.kx -= ax * 2.5; u.kz -= az * 2.5; }
  } else if (h.id === 'mirra') {
    const px = -az, pz = ax;
    [-0.2, 0.2].forEach((o) => spawnProj(credit, u.team, mx + px * o, mz + pz * o, ax, az, { speed: A.speed, dmg: A.dmg * mul, range: A.range, size: A.size, glow, core: h.light, kind: 'mirra', trail: h.color }));
  } else {
    const bend = u.bendT > 0;
    spawnProj(credit, u.team, mx, mz, ax, az, { speed: bend ? 19 : A.speed, dmg: A.dmg * mul, range: bend ? 19 : A.range, size: A.size * (bend ? 1.2 : 1), glow: bend ? 0xffe58a : glow, core: 0xffffff, kind: 'prism', trail: h.color, bend, pierce: true, r: 0.26 });
  }
  shooter.model.kick = 1;
  FX.spray(mx, PROJ_Y, mz, ax, az, h.color, 6, 7, 0.8, 0.3, 0.18, { drag: 8 });
  Sound.sfx.shoot(h.id, volAt(shooter.x, shooter.z) * (fromClone ? 0.6 : 1));
  if (!fromClone && u.clone && u.clone.alive) fire(u, u.clone);
}

function doMove(u) {
  const h = u.hero, I = u.intent;
  let dx = I.mx, dz = I.mz;
  if (Math.abs(dx) + Math.abs(dz) < 0.01) { dx = I.ax; dz = I.az; }
  const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
  u.moveCd = h.move.cd;
  const v = volAt(u.x, u.z);
  if (h.id === 'vex') {
    u.dash = { kind: 'ram', t: 0.24, speed: 24, dx, dz, hit: new Set() };
    FX.ring(u.x, u.z, h.color, 0.3, 1.8, 0.35);
    if (v > 0.1) Sound.sfx.dash();
  } else if (h.id === 'mirra') {
    let tx = u.x, tz = u.z;
    for (let s = 0.15; s <= 4.6; s += 0.15) { const nx = u.x + dx * s, nz = u.z + dz * s; if (blockedAt(nx, nz, u.r)) break; tx = nx; tz = nz; }
    FX.burst(u.x, 0.9, u.z, h.color, 22, 4, 0.4, 0.45, { up: 0.5 });
    FX.ring(u.x, u.z, h.color, 1.2, 0.1, 0.3);
    for (let k = 0; k < 8; k++) { const f = k / 8; FX.emit(u.x + (tx - u.x) * f, 0.9, u.z + (tz - u.z) * f, 0, 0.3, 0, h.color, 0.6, 0.3, { drag: 0 }); }
    u.x = tx; u.z = tz; u.invuln = Math.max(u.invuln, 0.12);
    FX.burst(u.x, 0.9, u.z, 0xffffff, 18, 5, 0.35, 0.4);
    FX.ring(u.x, u.z, h.color, 0.1, 1.6, 0.35);
    if (v > 0.1) Sound.sfx.blink();
  } else {
    u.dash = { kind: 'glide', t: 0.38, speed: 15, dx, dz };
    u.ammo = Math.min(h.attack.ammo, u.ammo + 1);
    if (v > 0.1) Sound.sfx.glide();
  }
}

function doRule(u) {
  const h = u.hero;
  if (h.id === 'mirra' && u.clone && u.clone.alive) {
    if (S.time - u.swapT > 0.35) swapClone(u);
    return;
  }
  if (u.ruleCd > 0) return;
  u.ruleCd = h.rule.cd; u.stats.rules++;
  const v = volAt(u.x, u.z);
  if (v > 0.1) Sound.sfx.rule(h.id);
  if (h.id === 'vex') {
    let tx = u.intent.tx - u.x, tz = u.intent.tz - u.z;
    const l = Math.hypot(tx, tz);
    if (l > h.rule.range) { tx *= h.rule.range / l; tz *= h.rule.range / l; }
    createUpfall(u, u.x + tx, u.z + tz);
  } else if (h.id === 'mirra') {
    spawnClone(u);
  } else {
    u.bendT = h.rule.dur;
    FX.ring(u.x, u.z, 0xffe58a, 0.3, 4.5, 0.6);
    for (let i = 0; i < 40; i++) { const c = new THREE.Color().setHSL(Math.random(), 1, 0.65); FX.burst(u.x, 1, u.z, c, 1, 8, 0.4, 0.7, { up: 0.6 }); }
  }
  if (u.isPlayer) { const el = $('abRule'); el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); addShake(0.15); }
}

// ---------- Mirra's Echo
function spawnClone(u) {
  const px = -u.intent.az, pz = u.intent.ax;
  let x = u.x + px * 1.1, z = u.z + pz * 1.1;
  if (blockedAt(x, z, u.r)) { x = u.x - px * 1.1; z = u.z - pz * 1.1; }
  if (blockedAt(x, z, u.r)) { x = u.x; z = u.z; }
  const c = createUnit('mirra', u.team, { clone: true, owner: u, x, z, name: 'ECHO' });
  c.hp = c.maxHp = c.shownHp = 60; c.life = u.hero.rule.dur; c.yaw = u.yaw; c.invuln = 0.2;
  u.clone = c;
  FX.burst(x, 1, z, u.hero.color, 34, 6, 0.45, 0.6, { up: 0.8 });
  FX.ring(x, z, u.hero.color, 0.2, 2.2, 0.45);
}
function swapClone(u) {
  const c = u.clone;
  u.swapT = S.time;
  [u.x, c.x] = [c.x, u.x]; [u.z, c.z] = [c.z, u.z];
  for (const o of [u, c]) { FX.burst(o.x, 1, o.z, u.hero.color, 18, 5, 0.4, 0.4); FX.ring(o.x, o.z, 0xffffff, 1.5, 0.1, 0.3); }
  u.invuln = Math.max(u.invuln, 0.15);
  if (volAt(u.x, u.z) > 0.1) Sound.sfx.blink();
}
function cloneGone(c, explode) {
  if (c.removed) return;
  c.alive = false;
  if (explode) {
    FX.burst(c.x, 0.9, c.z, c.hero.color, 50, 10, 0.5, 0.7, { grav: 4 });
    FX.ring(c.x, c.z, c.hero.color, 0.2, 2.8, 0.45);
    for (const e of S.units) if (e.alive && e.team !== c.team && !e.air && Math.hypot(e.x - c.x, e.z - c.z) < 2.8) damage(e, 22, c.owner);
    Sound.sfx.ko(volAt(c.x, c.z) * 0.6);
  }
  if (c.owner && c.owner.clone === c) c.owner.clone = null;
  removeUnit(c);
}

// ---------- Vex's Upfall and the arena's freeze fields
const fieldDiscGeo = new THREE.CircleGeometry(1, 64);
function makeFieldVisual(r, color, kind) {
  const g = new THREE.Group();
  const u = { uTime: { value: 0 }, uColor: { value: new THREE.Color(color) }, uAlpha: { value: 0 } };
  const disc = new THREE.Mesh(fieldDiscGeo, new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `varying vec2 vL; void main(){ vL = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `varying vec2 vL; uniform float uTime; uniform vec3 uColor; uniform float uAlpha;
      void main(){ float r = length(vL); float edge = smoothstep(0.88,0.98,r) * (1.0 - smoothstep(0.98,1.0,r));
        float rip = 0.5 + 0.5 * sin(r * 26.0 ${kind === 'upfall' ? '+' : '-'} uTime * 7.0);
        float v = edge * 1.8 + (0.12 + 0.18 * rip) * smoothstep(1.0, 0.0, r);
        gl_FragColor = vec4(uColor * v * uAlpha, 1.0); }`,
  }));
  disc.rotation.x = -Math.PI / 2; disc.position.y = 0.05; disc.scale.setScalar(r); g.add(disc);
  if (kind === 'upfall') {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 6, 48, 1, true), new THREE.ShaderMaterial({
      uniforms: u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying vec2 vUv; uniform float uTime; uniform vec3 uColor; uniform float uAlpha;
        void main(){ float s = step(0.82, fract(vUv.y * 5.0 - uTime * 2.2 + sin(vUv.x * 62.83) * 0.08));
          float a = (0.12 + s * 0.5) * pow(1.0 - vUv.y, 1.4) * (0.6 + 0.4 * sin(vUv.x * 125.6));
          gl_FragColor = vec4(uColor * a * uAlpha, 1.0); }`,
    }));
    col.position.y = 3; g.add(col);
  } else {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(r, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.ShaderMaterial({
      uniforms: u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vP = position; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP; uniform float uTime; uniform vec3 uColor; uniform float uAlpha;
        void main(){ float f = pow(1.0 - abs(dot(vN, vV)), 2.2);
          vec3 q = vP * 2.2; float hex = step(0.92, max(abs(fract(q.x + q.y * 0.5) - 0.5), abs(fract(q.z - q.y * 0.5) - 0.5)) * 2.0);
          float a = f * 0.9 + hex * 0.15 + 0.04;
          gl_FragColor = vec4(uColor * a * uAlpha, 1.0); }`,
    }));
    g.add(dome);
  }
  scene.add(g);
  return { g, u };
}

function createUpfall(u, x, z) {
  const r = u.hero.rule.radius;
  const vis = makeFieldVisual(r, 0xb06bff, 'upfall');
  vis.g.position.set(x, 0, z);
  S.fields.push({ type: 'upfall', x, z, r, t: 0, dur: u.hero.rule.dur, team: u.team, owner: u, vis, victims: [] });
  FX.ring(x, z, 0xd5a8ff, 0.2, r * 1.25, 0.6, 1);
  FX.burst(x, 0.3, z, 0xc59bff, 60, 7, 0.45, 1.2, { up: 3, vyMul: 1.4, drag: 1.5, grav: -2 });
  addShake(volAt(x, z) * 0.3);
}

function createFreeze(x, z) {
  const vis = makeFieldVisual(4.2, 0x7fe3ff, 'freeze');
  vis.g.position.set(x, 0, z);
  S.fields.push({ type: 'freeze', x, z, r: 4.2, t: 0, dur: 3.4, vis });
  FX.ring(x, z, 0xbff4ff, 0.3, 4.6, 0.5);
  for (let i = 0; i < 70; i++) { const a = Math.random() * Math.PI * 2, rr = Math.random() * 4; FX.emit(x + Math.cos(a) * rr, rand(0.2, 3), z + Math.sin(a) * rr, 0, rand(-0.3, 0.3), 0, 0xd8f8ff, rand(0.15, 0.4), rand(1.5, 3.2), { drag: 0 }); }
  if (volAt(x, z) > 0.3) Sound.sfx.freeze();
  addShake(volAt(x, z) * 0.25);
  if (!S.demo && volAt(x, z) > 0.3) popText(x, 3.2, z, 'TIME FROZEN', '#bff4ff', true);
}

function updateFields(dt) {
  for (const u of S.units) u.frozen = false;
  for (const f of S.fields) {
    f.t += dt;
    const fadeIn = clamp(f.t / 0.2, 0, 1), fadeOut = clamp((f.dur - f.t) / 0.3, 0, 1);
    f.vis.u.uTime.value = S.time; f.vis.u.uAlpha.value = Math.min(fadeIn, fadeOut);
    if (f.type === 'freeze') {
      for (const u of S.units) if (u.alive && !u.air && (u.x - f.x) ** 2 + (u.z - f.z) ** 2 < f.r * f.r) u.frozen = true;
      if (Math.random() < 0.5) { const a = Math.random() * 6.28, rr = Math.random() * f.r; FX.emit(f.x + Math.cos(a) * rr, rand(0.1, 2.5), f.z + Math.sin(a) * rr, 0, 0.1, 0, 0xc8f4ff, 0.25, 0.8, { drag: 0 }); }
    } else {
      if (f.t < f.dur) {
        for (const u of S.units) {
          if (!u.alive || u.team === f.team || u.air || u.lifted || u.invuln > 0) continue;
          if ((u.x - f.x) ** 2 + (u.z - f.z) ** 2 < (f.r + 0.2) ** 2) {
            u.lifted = f; u.dash = null; u.vy = 0; f.victims.push(u);
            FX.burst(u.x, 0.5, u.z, 0xd5a8ff, 14, 4, 0.35, 0.6, { up: 3 });
            if (u.isPlayer) addShake(0.2);
          }
        }
      }
      for (let i = 0; i < 2; i++) { const a = Math.random() * 6.28, rr = Math.sqrt(Math.random()) * f.r; FX.emit(f.x + Math.cos(a) * rr, 0.1, f.z + Math.sin(a) * rr, 0, rand(3, 7), 0, 0xc59bff, rand(0.2, 0.4), 0.8, { drag: 0.5 }); }
    }
    if (f.t >= f.dur && !f.done) {
      f.done = true;
      if (f.type === 'upfall') {
        for (const v of f.victims) {
          if (!v.alive || v.lifted !== f) continue;
          v.lifted = null; v.vy = -6; v.slamFx = true;
          damage(v, 28, f.owner);
        }
      }
    }
  }
  for (let i = S.fields.length - 1; i >= 0; i--) {
    const f = S.fields[i];
    if (f.t > f.dur + 0.35) { scene.remove(f.vis.g); f.vis.g.traverse((o) => { if (o.material) o.material.dispose(); if (o.geometry && o.geometry !== fieldDiscGeo) o.geometry.dispose(); }); S.fields.splice(i, 1); }
  }
}

// ---------- unit update
function collideUnit(u) {
  let hit = false;
  for (const s of S.solids) if (ARENA.pushOut(u, u.r, s)) hit = true;
  const hx = ARENA.HW - u.r, hz = ARENA.HH - u.r;
  if (u.x < -hx || u.x > hx || u.z < -hz || u.z > hz) { hit = true; u.x = clamp(u.x, -hx, hx); u.z = clamp(u.z, -hz, hz); }
  return hit;
}

function updateUnit(u, dt) {
  if (u.removed) return;
  if (!u.alive) {
    if (!u.isClone) { u.respawnT -= dt; if (u.respawnT <= 0 && !S.over) respawn(u); }
    return;
  }
  const h = u.hero, A = h.attack;
  u.flash = Math.max(0, u.flash - dt * 7);
  u.invuln = Math.max(0, u.invuln - dt);
  u.padCd -= dt;
  if (u.isClone) {
    if (!u.frozen) u.life -= dt;
    if (u.life <= 0 || !u.owner.alive) { cloneGone(u, u.owner.alive); return; }
  }

  if (u.air) {
    const a = u.air; a.t += dt;
    const k = Math.min(1, a.t / a.dur);
    u.x = a.sx + (a.tx - a.sx) * k; u.z = a.sz + (a.tz - a.sz) * k; u.y = 4 * 3.2 * k * (1 - k);
    if (Math.random() < 0.6) FX.emit(u.x, u.y + 0.5, u.z, 0, 0, 0, 0x8dff9e, 0.4, 0.4, { drag: 0 });
    if (k >= 1) {
      u.air = null; u.y = 0; u.padCd = 1;
      collideUnit(u);
      FX.ring(u.x, u.z, 0x8dff9e, 0.3, 2.2, 0.4); FX.burst(u.x, 0.2, u.z, 0xc8ffd0, 20, 6, 0.35, 0.5, { up: 0.2 });
      for (const e of S.units) if (e.alive && e.team !== u.team && Math.hypot(e.x - u.x, e.z - u.z) < 2) damage(e, 15, u);
      if (volAt(u.x, u.z) > 0.2) Sound.sfx.land();
      if (u.isPlayer) addShake(0.25);
    }
    return;
  }

  if (!u.frozen) {
    u.fireCd -= dt; u.moveCd -= dt; u.ruleCd -= dt; u.bendT -= dt;
    if (u.ammo < A.ammo) {
      u.reloadT += dt * (u.bendT > 0 ? 2 : 1);
      if (u.reloadT >= A.reload) { u.reloadT -= A.reload; u.ammo++; if (u.ammo >= A.ammo) u.reloadT = 0; }
    }
    if (!u.isClone && u.hp < u.maxHp && S.time - u.lastHurt > 3 && S.time - u.lastFire > 2) {
      u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.08 * dt);
      if (Math.random() < 0.15) FX.emit(u.x + rand(-0.4, 0.4), rand(0.4, 1.4), u.z + rand(-0.4, 0.4), 0, 1.2, 0, 0x6dff9a, 0.22, 0.6, { drag: 0 });
    }
    if (u.bendT > 0 && Math.random() < 0.7) FX.emit(u.x + rand(-0.5, 0.5), rand(0.3, 2), u.z + rand(-0.5, 0.5), 0, 1, 0, new THREE.Color().setHSL(Math.random(), 1, 0.65), 0.25, 0.5, { drag: 0 });
  }
  if (u.lifted) {
    u.vx = u.vz = u.kx = u.kz = 0;
    u.y += (2.1 + Math.sin(S.time * 3 + u.id) * 0.15 - u.y) * Math.min(1, dt * 5);
    return;
  }
  if (u.y > 0 || u.vy !== 0) {
    u.vy -= 45 * dt; u.y += u.vy * dt;
    if (u.y <= 0) {
      u.y = 0; u.vy = 0;
      if (u.slamFx) { u.slamFx = false; FX.ring(u.x, u.z, 0xc59bff, 0.2, 2.4, 0.4); FX.burst(u.x, 0.2, u.z, 0xd5a8ff, 24, 7, 0.4, 0.5, { up: 0.3 }); if (volAt(u.x, u.z) > 0.3) Sound.sfx.slam(); if (u.isPlayer) addShake(0.4); }
    }
  }
  if (u.frozen) return;

  const I = u.intent;
  const canAct = !S.over && S.countdown <= 0;
  if (canAct) {
    if (I.move && u.moveCd <= 0 && !u.dash) doMove(u);
    if (I.rule) doRule(u);
    if (I.fire && u.fireCd <= 0 && u.ammo >= 1 && !u.dash && !u.isClone) fire(u);
  }

  if (u.dash) {
    const d = u.dash; d.t -= dt;
    u.vx = d.dx * d.speed; u.vz = d.dz * d.speed;
    if (d.kind === 'ram') {
      for (const e of S.units) {
        if (!e.alive || e.team === u.team || e.air || d.hit.has(e)) continue;
        if (Math.hypot(e.x - u.x, e.z - u.z) < u.r + e.r + 0.35) {
          d.hit.add(e); damage(e, 18, u); e.kx += d.dx * 15; e.kz += d.dz * 15;
          FX.spray(e.x, 0.9, e.z, d.dx, d.dz, 0xd5a8ff, 16, 9, 1.2, 0.4, 0.35);
          if (u.isPlayer || e.isPlayer) addShake(0.3);
        }
      }
      FX.emit(u.x - d.dx * 0.4, rand(0.3, 1.3), u.z - d.dz * 0.4, -d.dx * 2, 0, -d.dz * 2, u.hero.color, 0.55, 0.35, { drag: 4 });
    } else {
      FX.emit(u.x, rand(0.2, 0.9), u.z, 0, 0, 0, new THREE.Color().setHSL(0.1 + Math.random() * 0.08, 1, 0.6), 0.45, 0.45, { drag: 0, s1: 0.1 });
    }
    if (d.t <= 0) { u.dash = null; u.vx *= 0.35; u.vz *= 0.35; }
  } else {
    const mx = canAct ? I.mx : 0, mz = canAct ? I.mz : 0;
    const k = 1 - Math.exp(-dt * 16);
    u.vx += (mx * h.speed - u.vx) * k; u.vz += (mz * h.speed - u.vz) * k;
  }
  const kd = Math.exp(-dt * 7); u.kx *= kd; u.kz *= kd;
  u.x += (u.vx + u.kx) * dt; u.z += (u.vz + u.kz) * dt;
  if (collideUnit(u) && u.dash && u.dash.kind === 'ram') { u.dash = null; FX.ring(u.x, u.z, u.hero.color, 0.2, 1.4, 0.3); }

  const fa = Math.atan2(I.ax, I.az);
  u.yaw = turnToward(u.yaw, fa, dt * 22);

  // launch pads
  if (u.padCd <= 0 && !u.isClone) {
    for (const p of pads) {
      if ((u.x - p.x) ** 2 + (u.z - p.z) ** 2 < 0.8) {
        u.air = { sx: u.x, sz: u.z, tx: p.tx, tz: p.tz, t: 0, dur: 0.8 }; u.dash = null;
        FX.ring(p.x, p.z, 0x8dff9e, 0.3, 2.0, 0.4); FX.burst(p.x, 0.2, p.z, 0x8dff9e, 20, 5, 0.4, 0.5, { up: 2 });
        if (volAt(u.x, u.z) > 0.2) Sound.sfx.pad();
        break;
      }
    }
  }
}

function separateUnits() {
  const us = S.units;
  for (let i = 0; i < us.length; i++) {
    const a = us[i]; if (!a.alive || a.air || a.lifted) continue;
    for (let j = i + 1; j < us.length; j++) {
      const b = us[j]; if (!b.alive || b.air || b.lifted) continue;
      const dx = b.x - a.x, dz = b.z - a.z, d2 = dx * dx + dz * dz, r = a.r + b.r;
      if (d2 < r * r && d2 > 1e-6) {
        const d = Math.sqrt(d2), p = (r - d) * 0.5 / d;
        a.x -= dx * p; a.z -= dz * p; b.x += dx * p; b.z += dz * p;
      }
    }
  }
}

// ---------- projectiles
function killProj(p, fizzle) {
  p.active = false; p.group.visible = false;
  if (fizzle) FX.burst(p.x, p.y, p.z, p.trail, 4, 2, 0.25, 0.25);
}
function steerProj(p, dt) {
  p.retarget -= dt;
  if (p.retarget <= 0) {
    p.retarget = 0.15; p.target = null; let bd = 16;
    for (const u of S.units) { if (!u.alive || u.team === p.team || u.air || p.hitSet.has(u)) continue; const d = Math.hypot(u.x - p.x, u.z - p.z); if (d < bd) { bd = d; p.target = u; } }
  }
  const t = p.target; if (!t || !t.alive) return;
  let dx, dz;
  if (los(p.x, p.z, t.x, t.z)) { dx = t.x - p.x; dz = t.z - p.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l; }
  else { if (!ARENA.flowDir(unitField(t), p.x, p.z, V)) return; dx = V.x; dz = V.z; }
  const na = turnToward(Math.atan2(p.vz, p.vx), Math.atan2(dz, dx), 14 * dt);
  p.vx = Math.cos(na) * p.speed; p.vz = Math.sin(na) * p.speed;
}
function hitSolid(p, s) {
  if (s.kind === 'crate') hurtCrate(s, p.dmg, p);
  else if (s.kind === 'pylon') hurtPylon(s, p.dmg);
  FX.spray(p.x, p.y, p.z, -p.vx, -p.vz, p.trail, 7, 5, 2.2, 0.28, 0.25, { drag: 6 });
  FX.burst(p.x, p.y, p.z, 0xffffff, 3, 2, 0.25, 0.15);
  if (volAt(p.x, p.z) > 0.4) Sound.sfx.wall();
  killProj(p);
}
function updateProjectiles(dt) {
  for (const p of projs) {
    if (!p.active) continue;
    if (p.rising > 0) {
      p.rising += dt; p.y += dt * (4 + p.rising * 22);
      p.group.position.y = p.y;
      p.glow.material.opacity = p.core.material.opacity = Math.max(0, 1 - p.rising * 1.8);
      if (p.rising > 0.55) killProj(p);
      continue;
    }
    if (inFreeze(p.x, p.z)) {
      if (!p.frozen) { p.frozen = true; p.glow.material.color.set(0xbff4ff); }
      continue;
    }
    if (p.frozen) { p.frozen = false; p.glow.material.color.set(p.bend ? 0xffe58a : TEAM_COL[p.team]); }
    for (const f of S.fields) {
      if (f.type === 'upfall' && f.t < f.dur && f.team !== p.team && (p.x - f.x) ** 2 + (p.z - f.z) ** 2 < f.r * f.r) {
        p.rising = 0.001; FX.burst(p.x, p.y, p.z, 0xd5a8ff, 5, 3, 0.3, 0.4, { up: 3 }); break;
      }
    }
    if (p.rising) continue;
    if (p.bend) steerProj(p, dt);
    const steps = Math.max(1, Math.ceil(p.speed * dt / 0.3)), h = dt / steps;
    for (let i = 0; i < steps && p.active; i++) {
      p.x += p.vx * h; p.z += p.vz * h;
      if (Math.abs(p.x) > ARENA.HW || Math.abs(p.z) > ARENA.HH) { killProj(p, true); break; }
      for (const s of S.solids) if (ARENA.circleRect(p.x, p.z, p.r * 0.5, s)) { hitSolid(p, s); break; }
      if (!p.active) break;
      for (const u of S.units) {
        if (!u.alive || u.team === p.team || u.air || p.hitSet.has(u)) continue;
        const rr = u.r + p.r;
        if ((u.x - p.x) ** 2 + (u.z - p.z) ** 2 < rr * rr) {
          p.hitSet.add(u);
          damage(u, p.dmg, p.src);
          if (p.knock) { const l = Math.hypot(p.vx, p.vz); u.kx += p.vx / l * p.knock; u.kz += p.vz / l * p.knock; }
          FX.spray(p.x, p.y, p.z, p.vx, p.vz, p.trail, 9, 7, 1.4, 0.32, 0.3, { drag: 5 });
          FX.burst(p.x, p.y, p.z, 0xffffff, 5, 3, 0.35, 0.18);
          if (!p.pierce) { killProj(p); break; }
        }
      }
    }
    if (!p.active) continue;
    p.life -= dt;
    if (p.life <= 0) { killProj(p, true); continue; }
    p.group.position.set(p.x, p.y, p.z);
    if (p.kind === 'prism') { const a = Math.atan2(-p.vz, p.vx); p.glow.material.rotation = a; p.core.material.rotation = a; }
    const trailCol = p.bend ? new THREE.Color().setHSL(Math.random(), 1, 0.65) : p.trail;
    FX.emit(p.x, p.y, p.z, rand(-0.3, 0.3), rand(-0.2, 0.2), rand(-0.3, 0.3), trailCol, p.kind === 'vex' ? 0.28 : 0.36, p.bend ? 0.45 : 0.2, { drag: 2 });
  }
}

// ---------- crates / pylons
function hurtCrate(c, amt, p) {
  c.hp -= amt; c.shake = 0.15; c.mat.emissive.setRGB(0.5, 0.3, 0.1);
  if (c.hp <= 0) {
    c.alive = false; c.mesh.visible = false;
    FX.burst(c.x, 0.6, c.z, 0xffb13d, 36, 9, 0.45, 0.9, { grav: 14, drag: 1.5, up: 1.2 });
    FX.burst(c.x, 0.6, c.z, 0x6a4c9a, 26, 6, 0.6, 0.9, { grav: 14, drag: 1.5, up: 1.2 });
    FX.ring(c.x, c.z, 0xffb13d, 0.3, 2.2, 0.4);
    if (volAt(c.x, c.z) > 0.3) Sound.sfx.crate();
    rebuildSolids();
  }
}
function hurtPylon(s, amt) {
  if (s.state !== 'ready') return;
  s.hp -= amt; s.flash = 1;
  if (s.hp <= 0) {
    s.state = 'charging'; s.charge = 0;
    createFreeze(s.x, s.z);
    FX.burst(s.x, 1.4, s.z, 0xbff4ff, 40, 8, 0.45, 0.8, { grav: 8 });
  }
}
function updateArenaObjects(dt, t) {
  for (const c of crates) {
    if (!c.alive) continue;
    if (c.shake > 0) { c.shake -= dt; c.box.position.x = Math.sin(t * 90) * c.shake * 0.4; c.mat.emissive.multiplyScalar(0.85); }
    else c.box.position.x = 0;
  }
  for (const s of pylons) {
    s.flash = Math.max(0, s.flash - dt * 6);
    if (s.state === 'charging') {
      s.charge += dt;
      const k = s.charge / 14;
      s.crystal.scale.set(0.3 + 0.7 * k, (0.3 + 0.7 * k) * 1.9, 0.3 + 0.7 * k);
      s.crystalMat.opacity = 0.25 + k * 0.4; s.halo.material.opacity = 0.1; s.ring.material.opacity = 0.03;
      if (s.charge >= 14) { s.state = 'ready'; s.hp = s.max; FX.ring(s.x, s.z, 0x7fe3ff, 0.2, 2, 0.5); FX.burst(s.x, 1.4, s.z, 0xbff4ff, 20, 4, 0.35, 0.5); }
    } else {
      s.crystal.scale.set(1, 1.9, 1); s.crystalMat.opacity = 0.92;
      s.halo.material.opacity = 0.45 + Math.sin(t * 3) * 0.15 + s.flash * 0.5;
      s.ring.material.opacity = 0.1 + Math.sin(t * 2) * 0.04;
      s.crystalMat.emissive.setRGB(0.16 + s.flash * 0.8, 0.54 + s.flash * 0.4, 0.72 + s.flash * 0.3);
    }
    s.crystal.rotation.y = t * 1.2; s.crystal.position.y = 1.35 + Math.sin(t * 2) * 0.1;
  }
  for (const p of pads) {
    p.ring.material.opacity = 0.6 + Math.sin(t * 5) * 0.3;
    p.chevs.forEach((c, i) => { c.material.opacity = 0.25 + 0.75 * Math.max(0, Math.sin(t * 6 - i * 1.1)); });
  }
}

// ============================================================ bots
function botThink(u) {
  const ai = u.ai, D = ai.D, h = u.hero, A = h.attack;
  let tgt = null, best = 1e9, tvis = false, td = 0;
  for (const e of S.units) {
    if (!e.alive || e.team === u.team || e.air) continue;
    const d = Math.hypot(e.x - u.x, e.z - u.z);
    if (d > 17) continue;
    const vis = los(u.x, u.z, e.x, e.z);
    const sc = d + (vis ? 0 : 5) - (e === ai.target ? 1.5 : 0) + (e.hp / e.maxHp) * 2 + (e.frozen ? 4 : 0);
    if (sc < best) { best = sc; tgt = e; tvis = vis; td = d; }
  }
  if (tgt !== ai.target) { ai.target = tgt; ai.react = D.react * rand(0.7, 1.3); }
  ai.tvis = tvis;
  const hpF = u.hp / u.maxHp;
  if (hpF < 0.3 && tgt && td < 10) ai.retreat = true;
  if (hpF > 0.75 || (!tgt && hpF > 0.5)) ai.retreat = false;

  const zd = Math.hypot(S.zone.x - u.x, S.zone.z - u.z);
  let mx = 0, mz = 0;
  if (ai.retreat) {
    ARENA.flowDir(spawnField(u.team), u.x, u.z, V); mx = V.x; mz = V.z;
    if (tgt) { mx -= (tgt.x - u.x) / td * 0.4; mz -= (tgt.z - u.z) / td * 0.4; }
  } else if (tgt && td < A.range + 5) {
    const want = A.range * h.pref;
    let ax = 0, az = 0;
    if (td > want + 0.8 || !tvis) {
      if (tvis) { ax = (tgt.x - u.x) / td; az = (tgt.z - u.z) / td; }
      else { ARENA.flowDir(unitField(tgt), u.x, u.z, V); ax = V.x; az = V.z; }
    } else if (td < want - 1.5) { ax = -(tgt.x - u.x) / td; az = -(tgt.z - u.z) / td; }
    const px = -(tgt.z - u.z) / td, pz = (tgt.x - u.x) / td;
    mx = ax + px * ai.strafe * 0.8; mz = az + pz * ai.strafe * 0.8;
    if (zd > ZONE_R * 0.8 && hpF > 0.45) { ARENA.flowDir(zoneField(), u.x, u.z, V); mx += V.x * 0.6; mz += V.z * 0.6; }
  } else if (zd > ZONE_R * 0.75) {
    ARENA.flowDir(zoneField(), u.x, u.z, V); mx = V.x; mz = V.z;
  } else {
    if (S.time > ai.wanderT) { const a = Math.random() * 6.28, r = Math.random() * ZONE_R * 0.7; ai.wx = S.zone.x + Math.cos(a) * r; ai.wz = S.zone.z + Math.sin(a) * r; ai.wanderT = S.time + rand(1, 2.5); }
    const dx = ai.wx - u.x, dz = ai.wz - u.z, l = Math.hypot(dx, dz);
    if (l > 0.5) { mx = dx / l; mz = dz / l; }
  }
  const ml = Math.hypot(mx, mz);
  if (ml > 0.01) { mx /= ml; mz /= ml; }
  // unstick
  if (S.time - ai.stuckT > 0.8) {
    if (ml > 0.01 && Math.hypot(u.x - ai.lx, u.z - ai.lz) < 0.3 && !u.frozen && !u.lifted) { ai.unstickT = S.time + 0.45; ai.unstickA = Math.random() * 6.28; }
    ai.lx = u.x; ai.lz = u.z; ai.stuckT = S.time;
  }
  if (S.time < ai.unstickT) { mx = Math.cos(ai.unstickA); mz = Math.sin(ai.unstickA); }
  ai.mx = mx; ai.mz = mz;

  // aim & fire
  ai.wantFire = false;
  if (tgt && tvis) {
    const t = td / A.speed * D.lead;
    ai.aimX = tgt.x + tgt.vx * t; ai.aimZ = tgt.z + tgt.vz * t;
    if (td < A.range * 0.95 + (u.bendT > 0 ? 3 : 0) && ai.react <= 0 && u.ammo >= 1 && Math.random() < D.fireGate) ai.wantFire = true;
  } else if (tgt && u.bendT > 0 && td < 15) {
    ARENA.flowDir(unitField(tgt), u.x, u.z, V);
    ai.aimX = u.x + V.x * 4; ai.aimZ = u.z + V.z * 4; ai.wantFire = u.ammo >= 1;
  } else if (ml > 0.01) { ai.aimX = u.x + mx * 4; ai.aimZ = u.z + mz * 4; }

  // reality rule
  if ((u.ruleCd <= 0 || (u.clone && u.clone.alive)) && Math.random() < D.abil) {
    if (h.id === 'vex' && tgt) {
      let bestN = 0, bx = 0, bz = 0;
      for (const e of S.units) {
        if (!e.alive || e.team === u.team || e.air || Math.hypot(e.x - u.x, e.z - u.z) > h.rule.range + 1) continue;
        let n = 0;
        for (const o of S.units) if (o.alive && o.team !== u.team && Math.hypot(o.x - e.x, o.z - e.z) < h.rule.radius * 0.9) n += o.isClone ? 0.3 : 1;
        if (n > bestN) { bestN = n; bx = e.x + e.vx * 0.3; bz = e.z + e.vz * 0.3; }
      }
      if (bestN >= 2 || (bestN >= 1 && Math.random() < 0.35)) { ai.wantRule = true; ai.ruleX = bx; ai.ruleZ = bz; }
    } else if (h.id === 'mirra') {
      if (u.clone && u.clone.alive) { if (hpF < 0.35 && Math.random() < 0.5) ai.wantRule = true; }
      else if (tgt && td < 10) ai.wantRule = true;
    } else if (h.id === 'prism' && tgt && ((!tvis && td < 13) || td < 10)) ai.wantRule = true;
  }

  // movement skill
  if (u.moveCd <= 0) {
    ai.wantMove = false;
    if (S.time > ai.dodgeT) {
      for (const p of projs) {
        if (!p.active || p.team === u.team || p.rising) continue;
        const dx = u.x - p.x, dz = u.z - p.z, d = Math.hypot(dx, dz);
        if (d > 5 || d < 0.5) continue;
        const sp = Math.hypot(p.vx, p.vz);
        if ((dx * p.vx + dz * p.vz) / (d * sp) > 0.93) {
          ai.dodgeT = S.time + 0.6;
          if (Math.random() < D.dodge) { const s = Math.random() < 0.5 ? 1 : -1; ai.moveX = -p.vz / sp * s; ai.moveZ = p.vx / sp * s; ai.wantMove = true; }
          break;
        }
      }
    }
    if (!ai.wantMove && tgt) {
      if (h.id === 'vex' && tvis && td < 6 && td > 2 && hpF > 0.4 && Math.random() < 0.5) { ai.moveX = (tgt.x - u.x) / td; ai.moveZ = (tgt.z - u.z) / td; ai.wantMove = true; }
      else if (h.id === 'mirra' && ai.retreat && ml > 0) { ai.moveX = mx; ai.moveZ = mz; ai.wantMove = true; }
      else if (h.id === 'prism' && (ai.retreat || td < 3.5) && ml > 0) { ai.moveX = mx; ai.moveZ = mz; ai.wantMove = true; }
    }
  }
}

function botControl(u, dt) {
  const ai = u.ai, I = u.intent;
  ai.thinkT -= dt; ai.react -= dt;
  if (S.time > ai.strafeT) { ai.strafe = Math.random() < 0.15 ? 0 : (Math.random() < 0.5 ? -1 : 1); ai.strafeT = S.time + rand(0.6, 1.8); }
  if (ai.thinkT <= 0) { ai.thinkT = ai.D.think * rand(0.8, 1.2); botThink(u); }
  const want = Math.atan2(ai.aimZ - u.z, ai.aimX - u.x);
  ai.aimA = turnToward(ai.aimA, want, ai.D.turn * dt);
  I.mx = ai.mx; I.mz = ai.mz;
  I.ax = Math.cos(ai.aimA); I.az = Math.sin(ai.aimA);
  I.tx = ai.aimX; I.tz = ai.aimZ;
  I.fire = false; I.move = false; I.rule = false;
  if (ai.wantFire && Math.abs(angDiff(ai.aimA, want)) < 0.14 && u.fireCd <= 0) {
    const a = ai.aimA + rand(-1, 1) * ai.D.aimErr;
    I.ax = Math.cos(a); I.az = Math.sin(a); I.fire = true; ai.wantFire = false;
  }
  if (ai.wantMove) { I.mx = ai.moveX; I.mz = ai.moveZ; I.move = true; ai.wantMove = false; }
  if (ai.wantRule) { I.rule = true; ai.wantRule = false; if (u.heroId === 'vex') { I.tx = ai.ruleX; I.tz = ai.ruleZ; } }
}

// ============================================================ input
const input = { keys: {}, mouseDown: false, ruleDown: false, rulePressed: false, ruleReleased: false, movePressed: false, sx: 0, sy: 0, wx: 0, wz: 0 };
const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2(), groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hitPt = new THREE.Vector3();
window.addEventListener('keydown', (e) => {
  Sound.init();
  if (e.repeat) { if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault(); return; }
  input.keys[e.code] = true;
  if (S.mode === 'play' && !S.paused) {
    if (e.code === 'Space' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') { input.movePressed = true; e.preventDefault(); }
    if (e.code === 'KeyE' || e.code === 'KeyQ') { input.ruleDown = true; input.rulePressed = true; }
  }
  onKeyUI(e);
});
window.addEventListener('keyup', (e) => {
  input.keys[e.code] = false;
  if ((e.code === 'KeyE' || e.code === 'KeyQ') && input.ruleDown) { input.ruleDown = false; input.ruleReleased = true; }
});
window.addEventListener('mousemove', (e) => { input.sx = e.clientX; input.sy = e.clientY; });
canvas.addEventListener('mousedown', (e) => {
  Sound.init();
  if (e.button === 0) input.mouseDown = true;
  if (e.button === 2) { input.ruleDown = true; input.rulePressed = true; }
});
window.addEventListener('mouseup', (e) => {
  if (e.button === 0) input.mouseDown = false;
  if (e.button === 2 && input.ruleDown) { input.ruleDown = false; input.ruleReleased = true; }
});
window.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('blur', () => { input.keys = {}; input.mouseDown = false; input.ruleDown = false; if (S.mode === 'play' && !S.over) setPaused(true); });

function pickGround() {
  ndc.set(input.sx / innerWidth * 2 - 1, -(input.sy / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  groundPlane.constant = -PROJ_Y;
  if (raycaster.ray.intersectPlane(groundPlane, hitPt)) { input.wx = hitPt.x; input.wz = hitPt.z; }
}

function playerControl(u) {
  const I = u.intent, k = input.keys;
  let mx = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
  let mz = (k.KeyS || k.ArrowDown ? 1 : 0) - (k.KeyW || k.ArrowUp ? 1 : 0);
  const l = Math.hypot(mx, mz); if (l > 0) { mx /= l; mz /= l; }
  I.mx = mx; I.mz = mz;
  const dx = input.wx - u.x, dz = input.wz - u.z, al = Math.hypot(dx, dz);
  if (al > 0.05) { I.ax = dx / al; I.az = dz / al; }
  I.tx = input.wx; I.tz = input.wz;
  I.fire = input.mouseDown;
  I.move = input.movePressed;
  const targeted = u.hero.rule.targeted;
  I.rule = targeted && !(u.clone && u.clone.alive) ? input.ruleReleased : input.rulePressed;
  input.movePressed = input.rulePressed = input.ruleReleased = false;
}

// ============================================================ match flow
function clearMatch() {
  for (const u of S.units) if (!u.removed) removeUnit(u);
  S.units = [];
  for (const f of S.fields) scene.remove(f.vis.g);
  S.fields = []; S.pops = [];
  for (const p of projs) killProj(p);
  FX.clear();
  for (const c of crates) { c.alive = true; c.hp = c.max; c.mesh.visible = true; c.mat.emissive.setRGB(0, 0, 0); }
  for (const s of pylons) { s.state = 'ready'; s.hp = s.max; s.charge = 0; }
  for (const k in fieldCache) delete fieldCache[k];
  rebuildSolids();
  $('killfeed').innerHTML = '';
  $('respawn').classList.add('hidden');
}

function setZone(i, instant) {
  const z = ZONES[i];
  S.zone.i = i; S.zone.x = z.x; S.zone.z = z.z; S.zone.next = (i + 1) % ZONES.length;
  zoneDisc.position.x = zonePillar.position.x = z.x; zoneDisc.position.z = zonePillar.position.z = z.z;
  if (!instant) {
    S.zone.alpha = 0;
    FX.ring(z.x, z.z, 0xd8c8ff, 0.2, ZONE_R * 1.6, 0.9);
    FX.burst(z.x, 0.3, z.z, 0xb59bff, 50, 6, 0.4, 1, { up: 3 });
  }
}

function startMatch(opts) {
  clearMatch();
  S.demo = !!opts.demo; S.over = false; S.overT = 0; S.time = 0; S.clock = MATCH_TIME; S.score = [0, 0]; S.kos = [0, 0];
  S.shiftT = ZONE_SHIFT; S.warned = false; S.zoneOwner = -2; S.trauma = 0; S.hitstop = 0;
  setZone(0, true); S.zone.alpha = 1;
  const names = shuffle(BOT_NAMES.slice());
  const blue = [], red = shuffle(HERO_ORDER.slice());
  if (S.demo) blue.push(...shuffle(HERO_ORDER.slice()));
  else { blue.push(opts.hero, ...shuffle(HERO_ORDER.filter((h) => h !== opts.hero))); }
  S.player = null;
  [blue, red].forEach((list, team) => list.forEach((heroId, i) => {
    const sp = SPAWN[team];
    const isPlayer = !S.demo && team === 0 && i === 0;
    const u = createUnit(heroId, team, {
      x: sp.x + (i === 0 ? 0 : (team ? -1 : 1)), z: sp.z + (i === 0 ? 0 : i === 1 ? -2.2 : 2.2),
      player: isPlayer, bot: !isPlayer, diff: S.demo || team === 0 ? 'normal' : settings.difficulty, name: isPlayer ? 'YOU' : names.pop(),
    });
    if (isPlayer) S.player = u;
  }));
  if (S.player) {
    aimMesh.geometry.dispose(); aimMesh.geometry = buildAimGeo(S.player.hero);
    aimMat.color.set(S.player.hero.color);
    camFocus.set(S.player.x, 0, S.player.z);
    setupAbilityHud(S.player.hero);
  }
  S.countdown = S.demo ? 0 : 3.6; S.lastCount = 99;
  S.running = true;
}

function endMatch(winner) {
  if (S.over) return;
  S.over = true; S.overT = 0; S.winner = winner;
  if (S.demo) return;
  S.hitstop = 0;
  const msg = winner === 0 ? 'VICTORY' : winner === 1 ? 'DEFEAT' : 'DRAW';
  announce(msg, winner === -1 ? 'Time up · Rift split evenly' : (S.score[winner] >= WIN ? 'Rift secured' : 'Time up'), winner === 0 ? '#3fb8ff' : winner === 1 ? '#ff4d6d' : '#9b6bff');
  if (winner === 0) Sound.sfx.win(); else Sound.sfx.lose();
  aimMesh.visible = false; rulePreview.visible = false; rpRange.visible = false;
}

function updateMatch(dt) {
  if (S.countdown > 0) {
    S.countdown -= dt;
    const n = Math.ceil(S.countdown - 0.6);
    if (n !== S.lastCount) {
      S.lastCount = n;
      if (n > 0 && n <= 3) { announce(String(n), 'Capture the Rift', '#9b6bff'); Sound.sfx.count(n); }
      else if (n <= 0) { announce('BREAK THE RULES', 'Hold the Rift · first to 100%', '#ff4da6'); Sound.sfx.count(0); }
    }
    return;
  }
  if (S.over) return;
  S.clock -= dt;
  // zone control
  const inZ = [0, 0];
  for (const u of S.units) {
    if (!u.alive || u.isClone || u.air) continue;
    if ((u.x - S.zone.x) ** 2 + (u.z - S.zone.z) ** 2 < ZONE_R * ZONE_R) { inZ[u.team]++; if (u.isPlayer) u.stats.zoneT += dt; }
  }
  let owner = -1;
  if (inZ[0] && !inZ[1]) owner = 0; else if (inZ[1] && !inZ[0]) owner = 1; else if (inZ[0] && inZ[1]) owner = 2;
  if (owner === 0 || owner === 1) S.score[owner] = Math.min(WIN, S.score[owner] + ZONE_RATE * (1 + (inZ[owner] - 1) * 0.15) * dt);
  S.zoneOwner = owner;
  const zc = owner === 0 ? 0x3fb8ff : owner === 1 ? 0xff4d6d : owner === 2 ? (Math.sin(S.time * 18) > 0 ? 0xffffff : 0xb59bff) : 0xb59bff;
  zoneU.uColor.value.lerp(tmpCol.set(zc), 0.15);
  if ((owner === 0 || owner === 1) && Math.random() < 0.5) {
    const a = Math.random() * 6.28;
    FX.emit(S.zone.x + Math.cos(a) * ZONE_R, 0.1, S.zone.z + Math.sin(a) * ZONE_R, 0, rand(1, 3), 0, TEAM_COL[owner], 0.3, 0.7, { drag: 0.5 });
  }
  // shifting rift
  S.shiftT -= dt;
  const nz = ZONES[S.zone.next];
  if (S.shiftT < 8) {
    zoneGhost.position.set(nz.x, 0.04, nz.z);
    zoneGhost.material.opacity = 0.25 + 0.2 * Math.sin(S.time * 8);
    if (!S.warned) { S.warned = true; if (!S.demo) announce('RIFT UNSTABLE', 'Shifting in 8 seconds', '#b59bff'); }
  } else zoneGhost.material.opacity = 0;
  if (S.shiftT <= 0) {
    S.shiftT = ZONE_SHIFT; S.warned = false;
    setZone(S.zone.next);
    if (!S.demo) { announce('THE RIFT HAS SHIFTED', '', '#b59bff'); Sound.sfx.shift(); }
  }
  // win conditions
  if (S.score[0] >= WIN || S.score[1] >= WIN) endMatch(S.score[0] >= WIN ? 0 : 1);
  else if (S.clock <= 0) { S.clock = 0; endMatch(Math.abs(S.score[0] - S.score[1]) < 0.5 ? -1 : (S.score[0] > S.score[1] ? 0 : 1)); }
}

// ============================================================ camera
const camFocus = new THREE.Vector3();
const CAM_OFF = new THREE.Vector3(0, 20, 12);
let camAngle = 0;
function updateCamera(dt, rdt) {
  if (S.demo || !S.player) {
    camAngle += rdt * 0.06;
    const r = 30;
    camera.position.set(Math.cos(camAngle) * r, 24, Math.sin(camAngle) * r * 0.8);
    camera.lookAt(0, 0, 0);
    return;
  }
  const u = S.player;
  let fx = u.x, fz = u.z;
  if (!u.alive) { fx = camFocus.x; fz = camFocus.z; }
  else if (!S.over) {
    const lx = clamp((input.wx - u.x) * 0.18, -2.5, 2.5), lz = clamp((input.wz - u.z) * 0.18, -2, 2);
    fx += lx; fz += lz;
  }
  fx = clamp(fx, -13, 13); fz = clamp(fz, -8.5, 8.5);
  const k = 1 - Math.exp(-rdt * 7);
  camFocus.x += (fx - camFocus.x) * k; camFocus.z += (fz - camFocus.z) * k;
  S.trauma = Math.max(0, S.trauma - rdt * 1.6);
  const sh = S.trauma * S.trauma * 0.9, t = performance.now() / 1000;
  const ox = sh * (Math.sin(t * 61) + Math.sin(t * 37) * 0.5), oz = sh * (Math.sin(t * 53 + 1) + Math.sin(t * 29) * 0.5);
  let off = CAM_OFF;
  if (S.over) { camAngle += rdt * 0.15; off = new THREE.Vector3(Math.sin(camAngle) * 9, 17, Math.cos(camAngle) * 11); }
  camera.position.set(camFocus.x + off.x + ox, off.y, camFocus.z + off.z + oz);
  camera.lookAt(camFocus.x + ox * 0.5, 0, camFocus.z + oz * 0.5);
}

// ============================================================ unit visuals
function syncUnit(u, dt, t) {
  const m = u.model;
  if (u.removed) return;
  if (!u.alive) { m.root.visible = false; return; }
  m.root.visible = true;
  m.root.position.set(u.x, u.y, u.z);
  if (!u.frozen) u.animT += dt;
  const at = u.animT;
  m.body.rotation.y = u.yaw;
  const sp = Math.hypot(u.vx, u.vz) / u.hero.speed;
  const lk = 1 - Math.exp(-dt * 10);
  if (u.lifted) { m.tilt.rotation.z = Math.sin(at * 3) * 0.6; m.tilt.rotation.x = Math.cos(at * 2.3) * 0.5; }
  else if (!u.frozen) {
    m.tilt.rotation.x += (clamp(u.vz / u.hero.speed, -1.5, 1.5) * 0.14 - m.tilt.rotation.x) * lk;
    m.tilt.rotation.z += (-clamp(u.vx / u.hero.speed, -1.5, 1.5) * 0.14 - m.tilt.rotation.z) * lk;
  }
  m.body.position.y = sp > 0.2 ? Math.abs(Math.sin(at * 11)) * 0.09 : Math.sin(at * 2) * 0.03;
  m.kick = Math.max(0, m.kick - dt * 8);
  m.body.scale.set(1 + m.kick * 0.08, 1 - m.kick * 0.1, 1 + m.kick * 0.08);
  for (const f of m.spinners) f(at);
  HeroModels.setFlash(m, Math.round(u.flash * 8) / 8);
  m.ice.visible = u.frozen;
  m.body.visible = !(u.invuln > 0.15 && Math.floor(t * 18) % 2 === 0);
  m.shadow.scale.setScalar(1 / (1 + u.y * 0.35));
  m.shadow.position.y = 0.02 - u.y; m.ring.position.y = 0.04 - u.y;
  if (u.isPlayer) m.ring.scale.setScalar(1 + Math.sin(t * 5) * 0.06);
  if (u.isClone) m.ring.material.opacity = 0.3 + 0.2 * Math.sin(t * 10);
}

// ============================================================ HUD
const hud = $('hud2d'), hctx = hud.getContext('2d');
let W = 1, H = 1, DPR = 1;
const pv = new THREE.Vector3();
function toScreen(x, y, z) {
  pv.set(x, y, z).project(camera);
  return { x: (pv.x * 0.5 + 0.5) * W, y: (-pv.y * 0.5 + 0.5) * H, ok: pv.z < 1 };
}
function rrect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }

function drawHud2D(dt) {
  hctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  hctx.clearRect(0, 0, W, H);
  if (S.demo || S.mode !== 'play') return;
  hctx.textAlign = 'center'; hctx.textBaseline = 'middle';
  for (const u of S.units) {
    if (!u.alive || u.removed) continue;
    const s = toScreen(u.x, u.y + (u.heroId === 'prism' ? 2.75 : 2.3), u.z);
    if (!s.ok || s.x < -60 || s.x > W + 60 || s.y < -40 || s.y > H + 40) continue;
    u.shownHp += (u.hp - u.shownHp) * Math.min(1, dt * 5);
    const w = u.isPlayer ? 76 : u.isClone ? 44 : 62, h = u.isClone ? 6 : 11, x = s.x - w / 2, y = s.y;
    const col = u.isPlayer ? '#5dff8a' : TEAM_CSS[u.team];
    hctx.fillStyle = 'rgba(8,6,24,.78)'; rrect(hctx, x - 2, y - 2, w + 4, h + 4, 4); hctx.fill();
    hctx.fillStyle = 'rgba(255,255,255,.75)'; hctx.fillRect(x, y, w * clamp(u.shownHp / u.maxHp, 0, 1), h);
    hctx.fillStyle = col; hctx.fillRect(x, y, w * clamp(u.hp / u.maxHp, 0, 1), h);
    if (!u.isClone) {
      hctx.font = '700 10px "Chakra Petch", sans-serif'; hctx.fillStyle = '#0b0820';
      hctx.fillText(Math.ceil(u.hp), s.x, y + h / 2 + 0.5);
      hctx.font = '700 11px "Chakra Petch", sans-serif'; hctx.fillStyle = col;
      hctx.fillText(u.isPlayer ? 'YOU' : u.name, s.x, y - 9);
    } else {
      hctx.font = '700 9px "Chakra Petch", sans-serif'; hctx.fillStyle = col; hctx.fillText('ECHO', s.x, y - 7);
    }
    if (u.isPlayer) {
      const A = u.hero.attack, sw = (w - 4) / 3;
      for (let i = 0; i < A.ammo; i++) {
        const fill = i < u.ammo ? 1 : i === u.ammo ? u.reloadT / A.reload * (u.bendT > 0 ? 1 : 1) : 0;
        hctx.fillStyle = 'rgba(8,6,24,.78)'; hctx.fillRect(x + i * (sw + 2), y + h + 4, sw, 5);
        hctx.fillStyle = i < u.ammo ? '#ffb13d' : 'rgba(255,177,61,.45)'; hctx.fillRect(x + i * (sw + 2), y + h + 4, sw * fill, 5);
      }
    }
    let status = null, sc = '#fff';
    if (u.frozen) { status = '❄ FROZEN'; sc = '#bff4ff'; } else if (u.lifted) { status = '⇡ LIFTED'; sc = '#d5a8ff'; } else if (u.bendT > 0) { status = '↯ BENDLIGHT'; sc = '#ffe58a'; }
    if (status) { hctx.font = '700 10px "Chakra Petch", sans-serif'; hctx.fillStyle = sc; hctx.fillText(status, s.x, y - (u.isClone ? 18 : 22)); }
  }
  // floating numbers
  for (let i = S.pops.length - 1; i >= 0; i--) {
    const p = S.pops[i]; p.t += dt;
    if (p.t > 0.9) { S.pops.splice(i, 1); continue; }
    const s = toScreen(p.x, p.y + p.t * 1.6, p.z); if (!s.ok) continue;
    const sc = p.t < 0.12 ? 1 + (0.12 - p.t) * 5 : 1;
    hctx.globalAlpha = clamp((0.9 - p.t) * 3, 0, 1);
    hctx.font = `800 ${Math.round((p.big ? 22 : 16) * sc)}px "Chakra Petch", sans-serif`;
    hctx.lineWidth = 4; hctx.strokeStyle = 'rgba(10,6,30,.9)'; hctx.strokeText(p.text, s.x, s.y);
    hctx.fillStyle = p.color; hctx.fillText(p.text, s.x, s.y);
    hctx.globalAlpha = 1;
  }
  // off-screen rift marker
  const zs = toScreen(S.zone.x, 0, S.zone.z), m = 40;
  if (zs.x < m || zs.x > W - m || zs.y < m + 60 || zs.y > H - m) {
    const cx = W / 2, cy = H / 2, dx = zs.x - cx, dy = zs.y - cy;
    const k = Math.min((W / 2 - m) / Math.abs(dx || 1), (H / 2 - m - 30) / Math.abs(dy || 1));
    const ex = cx + dx * k, ey = cy + dy * k, a = Math.atan2(dy, dx);
    hctx.save(); hctx.translate(ex, ey); hctx.rotate(a);
    hctx.fillStyle = '#c9b8ff'; hctx.beginPath(); hctx.moveTo(14, 0); hctx.lineTo(-6, -9); hctx.lineTo(-6, 9); hctx.closePath(); hctx.fill();
    hctx.restore();
    hctx.font = '700 10px "Chakra Petch", sans-serif'; hctx.fillStyle = '#c9b8ff'; hctx.fillText('RIFT', ex - Math.cos(a) * 22, ey - Math.sin(a) * 22);
  }
  // crosshair
  const p = S.player;
  if (p && p.alive && !S.over && !S.paused) {
    const ready = p.ammo >= 1;
    hctx.strokeStyle = ready ? p.hero.css : 'rgba(255,255,255,.35)'; hctx.lineWidth = 2;
    hctx.beginPath(); hctx.arc(input.sx, input.sy, 9, 0, Math.PI * 2); hctx.stroke();
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; hctx.beginPath(); hctx.moveTo(input.sx + Math.cos(a) * 13, input.sy + Math.sin(a) * 13); hctx.lineTo(input.sx + Math.cos(a) * 18, input.sy + Math.sin(a) * 18); hctx.stroke(); }
    hctx.fillStyle = '#fff'; hctx.fillRect(input.sx - 1, input.sy - 1, 2, 2);
  }
}

const hudCache = {};
function setText(id, v) { if (hudCache[id] !== v) { hudCache[id] = v; $(id).textContent = v; } }
function setupAbilityHud(h) {
  const root = $('hud'); root.style.setProperty('--hc', h.css);
  $('abMove').querySelector('.ab-name').textContent = h.move.name.toUpperCase();
  $('abRule').querySelector('.ab-name').textContent = h.rule.name;
  $('abRule').querySelector('.ab-icon').textContent = h.rule.icon;
  $('abFire').querySelector('.ab-name').textContent = h.attack.name.toUpperCase();
  $('ammoPips').innerHTML = '<i><b></b></i>'.repeat(h.attack.ammo);
}
function updateDomHud() {
  if (S.demo || S.mode !== 'play') return;
  const sb = S.score[0], sr = S.score[1];
  $('fillBlue').style.width = sb + '%'; $('fillRed').style.width = sr + '%';
  setText('numBlue', Math.floor(sb) + '%'); setText('numRed', Math.floor(sr) + '%');
  setText('koBlue', S.kos[0]); setText('koRed', S.kos[1]);
  const c = Math.max(0, Math.ceil(S.clock)), ts = Math.floor(c / 60) + ':' + String(c % 60).padStart(2, '0');
  setText('timer', ts);
  $('timer').classList.toggle('low', c <= 20 && !S.over);
  const zs = $('zoneStatus');
  const zt = S.countdown > 0 ? 'GET READY' : S.zoneOwner === 0 ? 'YOUR TEAM HOLDS THE RIFT' : S.zoneOwner === 1 ? 'ENEMY HOLDS THE RIFT' : S.zoneOwner === 2 ? 'CONTESTED!' : (S.shiftT < 8 ? `RIFT SHIFTS IN ${Math.ceil(S.shiftT)}` : 'RIFT NEUTRAL');
  setText('zoneStatus', zt);
  zs.className = 'sb-zone' + (S.zoneOwner === 0 ? ' blue' : S.zoneOwner === 1 ? ' red' : S.zoneOwner === 2 ? ' contest' : '');
  const p = S.player; if (!p) return;
  const h = p.hero;
  $('abMove').querySelector('.ab-cd').style.setProperty('--p', clamp(p.moveCd / h.move.cd, 0, 1) * 100);
  const ruleP = (p.clone && p.clone.alive) ? 0 : clamp(p.ruleCd / h.rule.cd, 0, 1) * 100;
  $('abRule').querySelector('.ab-cd').style.setProperty('--p', ruleP);
  const ready = p.ruleCd <= 0 && p.alive;
  $('abRule').classList.toggle('ready', ready || !!(p.clone && p.clone.alive));
  $('abRule').querySelector('.ab-ready').textContent = p.clone && p.clone.alive ? 'SWAP' : 'READY';
  $('abMove').classList.toggle('ready', p.moveCd <= 0);
  if (ready && !p.wasReady && S.countdown <= 0) Sound.sfx.ready();
  p.wasReady = ready;
  const pips = $('ammoPips').children;
  for (let i = 0; i < pips.length; i++) {
    const f = i < p.ammo ? 1 : i === Math.floor(p.ammo) ? p.reloadT / h.attack.reload : 0;
    pips[i].firstChild.style.transform = `scaleX(${f})`;
  }
  if (!p.alive) setText('respawnT', Math.max(1, Math.ceil(p.respawnT)));
  const hpF = p.hp / p.maxHp, low = p.alive && hpF < 0.35 ? (0.35 - hpF) * 1.6 * (0.75 + 0.25 * Math.sin(S.time * 7)) : 0;
  const vig = Math.max(low, p.alive ? p.flash * 0.55 : 0);
  if (Math.abs(vig - (hudCache.vig || 0)) > 0.01) { hudCache.vig = vig; $('vignette').style.opacity = vig.toFixed(2); }
}

function announce(main, sub, color) {
  const el = $('announce');
  el.style.setProperty('--ac', color || '#9b6bff');
  el.querySelector('.an-main').textContent = main;
  el.querySelector('.an-sub').textContent = sub || '';
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
}

// ============================================================ character preview (rendered into the select screen)
const pvScene = new THREE.Scene();
const pvCam = new THREE.PerspectiveCamera(30, 1, 0.1, 60);
pvCam.position.set(0, 2.6, 10.5); pvCam.lookAt(0, 0.95, 0);
pvScene.add(new THREE.HemisphereLight(0xb8c0ff, 0x301848, 1.1));
const pvSun = new THREE.DirectionalLight(0xffffff, 0.9); pvSun.position.set(3, 5, 4); pvScene.add(pvSun);
const pvPed = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.55, 0.3, 48), new THREE.MeshLambertMaterial({ color: 0x1a1640, emissive: 0x08061a }));
pvPed.position.y = -0.15; pvScene.add(pvPed);
const pvRing = new THREE.Mesh(new THREE.TorusGeometry(1.45, 0.035, 8, 64), new THREE.MeshBasicMaterial({ color: 0xffffff }));
pvRing.rotation.x = Math.PI / 2; pvRing.position.y = 0.01; pvScene.add(pvRing);
const pvGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: FX.glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.5 }));
pvGlow.scale.set(5, 5, 1); pvGlow.position.y = 1; pvScene.add(pvGlow);
const pvModels = {};
HERO_ORDER.forEach((id) => { const m = HeroModels.build(id, 0x3fb8ff); m.root.scale.setScalar(1.35); m.root.visible = false; pvScene.add(m.root); pvModels[id] = m; });
let pvSpin = 0, pvPop = 0;
function renderPreview(dt) {
  const slot = $('previewSlot');
  const r = slot.getBoundingClientRect();
  if (r.width < 10 || r.height < 10) return;
  const id = settings.hero, m = pvModels[id];
  for (const k in pvModels) pvModels[k].root.visible = k === id;
  pvSpin += dt * 0.6; pvPop = Math.min(1, pvPop + dt * 4);
  const t = performance.now() / 1000;
  m.body.rotation.y = pvSpin; m.body.position.y = Math.sin(t * 2) * 0.05;
  const s = 1.35 * (0.85 + 0.15 * (1 - Math.pow(1 - pvPop, 3)));
  m.root.scale.setScalar(s);
  for (const f of m.spinners) f(t);
  pvRing.material.color.set(HEROES[id].color); pvGlow.material.color.set(HEROES[id].color);
  pvCam.aspect = r.width / r.height; pvCam.updateProjectionMatrix();
  const y = innerHeight - r.bottom;
  renderer.setViewport(r.left, y, r.width, r.height);
  renderer.setScissor(r.left, y, r.width, r.height);
  renderer.setScissorTest(true);
  renderer.clearDepth();
  renderer.render(pvScene, pvCam);
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, innerWidth, innerHeight);
}

// ============================================================ screens & menus
const screens = ['menu', 'select', 'hud', 'pause', 'results', 'how'];
function show(...ids) { for (const s of screens) $(s).classList.toggle('hidden', !ids.includes(s)); }
function fadeThen(fn) {
  const f = $('fade'); f.classList.add('on');
  setTimeout(() => { fn(); requestAnimationFrame(() => f.classList.remove('on')); }, 360);
}
function goMenu() {
  S.mode = 'menu'; S.paused = false; Sound.setIntensity(0);
  document.body.style.cursor = '';
  show('menu');
  startMatch({ demo: true });
}
function goSelect() {
  S.mode = 'select'; S.paused = false; Sound.setIntensity(0);
  document.body.style.cursor = '';
  if (!S.demo) startMatch({ demo: true });
  show('select'); selectHero(settings.hero);
}
function startGame() {
  fadeThen(() => {
    S.mode = 'play'; S.paused = false; Sound.setIntensity(1);
    show('hud');
    document.body.style.cursor = 'none';
    startMatch({ demo: false, hero: settings.hero });
  });
}
function setPaused(v) {
  if (S.mode !== 'play' || S.over) return;
  S.paused = v;
  $('pause').classList.toggle('hidden', !v);
  document.body.style.cursor = v ? '' : 'none';
  input.mouseDown = false;
}
function showResults() {
  S.mode = 'results';
  document.body.style.cursor = '';
  const p = S.player, w = S.winner;
  const t = $('resTitle');
  t.textContent = w === 0 ? 'VICTORY' : w === 1 ? 'DEFEAT' : 'DRAW';
  t.className = 'res-title ' + (w === 0 ? 'win' : w === 1 ? 'lose' : 'draw');
  $('resSub').textContent = `${p.hero.name} · ${p.hero.title} · ${settings.difficulty.toUpperCase()} BOTS`;
  $('resScore').innerHTML = `<span class="b">${Math.floor(S.score[0])}%</span> &nbsp;—&nbsp; <span class="r">${Math.floor(S.score[1])}%</span>`;
  const st = p.stats;
  $('resStats').innerHTML = [['KOs', st.ko], ['FALLS', st.deaths], ['DAMAGE', Math.round(st.dmg)], ['RULES BROKEN', st.rules], ['RIFT TIME', Math.round(st.zoneT) + 's']]
    .map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`).join('');
  show('hud', 'results');
}

function onKeyUI(e) {
  if (S.mode === 'play') {
    if ((e.code === 'Escape' || e.code === 'KeyP') && !S.over) setPaused(!S.paused);
  } else if (S.mode === 'select') {
    const i = ['Digit1', 'Digit2', 'Digit3'].indexOf(e.code);
    if (i >= 0) selectHero(HERO_ORDER[i]);
    if (e.code === 'ArrowDown' || e.code === 'ArrowUp') selectHero(HERO_ORDER[(HERO_ORDER.indexOf(settings.hero) + (e.code === 'ArrowDown' ? 1 : 2)) % 3]);
    if (e.code === 'Enter') { Sound.sfx.click(); startGame(); }
    if (e.code === 'Escape') goMenu();
  } else if (S.mode === 'results') {
    if (e.code === 'KeyR' || e.code === 'Enter') startGame();
  } else if (S.mode === 'menu') {
    if (!$('how').classList.contains('hidden')) { if (e.code === 'Escape' || e.code === 'Enter') show('menu'); }
    else if (e.code === 'Enter') { Sound.sfx.click(); goSelect(); }
  }
}

function buildSelect() {
  $('selCards').innerHTML = HERO_ORDER.map((id, i) => {
    const h = HEROES[id];
    return `<div class="card" data-id="${id}" style="--c:${h.css}"><div class="ck">${i + 1}</div><div class="cn">${h.name}</div><div class="ct">${h.title.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())} · ${h.role}</div></div>`;
  }).join('');
  $('selCards').querySelectorAll('.card').forEach((el) => {
    el.addEventListener('click', () => { Sound.init(); selectHero(el.dataset.id); });
    el.addEventListener('mouseenter', () => Sound.sfx.hover());
  });
}
function selectHero(id) {
  if (settings.hero !== id || !$('selDetail').innerHTML) pvPop = 0;
  if (settings.hero !== id) Sound.sfx.click();
  settings.hero = id; saveSettings();
  const h = HEROES[id];
  $('selCards').querySelectorAll('.card').forEach((el) => el.classList.toggle('on', el.dataset.id === id));
  $('pvName').textContent = h.name; $('pvTitle').textContent = h.title;
  $('previewSlot').style.setProperty('--pc', h.css);
  const d = $('selDetail'); d.style.setProperty('--c', h.css);
  d.innerHTML = `<h4>${h.role.toUpperCase()}</h4>` +
    Object.entries(h.stats).map(([k, v]) => `<div class="stat"><span>${k}</span><div class="bar"><i style="width:${v * 100}%"></i></div></div>`).join('') +
    `<div class="abil"><div class="an"><em>ATTACK</em>${h.attack.name}</div><p>${h.attack.desc}</p></div>` +
    `<div class="abil"><div class="an"><em>MOVE</em>${h.move.name}</div><p>${h.move.desc}</p></div>` +
    `<div class="abil rule"><div class="an"><em>RULE</em>${h.rule.icon} ${h.rule.name}</div><p>${h.rule.desc}</p></div>`;
}

function bindUI() {
  const click = (id, fn) => $(id).addEventListener('click', () => { Sound.init(); Sound.sfx.click(); fn(); });
  click('btnPlay', goSelect);
  click('btnHow', () => show('menu', 'how'));
  click('btnHowClose', () => show('menu'));
  click('btnBack', goMenu);
  click('btnLock', startGame);
  click('btnResume', () => setPaused(false));
  click('btnRestart', () => { setPaused(false); startGame(); });
  click('btnQuit', () => fadeThen(goMenu));
  click('btnAgain', startGame);
  click('btnChange', () => fadeThen(goSelect));
  click('btnMenu', () => fadeThen(goMenu));
  document.querySelectorAll('.btn').forEach((b) => b.addEventListener('mouseenter', () => Sound.sfx.hover()));
  const chips = $('diffChips');
  const syncDiff = () => chips.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === settings.difficulty));
  chips.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { Sound.init(); Sound.sfx.click(); settings.difficulty = b.dataset.v; saveSettings(); syncDiff(); }));
  syncDiff();
  const tg = (id, key, apply) => {
    const el = $(id); const sync = () => el.classList.toggle('on', settings[key]);
    el.addEventListener('click', () => { Sound.init(); settings[key] = !settings[key]; saveSettings(); apply(settings[key]); sync(); Sound.sfx.click(); });
    apply(settings[key]); sync();
  };
  tg('tglSfx', 'sfx', (v) => Sound.setSfx(v));
  tg('tglMusic', 'music', (v) => Sound.setMusic(v));
  tg('tglShake', 'shake', () => {});
  buildSelect();
  window.addEventListener('pointerdown', () => Sound.init(), { once: true });
}

// ============================================================ main loop
function resize() {
  W = innerWidth; H = innerHeight; DPR = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setSize(W, H, false);
  camera.aspect = W / H; camera.updateProjectionMatrix();
  hud.width = W * DPR; hud.height = H * DPR;
  FX.setViewport(H * renderer.getPixelRatio(), camera.fov);
}
window.addEventListener('resize', resize);
document.addEventListener('visibilitychange', () => { if (document.hidden && S.mode === 'play' && !S.over) setPaused(true); });

const SPEED = (() => { const m = /[?&]speed=(\d+(\.\d+)?)/.exec(location.search); return m ? +m[1] : 1; })();
let lastT = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  let rdt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
  const t = now / 1000;
  let dt = rdt * SPEED;
  if (S.hitstop > 0) { S.hitstop -= rdt; dt *= 0.08; }
  if (S.over && !S.demo) dt *= clamp(0.25 + S.overT * 0.3, 0, 1);
  if (S.paused) dt = 0;

  if (S.running && dt > 0) {
    // sub-step large frames to keep collisions stable
    const steps = Math.ceil(dt / 0.02), h = dt / steps;
    for (let i = 0; i < steps; i++) simulate(h);
  }
  if (S.over) {
    S.overT += rdt;
    if (!S.demo && S.mode === 'play' && S.overT > 2.2) showResults();
    if (S.demo && S.overT > 3) startMatch({ demo: true });
  }
  if (S.player && S.mode === 'play' && !S.paused) pickGround();
  for (const u of S.units) syncUnit(u, S.paused ? 0 : dt, t);
  S.units = S.units.filter((u) => !u.removed);

  // rift visual
  zoneU.uTime.value = t;
  S.zone.alpha = Math.min(1, S.zone.alpha + rdt * 1.5);
  zoneU.uAlpha.value = S.zone.alpha;
  zonePillar.scale.y = 0.4 + 0.6 * S.zone.alpha;
  if (S.demo) zoneU.uColor.value.lerp(tmpCol.set(S.zoneOwner === 0 ? 0x3fb8ff : S.zoneOwner === 1 ? 0xff4d6d : 0xb59bff), 0.1);

  // player aim helpers
  const p = S.player;
  if (p && S.mode === 'play' && p.alive && !S.over) {
    aimMesh.visible = !p.lifted && !p.frozen;
    aimMesh.position.set(p.x, 0.05 + p.y, p.z);
    aimMesh.rotation.y = -Math.atan2(p.intent.az, p.intent.ax);
    aimMat.opacity = p.ammo >= 1 ? 0.13 : 0.04;
    const showRule = p.hero.rule.targeted && input.ruleDown && p.ruleCd <= 0;
    rulePreview.visible = rpRange.visible = showRule;
    if (showRule) {
      let tx = input.wx - p.x, tz = input.wz - p.z; const l = Math.hypot(tx, tz), R = p.hero.rule.range;
      if (l > R) { tx *= R / l; tz *= R / l; }
      rulePreview.position.set(p.x + tx, 0, p.z + tz);
      rpRing.rotation.z = t; rpRange.position.set(p.x, 0, p.z);
    }
  } else { aimMesh.visible = false; rulePreview.visible = false; rpRange.visible = false; }

  updateArenaObjects(S.paused ? 0 : dt, t);
  arenaFx.update(t);
  FX.update(S.paused ? 0 : dt);
  updateCamera(dt, rdt);
  drawHud2D(S.paused ? 0 : rdt);
  updateDomHud();

  renderer.setViewport(0, 0, innerWidth, innerHeight);
  renderer.clear();
  renderer.render(scene, camera);
  if (S.mode === 'select') renderPreview(rdt);
}

function simulate(dt) {
  S.time += dt;
  updateFields(dt);
  for (const u of S.units) {
    if (!u.alive || u.removed) continue;
    if (u.isPlayer) { if (S.mode === 'play') playerControl(u); }
    else if (u.isClone) {
      const o = u.owner.intent, I = u.intent;
      I.mx = o.mx; I.mz = o.mz; I.tx = o.tx; I.tz = o.tz;
      const dx = o.tx - u.x, dz = o.tz - u.z, l = Math.hypot(dx, dz);
      if (l > 0.3) { I.ax = dx / l; I.az = dz / l; }
    } else if (u.ai) botControl(u, dt);
  }
  for (let i = 0; i < S.units.length; i++) updateUnit(S.units[i], dt);
  separateUnits();
  for (const u of S.units) if (u.alive && !u.air) collideUnit(u);
  updateProjectiles(dt);
  updateMatch(dt);
}

// ============================================================ boot
resize();
bindUI();
goMenu();
requestAnimationFrame(frame);
window.__RB = { S, settings, HEROES }; // handy for debugging in the console
