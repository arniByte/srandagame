import type { BattleState } from './types'

/**
 * Каноническая сериализация: JSON со стабильным порядком ключей.
 * Используется для снапшотов сети, сейвов и хеша десинка.
 */

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']'
  }
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  const parts: string[] = []
  for (const k of keys) {
    if (obj[k] === undefined) continue
    parts.push(JSON.stringify(k) + ':' + stableStringify(obj[k]))
  }
  return '{' + parts.join(',') + '}'
}

export function encodeState(state: BattleState): string {
  return stableStringify(state)
}

export function decodeState(raw: string): BattleState {
  return JSON.parse(raw) as BattleState
}

/** FNV-1a 32-бит ×2 (64 бита суммарно) — быстрый хеш для детекта десинка. */
export function hashState(state: BattleState): string {
  const s = encodeState(state)
  let h1 = 0x811c9dc5
  let h2 = 0xcbf29ce4
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ ((c >> 8) ^ c), 0x01000197) >>> 0
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')
}
