/**
 * Публичный API движка. Никаких импортов UI/Pixi/Three/DOM —
 * этот модуль работает в main thread, Web Worker ИИ и у обоих игроков сети.
 */
export * from './types'
export {
  seedFromString, rngNextU32, rngInt, rngShuffle, cloneRng,
} from './rng'
export {
  registerPieceType, registerCard, registerTrait, registerRelic, registerEncounter,
  pieceType, cardDef, traitDef, relicDef, encounterDef,
  allPieceTypes, allCards, allTraits, allRelics, allEncounters,
  pieceTypeIdx, cardIdx, traitIdx, promoPool,
} from './registry'
export { findPiece, insertPiece, removePiece, pieceAt, royalOf, isRoyalType, hasTrait } from './board'
export { movesFor, isAttacked } from './movegen'
export { applyMut, unmake, apply, effectiveCost, PAINT_PER_TURN, PROMO_CHOICES } from './reducer'
export {
  validate, legalActions, legalMovesFor, legalTargetsFor, promotionRank,
} from './rules'
export type { Verdict } from './rules'
export { checkResult } from './objectives'
export { computeZobrist } from './zobrist'
export { encodeState, decodeState, hashState } from './serialize'
export { newBattle } from './setup'
export type { SetupArgs } from './setup'
