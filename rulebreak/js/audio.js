// audio.js — tiny procedural sound engine (no audio files)
const Sound = (() => {
  let ctx = null, sfxBus, musicBus, noiseBuf;
  let sfxOn = true, musicOn = true;
  const last = {};

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 5; comp.attack.value = 0.003; comp.release.value = 0.15;
    const master = ctx.createGain(); master.gain.value = 0.7;
    comp.connect(master); master.connect(ctx.destination);
    sfxBus = ctx.createGain(); sfxBus.gain.value = sfxOn ? 1 : 0; sfxBus.connect(comp);
    musicBus = ctx.createGain(); musicBus.gain.value = musicOn ? 0.22 : 0; musicBus.connect(comp);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    startMusic();
  }

  function throttle(key, ms) {
    const n = performance.now();
    if (last[key] && n - last[key] < ms) return true;
    last[key] = n; return false;
  }

  function tone(o) {
    if (!ctx) return;
    const t = ctx.currentTime + (o.delay || 0);
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f, t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f2), t + o.dur);
    const v = (o.vol || 0.2);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + (o.attack || 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    let node = osc;
    if (o.lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; osc.connect(f); node = f; }
    node.connect(g); g.connect(o.bus || sfxBus);
    osc.start(t); osc.stop(t + o.dur + 0.05);
  }

  function noise(o) {
    if (!ctx) return;
    const t = ctx.currentTime + (o.delay || 0);
    const src = ctx.createBufferSource(); src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = o.ftype || 'bandpass'; f.Q.value = o.q || 1;
    f.frequency.setValueAtTime(o.f || 1000, t);
    if (o.f2) f.frequency.exponentialRampToValueAtTime(o.f2, t + o.dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.vol || 0.2, t + (o.attack || 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    src.connect(f); f.connect(g); g.connect(o.bus || sfxBus);
    src.start(t, Math.random() * 0.5); src.stop(t + o.dur + 0.05);
  }

  const sfx = {
    shoot(hero, v = 1) {
      if (throttle('shoot' + hero + (v < 1 ? 'f' : ''), 45)) return;
      if (hero === 'vex') {
        noise({ f: 900, f2: 200, dur: 0.18, vol: 0.22 * v, q: 0.8 });
        tone({ type: 'square', f: 180, f2: 60, dur: 0.14, vol: 0.08 * v, lp: 1200 });
      } else if (hero === 'mirra') {
        tone({ type: 'triangle', f: 1300, f2: 500, dur: 0.09, vol: 0.12 * v });
        tone({ type: 'triangle', f: 1600, f2: 650, dur: 0.09, vol: 0.08 * v, delay: 0.03 });
      } else {
        tone({ type: 'sawtooth', f: 2200, f2: 300, dur: 0.16, vol: 0.09 * v, lp: 4000 });
        noise({ f: 5000, dur: 0.08, vol: 0.06 * v, q: 2 });
      }
    },
    hit(v = 1) { if (throttle('hit', 35)) return; tone({ type: 'square', f: 520, f2: 220, dur: 0.07, vol: 0.09 * v, lp: 2500 }); noise({ f: 2500, dur: 0.05, vol: 0.1 * v, q: 1.5 }); },
    hurt() { if (throttle('hurt', 80)) return; tone({ type: 'sawtooth', f: 160, f2: 70, dur: 0.18, vol: 0.16, lp: 900 }); },
    ko(v = 1) {
      tone({ type: 'square', f: 880, f2: 110, dur: 0.45, vol: 0.12 * v, lp: 3000 });
      noise({ f: 1200, f2: 100, dur: 0.5, vol: 0.25 * v, q: 0.7 });
      tone({ type: 'sine', f: 60, f2: 30, dur: 0.4, vol: 0.4 * v });
    },
    wall() { if (throttle('wall', 50)) return; noise({ f: 3000, dur: 0.04, vol: 0.04, q: 3 }); },
    dash() { noise({ f: 300, f2: 2400, dur: 0.22, vol: 0.18, q: 1.2 }); },
    blink() { tone({ type: 'sine', f: 400, f2: 2400, dur: 0.15, vol: 0.14 }); tone({ type: 'sine', f: 2400, f2: 800, dur: 0.15, vol: 0.08, delay: 0.08 }); },
    glide() { noise({ f: 1500, f2: 6000, dur: 0.3, vol: 0.12, q: 2 }); tone({ type: 'triangle', f: 600, f2: 1200, dur: 0.25, vol: 0.06 }); },
    rule(hero) {
      if (hero === 'vex') {
        tone({ type: 'sine', f: 50, f2: 320, dur: 0.8, vol: 0.35 });
        tone({ type: 'sawtooth', f: 90, f2: 600, dur: 0.7, vol: 0.08, lp: 1500 });
        noise({ f: 200, f2: 3000, dur: 0.8, vol: 0.15, q: 1 });
      } else if (hero === 'mirra') {
        [660, 880, 1320].forEach((f, i) => tone({ type: 'triangle', f, dur: 0.35, vol: 0.1, delay: i * 0.05 }));
        tone({ type: 'sine', f: 200, f2: 900, dur: 0.3, vol: 0.12 });
      } else {
        [523, 784, 1046, 1568].forEach((f, i) => tone({ type: 'sine', f, dur: 0.5, vol: 0.09, delay: i * 0.04 }));
        noise({ f: 6000, dur: 0.4, vol: 0.06, q: 4 });
      }
    },
    slam() { tone({ type: 'sine', f: 90, f2: 30, dur: 0.35, vol: 0.45 }); noise({ f: 400, f2: 80, dur: 0.3, vol: 0.25 }); },
    freeze() {
      for (let i = 0; i < 6; i++) tone({ type: 'sine', f: 1800 + Math.random() * 2400, dur: 0.5, vol: 0.05, delay: i * 0.04 });
      noise({ f: 8000, f2: 2000, dur: 0.7, vol: 0.12, q: 6 });
      tone({ type: 'triangle', f: 1200, f2: 200, dur: 0.6, vol: 0.08 });
    },
    crate() { noise({ f: 600, f2: 150, dur: 0.3, vol: 0.25, q: 0.8 }); tone({ type: 'square', f: 140, f2: 50, dur: 0.2, vol: 0.08, lp: 600 }); },
    pad() { tone({ type: 'sine', f: 200, f2: 900, dur: 0.35, vol: 0.18 }); noise({ f: 800, f2: 3000, dur: 0.3, vol: 0.08 }); },
    land() { tone({ type: 'sine', f: 120, f2: 40, dur: 0.2, vol: 0.25 }); },
    click() { tone({ type: 'triangle', f: 900, f2: 1400, dur: 0.06, vol: 0.08 }); },
    hover() { if (throttle('hover', 40)) return; tone({ type: 'sine', f: 1500, dur: 0.03, vol: 0.03 }); },
    count(n) { tone({ type: 'square', f: n > 0 ? 660 : 1320, dur: n > 0 ? 0.12 : 0.4, vol: 0.08, lp: 3000 }); },
    shift() { tone({ type: 'sawtooth', f: 300, f2: 900, dur: 0.6, vol: 0.07, lp: 2000 }); tone({ type: 'sine', f: 600, f2: 1800, dur: 0.6, vol: 0.07, delay: 0.1 }); },
    win() { [523, 659, 784, 1046].forEach((f, i) => tone({ type: 'triangle', f, dur: 0.5, vol: 0.12, delay: i * 0.12 })); },
    lose() { [440, 392, 330, 262].forEach((f, i) => tone({ type: 'triangle', f, dur: 0.55, vol: 0.12, delay: i * 0.16 })); },
    ready() { tone({ type: 'sine', f: 1046, dur: 0.12, vol: 0.06 }); tone({ type: 'sine', f: 1568, dur: 0.18, vol: 0.06, delay: 0.07 }); },
  };

  // --- minimal generative music loop ---
  let step = 0, nextT = 0, timer = null, intensity = 0;
  const BPM = 112, STEP = 60 / BPM / 4;
  const prog = [[57, 60, 64, 67], [53, 57, 60, 64], [55, 59, 62, 67], [52, 55, 59, 64]];
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  function startMusic() {
    if (timer) return;
    nextT = ctx.currentTime + 0.1;
    timer = setInterval(schedule, 60);
  }
  function schedule() {
    while (nextT < ctx.currentTime + 0.2) {
      const bar = Math.floor(step / 16) % prog.length, s = step % 16, chord = prog[bar];
      const delay = nextT - ctx.currentTime;
      if (s % 2 === 0) {
        const n = chord[(s / 2 + (s > 7 ? 1 : 0)) % 4] + 12;
        tone({ type: 'triangle', f: mtof(n), dur: STEP * 1.6, vol: 0.05, delay, bus: musicBus, lp: 2400 });
      }
      if (s === 0 || s === 8 || (intensity > 0.5 && s === 10)) tone({ type: 'sawtooth', f: mtof(chord[0] - 24), dur: STEP * 3.5, vol: 0.11, delay, bus: musicBus, lp: 380 });
      if (intensity > 0.5) {
        if (s % 4 === 0) tone({ type: 'sine', f: 120, f2: 40, dur: 0.18, vol: 0.28, delay, bus: musicBus });
        if (s % 4 === 2) noise({ f: 8000, dur: 0.04, vol: 0.05, q: 1, ftype: 'highpass', delay, bus: musicBus });
      }
      if (s === 0 && step % 64 === 0) chord.forEach((m) => tone({ type: 'sine', f: mtof(m), dur: STEP * 30, vol: 0.025, attack: 0.6, delay, bus: musicBus }));
      step++; nextT += STEP;
    }
  }

  return {
    init, sfx,
    get sfxOn() { return sfxOn; }, get musicOn() { return musicOn; },
    setSfx(v) { sfxOn = v; if (sfxBus) sfxBus.gain.value = v ? 1 : 0; },
    setMusic(v) { musicOn = v; if (musicBus) musicBus.gain.setTargetAtTime(v ? 0.22 : 0, ctx.currentTime, 0.1); },
    setIntensity(v) { intensity = v; },
  };
})();
