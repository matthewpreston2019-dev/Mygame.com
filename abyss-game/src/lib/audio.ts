/**
 * Tiny Web Audio synthesizer — all sound effects are generated in code, so the
 * game ships with no audio files and works offline.
 */
export type Sfx = 'click' | 'tick' | 'tickUrgent' | 'submit' | 'correct' | 'rare' | 'legendary' | 'wrong' | 'timeout' | 'countdown' | 'go' | 'results' | 'unlock' | 'descend' | 'dive'

let ctx: AudioContext | null = null
let master: GainNode | null = null
let enabled = true
let volume = 0.6

function ensure(): AudioContext | null {
  if (!enabled) return null
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AC) return null
      ctx = new AC()
      master = ctx.createGain()
      master.gain.value = volume
      master.connect(ctx.destination)
    }
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

export function configureAudio(opts: { enabled: boolean; volume: number }) {
  enabled = opts.enabled
  volume = opts.volume
  if (master) master.gain.value = volume
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = 'sine', gain = 0.2, glideTo?: number) {
  const c = ctx!
  const osc = c.createOscillator()
  const g = c.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, c.currentTime + start)
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, c.currentTime + start + dur)
  g.gain.setValueAtTime(0.0001, c.currentTime + start)
  g.gain.exponentialRampToValueAtTime(gain, c.currentTime + start + 0.015)
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + dur)
  osc.connect(g)
  g.connect(master!)
  osc.start(c.currentTime + start)
  osc.stop(c.currentTime + start + dur + 0.05)
}

function bubble(start: number, base = 400) {
  tone(base, start, 0.12, 'sine', 0.12, base * 2.4)
}

export function play(sfx: Sfx) {
  const c = ensure()
  if (!c || !master) return
  switch (sfx) {
    case 'click':
      tone(880, 0, 0.04, 'square', 0.04)
      break
    case 'tick':
      tone(1200, 0, 0.04, 'square', 0.025)
      break
    case 'tickUrgent':
      tone(1500, 0, 0.06, 'square', 0.05)
      tone(1500, 0.08, 0.04, 'square', 0.03)
      break
    case 'submit':
      bubble(0, 300)
      bubble(0.07, 420)
      break
    case 'correct':
      tone(523.25, 0, 0.12, 'square', 0.06)
      tone(659.25, 0.08, 0.12, 'square', 0.06)
      tone(783.99, 0.16, 0.25, 'square', 0.06)
      tone(261.63, 0, 0.4, 'triangle', 0.1)
      break
    case 'rare':
      ;[523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => tone(f, i * 0.07, 0.2, 'square', 0.055))
      bubble(0.4, 500)
      bubble(0.48, 700)
      break
    case 'legendary':
      ;[392, 523.25, 659.25, 783.99, 1046.5, 1318.5, 1567.98].forEach((f, i) => {
        tone(f, i * 0.08, 0.6, 'sine', 0.12)
        tone(f * 2, i * 0.08 + 0.02, 0.4, 'triangle', 0.03)
      })
      tone(130.81, 0, 1.4, 'sine', 0.12)
      break
    case 'wrong':
      tone(220, 0, 0.25, 'sawtooth', 0.06, 160)
      tone(164.81, 0.12, 0.35, 'sine', 0.12, 110)
      break
    case 'timeout':
      tone(330, 0, 0.2, 'triangle', 0.1, 200)
      tone(196, 0.2, 0.45, 'sine', 0.12, 120)
      break
    case 'countdown':
      tone(440, 0, 0.1, 'square', 0.07)
      break
    case 'go':
      tone(880, 0, 0.22, 'square', 0.07)
      bubble(0.05, 500)
      break
    case 'results':
      ;[261.63, 329.63, 392, 523.25].forEach((f, i) => tone(f, i * 0.12, 0.5, 'triangle', 0.13))
      tone(130.81, 0, 1.2, 'sine', 0.1)
      break
    case 'dive':
      // Arcade button thunk + bubbles
      tone(196, 0, 0.08, 'square', 0.09, 130)
      bubble(0.05, 320)
      bubble(0.11, 460)
      break
    case 'descend':
      // Falling chiptune sweep with a trail of bubbles
      tone(660, 0, 0.9, 'square', 0.04, 110)
      tone(330, 0.05, 1.0, 'triangle', 0.08, 70)
      for (let i = 0; i < 5; i++) bubble(0.15 + i * 0.13, 300 + i * 70)
      break
    case 'unlock':
      ;[783.99, 987.77, 1174.66, 1567.98].forEach((f, i) => tone(f, i * 0.06, 0.3, 'sine', 0.1))
      break
  }
}
