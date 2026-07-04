import {
  registerCard, registerEncounter, registerPieceType, registerRelic, registerTrait,
} from '../engine/registry'
import { PIECE_TYPES } from './pieceTypes'
import { TRAITS } from './traits'
import { CARDS } from './cards'
import { RELICS } from './relics'
import { ENCOUNTERS } from './encounters'

let loaded = false

/**
 * Регистрирует весь контент в реестрах движка.
 * Вызывается один раз на буте (main thread, worker, тесты).
 * Порядок регистрации фиксирован — от него зависят индексы Zobrist.
 */
export function loadContent(): void {
  if (loaded) return
  loaded = true
  for (const d of PIECE_TYPES) registerPieceType(d)
  for (const d of TRAITS) registerTrait(d)
  for (const d of CARDS) registerCard(d)
  for (const d of RELICS) registerRelic(d)
  for (const d of ENCOUNTERS) registerEncounter(d)
}

/** Стартовая армия и колода забега (Мастер по умолчанию). */
export const STARTER_ROSTER: { type: string; name: string }[] = [
  { type: 'king', name: 'Король-Художник' },
  { type: 'rook', name: 'Башня' },
  { type: 'bishop', name: 'Кисть' },
  { type: 'knight', name: 'Наездник' },
  { type: 'knight', name: 'Наездница' },
  { type: 'pawn', name: 'Мазок' },
  { type: 'pawn', name: 'Штрих' },
  { type: 'pawn', name: 'Пятно' },
  { type: 'pawn', name: 'Точка' },
]

export const STARTER_DECK: string[] = [
  'scissors', 'glue', 'freshStroke', 'palette', 'palette',
  'inspiration', 'pirouette', 'shove',
]
