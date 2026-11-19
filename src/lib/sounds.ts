// Tiny WebAudio sound effects — no assets, generated on the fly.
// Kept deliberately simple and quiet; there is a mute toggle in the lobby.

const MUTED_KEY = 'meme-muted'

let ctx: AudioContext | null = null

/** Read the persisted mute flag. Safe during SSR and when storage is blocked. */
function readMuted(): boolean {
  try {
    if (typeof window === 'undefined') return false
    return localStorage.getItem(MUTED_KEY) === '1'
  } catch {
    return false
  }
}

// Initialize from localStorage so a page reload keeps the mute state.
let muted = readMuted()

function audio(): AudioContext | null {
  try {
    if (!ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      if (!AC) return null
      ctx = new AC()
    }
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

export function setMuted(m: boolean) {
  muted = m
  try {
    if (typeof window !== 'undefined') localStorage.setItem(MUTED_KEY, m ? '1' : '0')
  } catch {
    // storage unavailable (private mode / blocked cookies) — mute still works in-memory
  }
}

export function isMuted() {
  return muted
}

function tone(freq: number, start: number, duration: number, type: OscillatorType, volume = 0.08, glideTo?: number) {
  // Central gate: every effect goes through here, so muting silences everything.
  if (muted) return
  const ac = audio()
  if (!ac) return
  const t0 = ac.currentTime + start
  const osc = ac.createOscillator()
  const gain = ac.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t0)
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(30, glideTo), t0 + duration)
  gain.gain.setValueAtTime(volume, t0)
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration)
  osc.connect(gain).connect(ac.destination)
  osc.start(t0)
  osc.stop(t0 + duration + 0.02)
}

export const sounds = {
  join() {
    tone(520, 0, 0.12, 'triangle', 0.06)
    tone(780, 0.08, 0.15, 'triangle', 0.06)
  },
  countdown() {
    tone(880, 0, 0.1, 'square', 0.04)
  },
  tick() {
    tone(440, 0, 0.06, 'square', 0.03)
  },
  submit() {
    tone(660, 0, 0.08, 'triangle', 0.05)
    tone(990, 0.06, 0.1, 'triangle', 0.05)
  },
  vote() {
    tone(520, 0, 0.05, 'square', 0.025)
  },
  memeShown() {
    tone(392, 0, 0.12, 'triangle', 0.05)
    tone(494, 0.09, 0.12, 'triangle', 0.05)
  },
  results() {
    tone(523, 0, 0.1, 'triangle', 0.06)
    tone(659, 0.09, 0.1, 'triangle', 0.06)
    tone(784, 0.18, 0.18, 'triangle', 0.06)
  },
  win() {
    tone(523, 0, 0.12, 'triangle', 0.07)
    tone(659, 0.11, 0.12, 'triangle', 0.07)
    tone(784, 0.22, 0.12, 'triangle', 0.07)
    tone(1047, 0.33, 0.3, 'triangle', 0.07)
  },
  error() {
    tone(220, 0, 0.15, 'sawtooth', 0.04)
    tone(180, 0.1, 0.2, 'sawtooth', 0.04)
  },
  // warm up the audio context on the first user gesture so sounds are allowed
  unlock() {
    audio()
  },
}
