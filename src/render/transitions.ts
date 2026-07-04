import { viewport } from '../core/resize'
import { audio } from '../audio/audioManager'
import { SM_HZ, visualRng } from './anim/stopmotion'
import { killTweensOf, tween, wait } from './anim/tween'
import type { BattleScene } from './battleScene'

/**
 * Коллажный вход/выход боевой сцены: тайлы влетают с краёв со стаггером
 * и вращением (12 fps), фигуры падают сверху со squash, рука сдаётся
 * по карте. Выход — обратный разлёт.
 */

/** С какого края прилетает тайл (ближайший к нему). */
function offscreenFrom(x: number, y: number, w: number, h: number, rng: () => number): { x: number; y: number } {
  const dl = x, dr = w - x, dt = y, db = h - y
  const m = Math.min(dl, dr, dt, db)
  const jitter = (rng() - 0.5) * 120
  if (m === dl) return { x: -80, y: y + jitter }
  if (m === dr) return { x: w + 80, y: y + jitter }
  if (m === dt) return { x: x + jitter, y: -80 }
  return { x: x + jitter, y: h + 80 }
}

export async function collageIn(scene: BattleScene): Promise<void> {
  const { tiles, pieces, hand } = scene.collageParts()
  const w = viewport.w, h = viewport.h
  const rng = visualRng(4242)

  // 1. Тайлы: прячем, затем влетают со стаггером и вращением.
  const homes = tiles.map(sp => ({ sp, x: sp.x, y: sp.y, rot: sp.rotation }))
  for (const t of homes) {
    const from = offscreenFrom(t.x, t.y, w, h, rng)
    t.sp.position.set(from.x, from.y)
    t.sp.rotation = (rng() - 0.5) * 2.4
    t.sp.alpha = 1
  }
  // Фигуры и рука пока невидимы.
  const pieceHomes = pieces.map(pc => ({ pc, y: pc.y }))
  for (const p of pieceHomes) { p.pc.alpha = 0 }

  audio.sfx('card', 0.6)
  const jobs: Promise<void>[] = []
  homes.forEach((t, i) => {
    jobs.push(tween(t.sp, { x: t.x, y: t.y, rotation: t.rot }, {
      dur: 5 / SM_HZ,
      quantizeHz: SM_HZ,
      delay: i * 0.018,
    }).done)
  })
  await Promise.all(jobs)

  // 2. Фигуры падают сверху со squash (пачками, со стаггером).
  const drops: Promise<void>[] = []
  pieceHomes.forEach((p, i) => {
    drops.push((async () => {
      await wait(i * 0.05)
      const pc = p.pc
      pc.alpha = 1
      pc.y = p.y - 90
      await tween(pc, { y: p.y }, { dur: 3 / SM_HZ, quantizeHz: SM_HZ }).done
      pc.scale.set(1.16, 0.78)
      await wait(1 / SM_HZ)
      pc.scale.set(0.95, 1.07)
      await wait(1 / SM_HZ)
      pc.scale.set(1, 1)
      if (i % 3 === 0) audio.sfx('move', 0.5)
    })())
  })
  await Promise.all(drops)

  // 3. Рука сдаётся по карте.
  await hand.dealIn()
}

export async function collageOut(scene: BattleScene): Promise<void> {
  const { tiles, pieces, hand } = scene.collageParts()
  const w = viewport.w, h = viewport.h
  const rng = visualRng(2424)

  // 1. Рука уходит.
  await hand.dealOut()

  // 2. Фигуры тают со сжатием.
  const fades: Promise<void>[] = []
  pieces.forEach((pc, i) => {
    killTweensOf(pc)
    fades.push(tween(pc, { alpha: 0, y: pc.y - 30 }, {
      dur: 3 / SM_HZ, quantizeHz: SM_HZ, delay: i * 0.03,
    }).done)
  })
  await Promise.all(fades)

  // 3. Тайлы разлетаются обратно к краям.
  audio.sfx('card', 0.6)
  const jobs: Promise<void>[] = []
  tiles.forEach((sp, i) => {
    const to = offscreenFrom(sp.x, sp.y, w, h, rng)
    killTweensOf(sp)
    jobs.push(tween(sp, { x: to.x, y: to.y, rotation: (rng() - 0.5) * 2.4, alpha: 0.9 }, {
      dur: 4 / SM_HZ,
      quantizeHz: SM_HZ,
      delay: i * 0.012,
    }).done)
  })
  await Promise.all(jobs)
}
