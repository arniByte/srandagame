import { Container, Graphics } from 'pixi.js'
import { ticker, TICK } from '../../core/ticker'
import { tornPoly } from '../../assets/paperEdge'
import { SM_HZ, visualRng } from '../anim/stopmotion'

/**
 * Обрывки бумаги при cut/promote: рваные клочки порхают вниз,
 * переворачиваясь жёсткими 12fps-шагами.
 */

interface Scrap {
  g: Graphics
  vx: number
  vy: number
  sway: number
  phase: number
  life: number
}

export function paperBurst(
  layer: Container, x: number, y: number,
  colors: number[], count = 9, seed = 1,
): void {
  const rng = visualRng(seed)
  const root = new Container()
  layer.addChild(root)

  const scraps: Scrap[] = []
  for (let i = 0; i < count; i++) {
    const g = new Graphics()
    const color = colors[Math.floor(rng() * colors.length)] ?? 0xf5efe0
    const w = 5 + rng() * 9
    const h = 4 + rng() * 7
    g.poly(tornPoly(
      [-w / 2, -h / 2, w / 2, -h / 2, w / 2, h / 2, -w / 2, h / 2],
      seed + i * 3, { amp: 1.5, step: 3 },
    )).fill(color)
    g.position.set(x + (rng() - 0.5) * 18, y + (rng() - 0.5) * 12)
    g.rotation = rng() * Math.PI
    scraps.push({
      g,
      vx: (rng() - 0.5) * 120,
      vy: -60 - rng() * 110,
      sway: 30 + rng() * 50,
      phase: rng() * Math.PI * 2,
      life: 0.9 + rng() * 0.5,
    })
    root.addChild(g)
  }

  let acc = 0
  let t = 0
  const dtStep = 1 / SM_HZ
  const off = ticker.add((dt) => {
    acc += dt
    while (acc >= dtStep) {
      acc -= dtStep
      t += dtStep
      for (const s of scraps) {
        if (s.life <= 0) continue
        s.life -= dtStep
        // Порхание: гравитация слабая, горизонтальное качание, переворот.
        s.vy += 260 * dtStep
        s.vy = Math.min(s.vy, 130)
        s.g.x += (s.vx + Math.sin(t * 6 + s.phase) * s.sway) * dtStep
        s.g.y += s.vy * dtStep
        s.g.rotation += 0.45 * (Math.sin(t * 5 + s.phase) > 0 ? 1 : -1)
        s.g.scale.y = 0.35 + 0.65 * Math.abs(Math.sin(t * 4 + s.phase)) // «переворот» клочка
        s.g.alpha = Math.min(1, Math.max(0, s.life / 0.3))
        s.vx *= 0.92
      }
    }
    if (scraps.every(s => s.life <= 0)) {
      off()
      root.destroy({ children: true })
    }
  }, TICK.TWEEN)
}
