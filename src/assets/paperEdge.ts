/**
 * Генератор «рваного бумажного края»: сидированный волнистый оффсет
 * контура. Возвращает плоские массивы точек [x0,y0,x1,y1,...] для
 * Graphics.poly / canvas2d. Всё детерминировано по seed (чисто визуально).
 */

function edgeRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Сглаживание соседей: волокна бумаги рвутся плавно, без «пилы». */
function smooth(offsets: number[]): number[] {
  const n = offsets.length
  const out = new Array<number>(n)
  for (let i = 0; i < n; i++) {
    const a = offsets[(i + n - 1) % n] ?? 0
    const b = offsets[i] ?? 0
    const c = offsets[(i + 1) % n] ?? 0
    out[i] = (a + b * 2 + c) / 4
  }
  return out
}

export interface EdgeOpts {
  /** Амплитуда рваности, px. */
  amp?: number
  /** Шаг между точками контура, px. */
  step?: number
}

/**
 * Рваный прямоугольник с центром в (0,0), размер w×h.
 */
export function tornRect(w: number, h: number, seed: number, opts: EdgeOpts = {}): number[] {
  const amp = opts.amp ?? Math.max(1.5, Math.min(w, h) * 0.045)
  const step = opts.step ?? Math.max(4, Math.min(w, h) / 7)
  const rng = edgeRng(seed)

  // Точки по периметру по часовой.
  const pts: { x: number; y: number; nx: number; ny: number }[] = []
  const hw = w / 2, hh = h / 2
  const addEdge = (x0: number, y0: number, x1: number, y1: number, nx: number, ny: number): void => {
    const len = Math.hypot(x1 - x0, y1 - y0)
    const n = Math.max(1, Math.round(len / step))
    for (let i = 0; i < n; i++) {
      const t = i / n
      pts.push({ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, nx, ny })
    }
  }
  addEdge(-hw, -hh, hw, -hh, 0, -1)
  addEdge(hw, -hh, hw, hh, 1, 0)
  addEdge(hw, hh, -hw, hh, 0, 1)
  addEdge(-hw, hh, -hw, -hh, -1, 0)

  let offs = pts.map(() => (rng() * 2 - 1) * amp)
  offs = smooth(offs)

  const out: number[] = []
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i] as { x: number; y: number; nx: number; ny: number }
    const o = offs[i] ?? 0
    out.push(p.x + p.nx * o, p.y + p.ny * o)
  }
  return out
}

/** Рваный круг радиуса r с центром в (0,0). */
export function tornCircle(r: number, seed: number, opts: EdgeOpts = {}): number[] {
  const amp = opts.amp ?? Math.max(1.2, r * 0.09)
  const step = opts.step ?? Math.max(4, r / 3)
  const rng = edgeRng(seed)
  const n = Math.max(8, Math.round((2 * Math.PI * r) / step))

  let offs: number[] = []
  for (let i = 0; i < n; i++) offs.push((rng() * 2 - 1) * amp)
  offs = smooth(offs)

  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    const rr = r + (offs[i] ?? 0)
    out.push(Math.cos(a) * rr, Math.sin(a) * rr)
  }
  return out
}

/**
 * Рваная версия произвольного полигона: рёбра дробятся с шагом step,
 * точки смещаются вдоль нормали ребра.
 */
export function tornPoly(points: number[], seed: number, opts: EdgeOpts = {}): number[] {
  const amp = opts.amp ?? 2
  const step = opts.step ?? 7
  const rng = edgeRng(seed)
  const n = points.length / 2

  const raw: { x: number; y: number; nx: number; ny: number }[] = []
  for (let i = 0; i < n; i++) {
    const x0 = points[i * 2] ?? 0
    const y0 = points[i * 2 + 1] ?? 0
    const x1 = points[((i + 1) % n) * 2] ?? 0
    const y1 = points[((i + 1) % n) * 2 + 1] ?? 0
    const len = Math.hypot(x1 - x0, y1 - y0)
    // Нормаль ребра (наружу при обходе по часовой).
    const nx = len > 0 ? (y1 - y0) / len : 0
    const ny = len > 0 ? -(x1 - x0) / len : 0
    const m = Math.max(1, Math.round(len / step))
    for (let j = 0; j < m; j++) {
      const t = j / m
      raw.push({ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, nx, ny })
    }
  }

  let offs = raw.map(() => (rng() * 2 - 1) * amp)
  offs = smooth(offs)

  const out: number[] = []
  for (let i = 0; i < raw.length; i++) {
    const p = raw[i] as { x: number; y: number; nx: number; ny: number }
    const o = offs[i] ?? 0
    out.push(p.x + p.nx * o, p.y + p.ny * o)
  }
  return out
}

/** Хэш строки → seed (одинаковый край у одинаковых ключей). */
export function edgeSeed(key: string): number {
  let h = 2166136261
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
