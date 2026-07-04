import { bus } from '../core/bus'
import { viewport } from '../core/resize'
import { PAL, cssColor } from '../assets/palette'

/**
 * Canvas2d-художники слоёв диорамы. Используются двумя потребителями:
 * - StaticDiorama (quality 'low'): один плоский фон без WebGL;
 * - DioramaScene (three): те же картинки как текстуры плоскостей.
 */

function rng32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function mkCanvas(w: number, h: number): { cv: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const cv = document.createElement('canvas')
  cv.width = Math.max(2, Math.round(w))
  cv.height = Math.max(2, Math.round(h))
  const ctx = cv.getContext('2d') as CanvasRenderingContext2D
  return { cv, ctx }
}

/** Рваная кромка: путь вдоль верхнего края y≈topY с дрожью амплитуды amp. */
function tornRidge(ctx: CanvasRenderingContext2D, w: number, h: number, topY: number, amp: number, seed: number, waves: number): void {
  const rnd = rng32(seed)
  ctx.beginPath()
  ctx.moveTo(-4, h + 4)
  ctx.lineTo(-4, topY)
  const n = 26
  for (let i = 0; i <= n; i++) {
    const x = (i / n) * (w + 8) - 4
    const wave = Math.sin((i / n) * Math.PI * waves + seed % 7) * amp * 0.7
    const tear = (rnd() * 2 - 1) * amp * 0.5
    ctx.lineTo(x, topY + wave + tear)
  }
  ctx.lineTo(w + 4, h + 4)
  ctx.closePath()
}

// ---------------------------------------------------------------------------
// Слои

/** Небо: тёмный фон с тёплым свечением у горизонта. */
export function paintSky(w: number, h: number): HTMLCanvasElement {
  const { cv, ctx } = mkCanvas(w, h)
  const grad = ctx.createLinearGradient(0, 0, 0, h)
  grad.addColorStop(0, cssColor(PAL.bg))
  grad.addColorStop(0.5, '#2b2118')
  grad.addColorStop(0.8, '#5a3a20')
  grad.addColorStop(1, '#8a4d24')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, w, h)
  return cv
}

/** Солнце-круг Малевича: охра с рваным краем и кольцом киновари. */
export function paintSun(size: number): HTMLCanvasElement {
  const { cv, ctx } = mkCanvas(size, size)
  const r = size * 0.42
  const c = size / 2
  const rnd = rng32(77)
  const blob = (radius: number, color: string, alpha: number): void => {
    ctx.beginPath()
    const n = 30
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2
      const rr = radius * (1 + (rnd() * 2 - 1) * 0.03)
      const x = c + Math.cos(a) * rr
      const y = c + Math.sin(a) * rr
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.closePath()
    ctx.globalAlpha = alpha
    ctx.fillStyle = color
    ctx.fill()
    ctx.globalAlpha = 1
  }
  blob(r * 1.12, cssColor(PAL.vermilion), 0.55)
  blob(r, cssColor(PAL.ochre), 1)
  return cv
}

/** Слой бумажных холмов-силуэтов. */
export function paintHills(w: number, h: number, color: number, seed: number, topFrac: number): HTMLCanvasElement {
  const { cv, ctx } = mkCanvas(w, h)
  ctx.fillStyle = cssColor(color)
  tornRidge(ctx, w, h, h * topFrac, h * 0.05, seed, 2.6)
  ctx.fill()
  // Тонкая светлая кромка «среза бумаги».
  ctx.strokeStyle = 'rgba(245,239,224,0.16)'
  ctx.lineWidth = Math.max(1, h * 0.006)
  tornRidge(ctx, w, h, h * topFrac, h * 0.05, seed, 2.6)
  ctx.stroke()
  return cv
}

/** Силуэт замка из простых форм (бруски + треугольники + ворота-арка). */
export function paintCastle(w: number, h: number): HTMLCanvasElement {
  const { cv, ctx } = mkCanvas(w, h)
  const ink = cssColor(PAL.ink)
  const blue = cssColor(PAL.blue)
  const base = h * 0.98

  const tower = (x: number, tw: number, th: number, roof: boolean, color: string): void => {
    ctx.fillStyle = color
    ctx.fillRect(x - tw / 2, base - th, tw, th)
    if (roof) {
      ctx.beginPath()
      ctx.moveTo(x - tw * 0.72, base - th)
      ctx.lineTo(x + tw * 0.72, base - th)
      ctx.lineTo(x, base - th - tw * 1.15)
      ctx.closePath()
      ctx.fill()
    }
  }

  tower(w * 0.22, w * 0.13, h * 0.52, true, ink)
  tower(w * 0.5, w * 0.17, h * 0.72, true, ink)
  tower(w * 0.78, w * 0.12, h * 0.46, true, blue)
  // Стена и арка ворот.
  ctx.fillStyle = ink
  ctx.fillRect(w * 0.14, base - h * 0.3, w * 0.72, h * 0.3)
  ctx.fillStyle = cssColor(PAL.ochre)
  ctx.beginPath()
  ctx.arc(w * 0.5, base, w * 0.085, Math.PI, 0)
  ctx.closePath()
  ctx.fill()
  // Флажок киновари.
  ctx.fillStyle = cssColor(PAL.vermilion)
  ctx.beginPath()
  ctx.moveTo(w * 0.5, base - h * 0.72 - w * 0.19)
  ctx.lineTo(w * 0.5 + w * 0.09, base - h * 0.72 - w * 0.13)
  ctx.lineTo(w * 0.5, base - h * 0.72 - w * 0.07)
  ctx.closePath()
  ctx.fill()
  return cv
}

/** Передний рваный край кремовой бумаги (низ кадра). */
export function paintFrontEdge(w: number, h: number): HTMLCanvasElement {
  const { cv, ctx } = mkCanvas(w, h)
  ctx.fillStyle = 'rgba(20,18,15,0.55)'
  tornRidge(ctx, w, h, h * 0.42, h * 0.16, 913, 4.2)
  ctx.fill()
  ctx.fillStyle = cssColor(PAL.paper)
  ctx.globalAlpha = 0.1
  tornRidge(ctx, w, h, h * 0.38, h * 0.16, 913, 4.2)
  ctx.fill()
  ctx.globalAlpha = 1
  return cv
}

// ---------------------------------------------------------------------------

/**
 * Статичная диорама (quality 'low'): один canvas2d-фон без WebGL.
 * Слушает bus 'resize' и перерисовывается.
 */
export class StaticDiorama {
  private offResize: () => void

  constructor(private canvas: HTMLCanvasElement) {
    this.paint(viewport.w, viewport.h, viewport.dpr)
    this.offResize = bus.on('resize', ({ w, h, dpr }) => this.paint(w, h, dpr))
  }

  private paint(w: number, h: number, dpr: number): void {
    this.canvas.width = Math.max(2, Math.round(w * dpr))
    this.canvas.height = Math.max(2, Math.round(h * dpr))
    const ctx = this.canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    ctx.drawImage(paintSky(w, h), 0, 0)
    const sun = Math.min(w, h) * 0.34
    ctx.drawImage(paintSun(sun), w * 0.12, h * 0.1)
    ctx.drawImage(paintHills(w, h * 0.5, 0x2a2013, 41, 0.35), 0, h * 0.42)
    const cw = Math.min(w * 0.4, h * 0.6)
    ctx.drawImage(paintCastle(cw, cw * 0.8), w * 0.55, h * 0.5 - cw * 0.52)
    ctx.drawImage(paintHills(w, h * 0.45, 0x191510, 88, 0.3), 0, h * 0.58)
    ctx.drawImage(paintFrontEdge(w, h * 0.22), 0, h * 0.82)
  }

  dispose(): void {
    this.offResize()
  }
}
