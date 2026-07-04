import type { Action } from '../engine/types'
import { allCards, allEncounters, allPieceTypes, allRelics, allTraits } from '../engine/registry'

/**
 * Протокол кооп-lockstep: хост авторитарен, гость предлагает действия.
 * Любое применённое действие рассылается с seq и хешем пост-состояния —
 * десинк ловится за один ход и лечится снапшотом.
 */

export const PROTOCOL_V = 1

/** Хеш сборки: контент должен совпадать, иначе lockstep невозможен. */
export function buildHash(): string {
  const sig = [
    PROTOCOL_V,
    allPieceTypes().map(p => p.id).join(','),
    allTraits().map(t => t.id).join(','),
    allCards().map(c => c.id).join(','),
    allRelics().map(r => r.id).join(','),
    allEncounters().map(e => e.id).join(','),
  ].join('|')
  let h = 0x811c9dc5
  for (let i = 0; i < sig.length; i++) {
    h = Math.imul(h ^ sig.charCodeAt(i), 0x01000193) >>> 0
  }
  return h.toString(16)
}

export type NetMsg =
  | { v: 1; t: 'hello'; name: string; build: string }
  | { v: 1; t: 'welcome'; seq: number; runGz: string; battleGz: string | null; screen: string }
  | { v: 1; t: 'deny'; reason: 'full' | 'buildMismatch' | 'badVersion' }
  | { v: 1; t: 'propose'; pseq: number; action: Action }
  | { v: 1; t: 'reject'; pseq: number; reason: string }
  | { v: 1; t: 'apply'; seq: number; action: Action; hash: string }
  | { v: 1; t: 'battleStart'; seq: number; battleGz: string }
  | { v: 1; t: 'metaSync'; seq: number; runGz: string; screen: string }
  | { v: 1; t: 'resyncReq'; haveSeq: number }
  | { v: 1; t: 'snapshot'; seq: number; runGz: string; battleGz: string | null; screen: string }
  | { v: 1; t: 'bye' }

/** Код комнаты: 6 символов без неоднозначных букв. */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'

export function makeRoomCode(): string {
  let code = ''
  const rnd = new Uint32Array(6)
  crypto.getRandomValues(rnd)
  for (let i = 0; i < 6; i++) {
    code += ALPHABET[(rnd[i] as number) % ALPHABET.length]
  }
  return code
}

export function normalizeRoomCode(raw: string): string | null {
  const code = raw.trim().toUpperCase().replace(/[^2-9A-Z]/g, '')
  return code.length === 6 ? code : null
}
