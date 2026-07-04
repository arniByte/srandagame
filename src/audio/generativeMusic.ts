/**
 * Генеративный эмбиент «бумажной галереи»: тёплый дрон + редкие
 * пентатонические щипки с мягкой атакой. Никаких аудиофайлов —
 * всё синтезируется на лету. Чисто презентационный слой (Math.random ок).
 */

const PENTA = [0, 3, 5, 7, 10] // минорная пентатоника, полутоны от тоники

export interface MusicMood {
  /** Тоника в герцах. */
  root: number
  /** Средний интервал между щипками, сек. */
  pace: number
  /** Общая громкость слоя. */
  level: number
}

export const MOODS: Record<string, MusicMood> = {
  menu: { root: 174.61, pace: 2.6, level: 0.5 },   // F3 — спокойно
  map: { root: 196.0, pace: 2.2, level: 0.5 },     // G3
  battle: { root: 146.83, pace: 1.6, level: 0.62 }, // D3 — собранно
  boss: { root: 130.81, pace: 1.2, level: 0.72 },   // C3 — тревожно
}

export class GenerativeMusic {
  private drone: { osc: OscillatorNode; gain: GainNode }[] = []
  private timer: ReturnType<typeof setTimeout> | null = null
  private mood: MusicMood | null = null
  private out: GainNode

  constructor(private ctx: AudioContext, bus: AudioNode) {
    this.out = ctx.createGain()
    this.out.gain.value = 0
    this.out.connect(bus)
  }

  /** Переключить настроение (null = тишина) с мягким кроссфейдом. */
  setMood(mood: MusicMood | null): void {
    const now = this.ctx.currentTime
    if (!mood) {
      this.out.gain.setTargetAtTime(0, now, 1.2)
      this.stopPlucks()
      // Дрон гасим, но не убиваем — вдруг вернёмся.
      return
    }
    const restart = !this.mood || this.mood.root !== mood.root
    this.mood = mood
    this.out.gain.setTargetAtTime(mood.level, now, 1.5)
    if (restart) this.rebuildDrone(mood.root)
    if (!this.timer) this.schedulePluck()
  }

  private rebuildDrone(root: number): void {
    const now = this.ctx.currentTime
    for (const d of this.drone) {
      d.gain.gain.setTargetAtTime(0, now, 0.8)
      d.osc.stop(now + 3)
    }
    this.drone = []
    // Два слоя: тоника и квинта, слегка расстроенные пары.
    for (const [mult, vol] of [[1, 0.05], [1.5, 0.028], [2, 0.016]] as const) {
      for (const detune of [-4, 4]) {
        const osc = this.ctx.createOscillator()
        osc.type = 'triangle'
        osc.frequency.value = root * mult
        osc.detune.value = detune
        const gain = this.ctx.createGain()
        gain.gain.value = 0
        gain.gain.setTargetAtTime(vol, now, 2.5)
        osc.connect(gain)
        gain.connect(this.out)
        osc.start()
        this.drone.push({ osc, gain })
      }
    }
  }

  private schedulePluck(): void {
    const mood = this.mood
    if (!mood) { this.timer = null; return }
    const delay = mood.pace * (0.6 + Math.random() * 0.9) * 1000
    this.timer = setTimeout(() => {
      this.pluck()
      this.schedulePluck()
    }, delay)
  }

  private pluck(): void {
    const mood = this.mood
    if (!mood || this.ctx.state !== 'running') return
    const now = this.ctx.currentTime
    const step = PENTA[Math.floor(Math.random() * PENTA.length)] as number
    const octave = Math.random() < 0.3 ? 4 : 2
    const freq = mood.root * octave * Math.pow(2, step / 12)

    const osc = this.ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = freq
    const gain = this.ctx.createGain()
    const vol = 0.05 + Math.random() * 0.05
    gain.gain.setValueAtTime(0, now)
    gain.gain.linearRampToValueAtTime(vol, now + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 2.2)

    // Лёгкое «бумажное» трение в атаке.
    const noise = this.ctx.createOscillator()
    noise.type = 'sawtooth'
    noise.frequency.value = freq * 2.002
    const ngain = this.ctx.createGain()
    ngain.gain.setValueAtTime(vol * 0.12, now)
    ngain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18)

    osc.connect(gain)
    noise.connect(ngain)
    gain.connect(this.out)
    ngain.connect(this.out)
    osc.start(now)
    noise.start(now)
    osc.stop(now + 2.4)
    noise.stop(now + 0.3)
  }

  private stopPlucks(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.mood = null
  }
}
