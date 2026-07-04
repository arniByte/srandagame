import { mkSq, sqX, sqY, type Sq } from '../../engine/types'

/**
 * Перспективная проекция доски: трапеция «стола», на который смотрят
 * сверху-сбоку. Верхние (дальние) ряды меньше и уже, нижние — крупнее.
 * sqToXY/xyToSq строго взаимообратны.
 */

export const CELL_RATIO = 0.82
/** Сила перспективы: масштаб самого дальнего ряда = 1 - PERSP. */
export const PERSP = 0.36

/**
 * Углы «камеры» для осмотра доски (RMB-drag). yaw — поворот вбок:
 * дальние ряды сдвигаются горизонтально (шеар). pitch — высота камеры:
 * +1 = почти вид сверху (перспектива слабеет, клетки квадратнее),
 * -1 = низкий взгляд (перспектива сильнее, клетки площе).
 */
export interface ViewAngle { yaw: number; pitch: number }

export interface Projection {
  /** Ширина клетки БЛИЖНЕГО (нижнего) ряда, px. */
  cell: number
  /** Высота клетки ближнего ряда, px. */
  cellH: number
  /** Центр доски по X. */
  cx: number
  /** Совместимость: левый край нижнего ряда / верх доски. */
  ox: number
  oy: number
  bw: number
  bh: number
  /** Фактическая сила перспективы (меняется с pitch). */
  persp: number
  /** Масштаб каждого ряда (индекс = y, 0 — дальний). */
  rowScale: number[]
  /** Экранный Y центра ряда. */
  rowCY: number[]
  /** Верх/низ ряда (для обратной проекции). */
  rowTop: number[]
  rowBottom: number[]
  /** Горизонтальный сдвиг ряда от yaw (шеар «вращения»). */
  rowOffX: number[]
}

export interface Rect { x: number; y: number; w: number; h: number }

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

const scaleOf = (y: number, bh: number, persp: number): number => {
  const depth = bh <= 1 ? 0 : (bh - 1 - y) / (bh - 1)
  return 1 - persp * depth
}

/** Вписывает трапецию доски bw×bh в прямоугольник rect (центрирование). */
export function computeProjection(bw: number, bh: number, rect: Rect, view?: ViewAngle): Projection {
  const pitch = clamp(view?.pitch ?? 0, -1, 1)
  const yaw = clamp(view?.yaw ?? 0, -1.2, 1.2)
  const persp = clamp(PERSP - pitch * 0.2, 0.12, 0.55)
  const ratio = clamp(CELL_RATIO + pitch * 0.16, 0.6, 1.0)

  let sumScale = 0
  for (let y = 0; y < bh; y++) sumScale += scaleOf(y, bh, persp)

  const cell = Math.max(
    24,
    Math.min(110, Math.floor(Math.min(rect.w / bw, rect.h / (sumScale * ratio)))),
  )
  const cellH = cell * ratio
  const totalH = sumScale * cellH
  const cx = rect.x + rect.w / 2
  const bottom = rect.y + (rect.h + totalH) / 2

  const rowScale = new Array<number>(bh)
  const rowCY = new Array<number>(bh)
  const rowTop = new Array<number>(bh)
  const rowBottom = new Array<number>(bh)
  const rowOffX = new Array<number>(bh)
  let cursor = bottom
  for (let y = bh - 1; y >= 0; y--) {
    const s = scaleOf(y, bh, persp)
    const depth = bh <= 1 ? 0 : (bh - 1 - y) / (bh - 1)
    rowScale[y] = s
    rowBottom[y] = cursor
    rowTop[y] = cursor - cellH * s
    rowCY[y] = cursor - (cellH * s) / 2
    rowOffX[y] = yaw * cell * 1.45 * depth
    cursor = rowTop[y] as number
  }

  return {
    cell, cellH, cx,
    ox: cx - (bw * cell) / 2,
    oy: rowTop[0] ?? rect.y,
    bw, bh, persp, rowScale, rowCY, rowTop, rowBottom, rowOffX,
  }
}

/** Масштаб ряда клетки. */
export function scaleAt(p: Projection, y: number): number {
  return p.rowScale[Math.max(0, Math.min(p.bh - 1, y))] ?? 1
}

/** Ширина клетки в ряду y (для масштабирования фигур/тайлов). */
export function cellAt(p: Projection, y: number): number {
  return p.cell * scaleAt(p, y)
}

/** Центр клетки в экранных координатах. */
export function sqToXY(p: Projection, sq: Sq): { x: number; y: number } {
  const x = sqX(sq), y = sqY(sq)
  const s = scaleAt(p, y)
  return {
    x: p.cx + (x - (p.bw - 1) / 2) * p.cell * s + (p.rowOffX[y] ?? 0),
    y: p.rowCY[y] ?? 0,
  }
}

/** Обратная проекция: экранная точка → клетка; -1, если мимо доски. */
export function xyToSq(p: Projection, px: number, py: number): Sq {
  for (let y = 0; y < p.bh; y++) {
    if (py < (p.rowTop[y] as number) || py >= (p.rowBottom[y] as number)) continue
    const s = scaleAt(p, y)
    const fx = (px - p.cx - (p.rowOffX[y] ?? 0)) / (p.cell * s) + (p.bw - 1) / 2
    const x = Math.round(fx)
    if (x < 0 || x >= p.bw || Math.abs(fx - x) > 0.5) return -1
    return mkSq(x, y)
  }
  return -1
}

/** Размер клетки под фигуру/тайл нижнего ряда (базовый). */
export function tileSize(p: Projection): number {
  return p.cell
}
