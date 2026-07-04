import { Container, Graphics } from 'pixi.js'
import { ticker, TICK } from '../../core/ticker'
import { tornCircle } from '../../assets/paperEdge'
import { SM_HZ, visualRng } from '../anim/stopmotion'

/**
 * Брызги краски цветом фракции жертвы: квадратики/кружки разлетаются
 * с гравитацией (12fps-степпинг — «кукольные» брызги), 2-3 кляксы
 * остаются на доске и тают 3 секунды.
 */

interface Particle {
  g: Graphics
  vx: number
  vy: number
  spin: number
  life: number
  groundY: number
  landed: boolean
}

const GRAVITY = 1500

export function splatter(
  layer: Container, x: number, y: number,
  colors: number[], seed = 1,
): void {
  const rng = visualRng(seed)
  const root = new Container()
  layer.addChild(root)

  // Кляксы — под частицами, остаются и тают.
  const blobs: Graphics[] = []
  const nBlobs = 2 + Math.floor(rng() * 2)
  for (let i = 0; i < nBlobs; i++) {
    const b = new Graphics()
    const color = colors[Math.floor(rng() * colors.length)] ?? 0x000000
    b.poly(tornCircle(4 + rng() * 7, seed + 40 + i, { amp: 2.5, step: 3 })).fill(color)
    b.position.set(x + (rng() - 0.5) * 46, y + (rng() - 0.5) * 26 + 8)
    b.alpha = 0.85
    root.addChild(b)
    blobs.push(b)
  }

  // Летящие капли.
  const parts: Particle[] = []
  const n = 12 + Math.floor(rng() * 13)
  for (let i = 0; i < n; i++) {
    const g = new Graphics()
    const color = colors[Math.floor(rng() * colors.length)] ?? 0x000000
    const size = 2.5 + rng() * 4
    if (rng() < 0.5) g.rect(-size / 2, -size / 2, size, size).fill(color)
    else g.circle(0, 0, size / 2).fill(color)
    g.position.set(x + (rng() - 0.5) * 10, y - 6)
    const ang = -Math.PI / 2 + (rng() - 0.5) * 1.9
    const speed = 140 + rng() * 260
    parts.push({
      g,
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed,
      spin: (rng() - 0.5) * 10,
      life: 0.55 + rng() * 0.35,
      groundY: y + 6 + rng() * 30,
      landed: false,
    })
    root.addChild(g)
  }

  // Степпинг 12 Гц: физика тикает жёсткими шагами (hold frames).
  let acc = 0
  let blobT = 0
  const dtStep = 1 / SM_HZ
  const off = ticker.add((dt) => {
    acc += dt
    blobT += dt
    while (acc >= dtStep) {
      acc -= dtStep
      for (const pt of parts) {
        if (pt.life <= 0) continue
        pt.life -= dtStep
        if (pt.landed) { pt.g.alpha = Math.max(pt.life, 0); continue }
        pt.vy += GRAVITY * dtStep
        pt.g.x += pt.vx * dtStep
        pt.g.y += pt.vy * dtStep
        pt.g.rotation += pt.spin * dtStep
        if (pt.g.y >= pt.groundY && pt.vy > 0) {
          pt.landed = true
          pt.g.y = pt.groundY
          pt.g.scale.set(1.3, 0.6)
        }
        if (pt.life <= 0) pt.g.alpha = 0
      }
    }
    // Кляксы тают плавно (они уже «приклеены», не стоп-моушен).
    const blobAlpha = Math.max(0, 1 - blobT / 3)
    for (const b of blobs) b.alpha = 0.85 * blobAlpha

    if (blobT >= 3 && parts.every(pt => pt.life <= 0)) {
      off()
      root.destroy({ children: true })
    }
  }, TICK.TWEEN)
}
