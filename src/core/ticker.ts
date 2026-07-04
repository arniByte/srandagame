/**
 * ЕДИНСТВЕННЫЙ requestAnimationFrame-цикл игры.
 * Порядок кадра: ввод (обрабатывается событиями) → твины → Pixi render → Three render.
 * Подписчики регистрируются с приоритетом; пауза на visibilitychange.
 */
type TickFn = (dt: number, now: number) => void

interface Entry { fn: TickFn; priority: number }

class Ticker {
  private entries: Entry[] = []
  private rafId = 0
  private last = 0
  private running = false
  /** Множитель скорости (для тестов: ?test=1 ставит 4). */
  speed = 1

  add(fn: TickFn, priority = 0): () => void {
    const e = { fn, priority }
    this.entries.push(e)
    this.entries.sort((a, b) => a.priority - b.priority)
    return () => {
      const i = this.entries.indexOf(e)
      if (i >= 0) this.entries.splice(i, 1)
    }
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.last = performance.now()
    const loop = (now: number) => {
      if (!this.running) return
      // Кап dt: после свёрнутой вкладки не прыгаем сквозь время.
      const dt = Math.min((now - this.last) / 1000, 0.1) * this.speed
      this.last = now
      for (const e of [...this.entries]) e.fn(dt, now)
      this.rafId = requestAnimationFrame(loop)
    }
    this.rafId = requestAnimationFrame(loop)

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.running = false
        cancelAnimationFrame(this.rafId)
      } else if (!this.running) {
        this.start()
      }
    })
  }
}

export const ticker = new Ticker()

/** Приоритеты подписчиков (меньше = раньше в кадре). */
export const TICK = {
  TWEEN: 10,
  GAME: 20,
  PIXI: 50,
  DIORAMA: 60,
} as const
