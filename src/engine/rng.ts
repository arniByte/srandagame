import type { RngState } from './types'

/**
 * xoshiro128** — быстрый детерминированный RNG на u32.
 * Состояние живёт в BattleState/RunState и сериализуется как есть.
 */

const rotl = (x: number, k: number): number => ((x << k) | (x >>> (32 - k))) >>> 0

/** splitmix32 — для посева из строки/числа. */
function splitmix32(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x9e3779b9) >>> 0
    let z = s
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0
    return (z ^ (z >>> 15)) >>> 0
  }
}

export function seedFromString(str: string): RngState {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 0x01000193) >>> 0
  }
  const mix = splitmix32(h)
  const s: RngState = [mix(), mix(), mix(), mix()]
  // Нулевое состояние запрещено.
  if ((s[0] | s[1] | s[2] | s[3]) === 0) s[0] = 1
  return s
}

export function rngNextU32(s: RngState): number {
  const r = Math.imul(rotl(Math.imul(s[1], 5) >>> 0, 7), 9) >>> 0
  const t = (s[1] << 9) >>> 0
  s[2] = (s[2] ^ s[0]) >>> 0
  s[3] = (s[3] ^ s[1]) >>> 0
  s[1] = (s[1] ^ s[2]) >>> 0
  s[0] = (s[0] ^ s[3]) >>> 0
  s[2] = (s[2] ^ t) >>> 0
  s[3] = rotl(s[3], 11)
  return r
}

/** Равномерное целое [0, n). Модуль-байас пренебрежим для игровых n. */
export function rngInt(s: RngState, n: number): number {
  if (n <= 1) return 0
  return rngNextU32(s) % n
}

/** Тасование Фишера—Йетса на месте. */
export function rngShuffle<T>(s: RngState, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rngInt(s, i + 1)
    const tmp = arr[i] as T
    arr[i] = arr[j] as T
    arr[j] = tmp
  }
  return arr
}

export const cloneRng = (s: RngState): RngState => [s[0], s[1], s[2], s[3]]
