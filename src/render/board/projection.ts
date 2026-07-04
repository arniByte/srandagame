import { mkSq, sqX, sqY, type Sq } from '../../engine/types'

/**
 * Проекция сетки доски в экран. Лёгкая «oblique»-театральность:
 * клетки чуть сжаты по вертикали (H = W * 0.86) — доска как стол,
 * на который смотрят сверху-сбоку. sqToXY/xyToSq строго взаимообратны.
 */

export const CELL_RATIO = 0.86

export interface Projection {
  /** Ширина клетки, px. */
  cell: number
  /** Высота клетки, px (cell * CELL_RATIO). */
  cellH: number
  /** Левый верхний угол доски. */
  ox: number
  oy: number
  /** Размер доски в клетках. */
  bw: number
  bh: number
}

export interface Rect { x: number; y: number; w: number; h: number }

/** Вписывает доску bw×bh в прямоугольник rect (центрирование). */
export function computeProjection(bw: number, bh: number, rect: Rect): Projection {
  const cell = Math.max(
    24,
    Math.min(96, Math.floor(Math.min(rect.w / bw, rect.h / (bh * CELL_RATIO)))),
  )
  const cellH = Math.round(cell * CELL_RATIO)
  const ox = Math.round(rect.x + (rect.w - bw * cell) / 2)
  const oy = Math.round(rect.y + (rect.h - bh * cellH) / 2)
  return { cell, cellH, ox, oy, bw, bh }
}

/** Центр клетки в экранных координатах. */
export function sqToXY(p: Projection, sq: Sq): { x: number; y: number } {
  return {
    x: p.ox + (sqX(sq) + 0.5) * p.cell,
    y: p.oy + (sqY(sq) + 0.5) * p.cellH,
  }
}

/** Обратная проекция: экранная точка → клетка; -1, если мимо доски. */
export function xyToSq(p: Projection, px: number, py: number): Sq {
  const x = Math.floor((px - p.ox) / p.cell)
  const y = Math.floor((py - p.oy) / p.cellH)
  if (x < 0 || y < 0 || x >= p.bw || y >= p.bh) return -1
  return mkSq(x, y)
}

/** Размер клетки под фигуру/тайл (для масштабирования спрайтов). */
export function tileSize(p: Projection): number {
  return p.cell
}
