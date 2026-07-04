/** Кривые сглаживания твинера. t ∈ [0,1] → k ∈ [0,1] (может выходить за края: back/elastic). */
export type Ease = (t: number) => number

export const linear: Ease = t => t

export const quadIn: Ease = t => t * t
export const quadOut: Ease = t => t * (2 - t)
export const quadInOut: Ease = t => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t)

export const cubicIn: Ease = t => t * t * t
export const cubicOut: Ease = t => 1 + --t * t * t
export const cubicInOut: Ease = t =>
  t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1

export const sineInOut: Ease = t => 0.5 - 0.5 * Math.cos(Math.PI * t)

/** Замах назад перед стартом. */
export const backIn: Ease = t => {
  const s = 1.70158
  return t * t * ((s + 1) * t - s)
}

/** Перелёт с возвратом — «settle» стоп-моушена. */
export const backOut: Ease = t => {
  const s = 1.70158
  const u = t - 1
  return u * u * ((s + 1) * u + s) + 1
}

export const elasticOut: Ease = t => {
  if (t === 0 || t === 1) return t
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1
}

export const bounceOut: Ease = t => {
  const n1 = 7.5625
  const d1 = 2.75
  if (t < 1 / d1) return n1 * t * t
  if (t < 2 / d1) { t -= 1.5 / d1; return n1 * t * t + 0.75 }
  if (t < 2.5 / d1) { t -= 2.25 / d1; return n1 * t * t + 0.9375 }
  t -= 2.625 / d1
  return n1 * t * t + 0.984375
}
