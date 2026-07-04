import { ticker, TICK } from '../../core/ticker'
import { linear, type Ease } from './easings'

/**
 * Собственный твинер поверх единого тикера (TICK.TWEEN).
 * Ключевая фича — quantizeHz: значения коммитятся ТОЛЬКО на границах шага,
 * между шагами кадр «держится» (истинные hold frames стоп-моушена, 12 fps).
 * Карты и UI твинятся без квантования — плавные 60 fps.
 */

export interface TweenOpts {
  /** Длительность, сек. */
  dur: number
  ease?: Ease
  delay?: number
  /** 12 = стоп-моушен: коммит значений только на границах 1/12 c. */
  quantizeHz?: number
  /** Дополнительный владелец для killTweensOf (например, спрайт при твине его scale). */
  owner?: object
  /** Вызывается на каждом коммите с eased-прогрессом k. */
  onStep?: (k: number) => void
  onDone?: () => void
}

export interface TweenHandle {
  /** Резолвится по завершении ИЛИ убийстве твина. */
  readonly done: Promise<void>
  /** Прервать; commit=true — дописать конечные значения. */
  kill(commit?: boolean): void
}

type NumProps = Record<string, number>

interface Live {
  target: NumProps
  owner: object
  props: NumProps
  from: NumProps | null // ленивый захват на первом активном апдейте
  t: number
  delay: number
  dur: number
  ease: Ease
  qhz: number
  lastQ: number
  onStep: ((k: number) => void) | undefined
  onDone: (() => void) | undefined
  resolve: () => void
  dead: boolean
}

const live: Live[] = []
let ticking = false

function ensureTicking(): void {
  if (ticking) return
  ticking = true
  ticker.add(update, TICK.TWEEN)
}

function update(dt: number): void {
  // Итерация по копии индексов: onDone может добавлять новые твины.
  for (let i = 0; i < live.length; i++) {
    const tw = live[i] as Live
    if (tw.dead) continue
    tw.t += dt
    const e = tw.t - tw.delay
    if (e < 0) continue

    if (tw.from === null) {
      // Захват стартовых значений в момент реального старта (после delay).
      const from: NumProps = {}
      for (const k of Object.keys(tw.props)) from[k] = tw.target[k] ?? 0
      tw.from = from
    }

    let raw = tw.dur <= 0 ? 1 : e / tw.dur
    if (tw.qhz > 0 && raw < 1) {
      // Квантование времени: между границами шага значения не трогаем.
      const qi = Math.floor(e * tw.qhz)
      if (qi === tw.lastQ) continue
      tw.lastQ = qi
      raw = Math.min(qi / (tw.qhz * tw.dur), 1)
    }

    const finished = raw >= 1
    const k = finished ? 1 : tw.ease(Math.max(0, raw))
    commit(tw, k)
    if (finished) finish(tw)
  }
  // Уборка мёртвых.
  for (let i = live.length - 1; i >= 0; i--) {
    if ((live[i] as Live).dead) live.splice(i, 1)
  }
}

function commit(tw: Live, k: number): void {
  const from = tw.from as NumProps
  for (const key of Object.keys(tw.props)) {
    const a = from[key] ?? 0
    const b = tw.props[key] ?? 0
    tw.target[key] = a + (b - a) * k
  }
  tw.onStep?.(k)
}

function finish(tw: Live): void {
  if (tw.dead) return
  tw.dead = true
  const cb = tw.onDone
  tw.resolve()
  cb?.()
}

/** Только числовые свойства цели (методы и объекты не твинятся). */
export type NumericProps<T> = {
  [K in keyof T as T[K] extends number ? K & string : never]?: number
}

/**
 * Твин числовых свойств объекта. Для вложенных (sprite.scale) — передать
 * sprite.scale как target и sprite как opts.owner.
 */
export function tween<T extends object>(
  target: T,
  props: NumericProps<T>,
  opts: TweenOpts,
): TweenHandle {
  ensureTicking()
  let resolve: () => void = () => {}
  const done = new Promise<void>(r => { resolve = r })
  const tw: Live = {
    target: target as unknown as NumProps,
    owner: opts.owner ?? target,
    props: props as NumProps,
    from: null,
    t: 0,
    delay: opts.delay ?? 0,
    dur: Math.max(opts.dur, 0.0001),
    ease: opts.ease ?? linear,
    qhz: opts.quantizeHz ?? 0,
    lastQ: -1,
    onStep: opts.onStep,
    onDone: opts.onDone,
    resolve,
    dead: false,
  }
  live.push(tw)
  return {
    done,
    kill(commitEnd = false): void {
      if (tw.dead) return
      if (commitEnd) {
        if (tw.from === null) {
          const from: NumProps = {}
          for (const k of Object.keys(tw.props)) from[k] = tw.target[k] ?? 0
          tw.from = from
        }
        commit(tw, 1)
      }
      tw.dead = true
      tw.resolve()
    },
  }
}

/** Убить все твины объекта (target или owner совпадает). */
export function killTweensOf(obj: object): void {
  for (const tw of live) {
    if (!tw.dead && (tw.target === (obj as unknown) || tw.owner === obj)) {
      tw.dead = true
      tw.resolve()
    }
  }
}

/** Пауза на игровом времени тикера (уважает ticker.speed). */
export function wait(sec: number): Promise<void> {
  const dummy = { v: 0 }
  return tween(dummy, { v: 1 }, { dur: Math.max(sec, 0.0001) }).done
}

type SeqStep = () => TweenHandle | Promise<unknown> | void

/** Timeline-хелпер: шаги выполняются строго последовательно. */
export async function sequence(steps: SeqStep[]): Promise<void> {
  for (const step of steps) {
    const r = step()
    if (r && typeof (r as TweenHandle).done?.then === 'function') {
      await (r as TweenHandle).done
    } else if (r && typeof (r as Promise<unknown>).then === 'function') {
      await (r as Promise<unknown>)
    }
  }
}
