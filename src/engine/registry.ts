import type { CardDef, EncounterDef, PieceTypeDef, RelicDef, TraitDef } from './types'

/**
 * Реестры контента. src/content регистрирует определения в ФИКСИРОВАННОМ порядке
 * (порядок = индексы для Zobrist), движок их только читает.
 */

const pieceTypes = new Map<string, PieceTypeDef>()
const pieceTypeIndex = new Map<string, number>()
const cards = new Map<string, CardDef>()
const cardIndex = new Map<string, number>()
const traits = new Map<string, TraitDef>()
const traitIndex = new Map<string, number>()
const relics = new Map<string, RelicDef>()
const encounters = new Map<string, EncounterDef>()

export function registerPieceType(def: PieceTypeDef): void {
  if (!pieceTypes.has(def.id)) pieceTypeIndex.set(def.id, pieceTypes.size)
  pieceTypes.set(def.id, def)
}
export function registerCard(def: CardDef): void {
  if (!cards.has(def.id)) cardIndex.set(def.id, cards.size)
  cards.set(def.id, def)
}
export function registerTrait(def: TraitDef): void {
  if (!traits.has(def.id)) traitIndex.set(def.id, traits.size)
  traits.set(def.id, def)
}
export function registerRelic(def: RelicDef): void {
  relics.set(def.id, def)
}
export function registerEncounter(def: EncounterDef): void {
  encounters.set(def.id, def)
}

export function pieceType(id: string): PieceTypeDef {
  const d = pieceTypes.get(id)
  if (!d) throw new Error(`unknown piece type: ${id}`)
  return d
}
export function cardDef(id: string): CardDef {
  const d = cards.get(id)
  if (!d) throw new Error(`unknown card: ${id}`)
  return d
}
export function traitDef(id: string): TraitDef {
  const d = traits.get(id)
  if (!d) throw new Error(`unknown trait: ${id}`)
  return d
}
export function relicDef(id: string): RelicDef {
  const d = relics.get(id)
  if (!d) throw new Error(`unknown relic: ${id}`)
  return d
}
export function encounterDef(id: string): EncounterDef {
  const d = encounters.get(id)
  if (!d) throw new Error(`unknown encounter: ${id}`)
  return d
}

export const pieceTypeIdx = (id: string): number => pieceTypeIndex.get(id) ?? 0
export const cardIdx = (id: string): number => cardIndex.get(id) ?? 0
export const traitIdx = (id: string): number => traitIndex.get(id) ?? 0

export const allPieceTypes = (): PieceTypeDef[] => [...pieceTypes.values()]
export const allCards = (): CardDef[] => [...cards.values()]
export const allTraits = (): TraitDef[] => [...traits.values()]
export const allRelics = (): RelicDef[] => [...relics.values()]
export const allEncounters = (): EncounterDef[] => [...encounters.values()]

/** Пул промоушен-фигур (в порядке регистрации — детерминизм). */
export const promoPool = (): string[] =>
  allPieceTypes().filter(p => p.promo).map(p => p.id)
