import { ticker, TICK } from '../../core/ticker'
import { tween, wait } from './tween'

/**
 * Пресеты стоп-моушена поверх твинера. Всё квантовано на 12 fps —
 * фигуры и доска двигаются «кукольно», с истинными hold frames.
 */

export const SM_HZ = 12
const STEP = 1 / SM_HZ

/** Минимальный контракт цели (Pixi Container подходит). */
export interface SpriteLike {
  x: number
  y: number
  rotation: number
  alpha: number
  scale: { x: number; y: number }
}

export interface XY { x: number; y: number }

/** Сидированный ВИЗУАЛЬНЫЙ rng (mulberry32) — на игровую логику не влияет. */
export function visualRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Дрожь одного шага: поворот ±1.5°, позиция ±0.5px. */
export function jitterStep(rng: () => number): { rot: number; dx: number; dy: number } {
  return {
    rot: (rng() * 2 - 1) * (1.5 * Math.PI / 180),
    dx: (rng() * 2 - 1) * 0.5,
    dy: (rng() * 2 - 1) * 0.5,
  }
}

export interface HopOpts {
  /** Высота дуги, px. */
  arc?: number
  /** Шагов полёта (3-4). */
  steps?: number
  seed?: number
  /** Колбэк высоты полёта h ∈ [0,1] — для тени. */
  onAir?: (h: number) => void
}

/**
 * Прыжок фигуры: анти-присед (1 шаг) → полёт по дуге (3-4 шага) →
 * squash при приземлении (ровно 1 шаг) → settle с overshoot.
 */
export async function hopMove(sprite: SpriteLike, from: XY, to: XY, opts: HopOpts = {}): Promise<void> {
  const arc = opts.arc ?? 26
  const nSteps = Math.max(2, Math.min(opts.steps ?? 3, 4))
  const rng = visualRng(opts.seed ?? 1)
  const dir = Math.sign(to.x - from.x) || (rng() < 0.5 ? -1 : 1)
  const onAir = opts.onAir

  // 1. Анти-присед: 1 шаг до прыжка.
  sprite.x = from.x
  sprite.y = from.y
  sprite.scale.x = 1.08
  sprite.scale.y = 0.9
  sprite.rotation = -dir * 0.04
  await wait(STEP)

  // 2. Полёт: вытянут, дуга-парабола, на каждом шаге лёгкая дрожь.
  sprite.scale.x = 0.96
  sprite.scale.y = 1.06
  const proxy = { k: 0 }
  await tween(proxy, { k: 1 }, {
    dur: nSteps * STEP,
    quantizeHz: SM_HZ,
    owner: sprite,
    onStep: (k) => {
      const h = 4 * k * (1 - k) // 0..1..0
      const j = jitterStep(rng)
      sprite.x = from.x + (to.x - from.x) * k + j.dx
      sprite.y = from.y + (to.y - from.y) * k - arc * h + j.dy
      sprite.rotation = dir * 0.07 * (1 - k) + j.rot
      onAir?.(h)
    },
  }).done

  // 3. Приземление: squash ровно 1 шаг.
  sprite.x = to.x
  sprite.y = to.y
  sprite.scale.x = 1.12
  sprite.scale.y = 0.82
  sprite.rotation = jitterStep(rng).rot
  onAir?.(0)
  await wait(STEP)

  // 4. Settle: overshoot вверх...
  sprite.scale.x = 0.97
  sprite.scale.y = 1.05
  await wait(STEP)

  // 5. ...и покой.
  sprite.scale.x = 1
  sprite.scale.y = 1
  sprite.rotation = 0
}

export interface SwayHandle {
  stop(): void
  setPaused(on: boolean): void
}

/**
 * Медленное 2-кадровое покачивание в простое: rotation прыгает между
 * двумя положениями (никакой плавности — это аппликация на столе).
 */
export function idleSway(sprite: SpriteLike, phaseOffset = 0, amp = 0.028): SwayHandle {
  let t = phaseOffset
  let paused = false
  let lastFrame = -1
  const off = ticker.add((dt) => {
    if (paused) return
    t += dt
    const frame = Math.floor(t * 1.6) % 2 // ~0.6 c на кадр
    if (frame === lastFrame) return
    lastFrame = frame
    sprite.rotation = frame === 0 ? -amp : amp
  }, TICK.TWEEN)
  return {
    stop(): void { off() },
    setPaused(on: boolean): void {
      paused = on
      if (on) { sprite.rotation = 0; lastFrame = -1 }
    },
  }
}

/** Опрокидывание жертвы: 2 жёстких шага набок, затем короткое растворение. */
export async function tipOver(sprite: SpriteLike, seed = 1): Promise<void> {
  const rng = visualRng(seed)
  const dir = rng() < 0.5 ? -1 : 1

  sprite.rotation = dir * 0.85
  sprite.x += dir * 5
  sprite.y += 2
  await wait(STEP)

  sprite.rotation = dir * 1.5
  sprite.x += dir * 7
  sprite.y += 6
  sprite.scale.y = 0.92
  await wait(STEP)

  // Растворение — тоже ступенчатое (3 шага).
  await tween(sprite, { alpha: 0 }, { dur: 3 * STEP, quantizeHz: SM_HZ }).done
}
