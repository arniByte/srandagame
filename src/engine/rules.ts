import type { Action, BattleState, CardInstance, PlayerId, Sq, TargetSpec } from './types'
import { HOLE, mkSq, tileAt } from './types'
import { findPiece, pieceAt } from './board'
import { cardDef, pieceType, traitDef } from './registry'
import { movesFor } from './movegen'
import { effectiveCost } from './reducer'

export interface Verdict { ok: boolean; reason?: string }

const OK: Verdict = { ok: true }
const bad = (reason: string): Verdict => ({ ok: false, reason })

/**
 * Единственные ворота легальности: локальный ввод, хост (для гостя) и ИИ
 * проверяют действия одинаково.
 */
export function validate(state: BattleState, action: Action, by?: PlayerId): Verdict {
  if (state.phase === 'ended') return bad('ended')
  const actor = by ?? state.active
  if (actor !== state.active) return bad('notYourTurn')

  switch (action.t) {
    case 'concede':
      return OK

    case 'promote': {
      if (state.phase !== 'promote' || !state.promoting) return bad('phase')
      if (state.promoting.piece !== action.piece) return bad('wrongPiece')
      if (!state.promoting.options.includes(action.into)) return bad('notOffered')
      return OK
    }

    case 'move': {
      if (state.phase !== 'main') return bad('phase')
      if (state.movedThisTurn) return bad('alreadyMoved')
      const piece = findPiece(state, action.piece)
      if (!piece) return bad('noPiece')
      if (piece.owner !== state.active) return bad('notYours')
      if (!movesFor(state, piece).includes(action.to)) return bad('illegalMove')
      return OK
    }

    case 'endTurn': {
      if (state.phase !== 'main') return bad('phase')
      return OK
    }

    case 'playCard': {
      if (state.phase !== 'main') return bad('phase')
      const side = state.sides[state.active]
      if (!side.hand.includes(action.iid)) return bad('notInHand')
      const card = state.cards.find(c => c.iid === action.iid) as CardInstance
      const def = cardDef(card.def)
      if (side.paint < effectiveCost(state, state.active, card.upgraded, def.id)) return bad('noPaint')
      return validateTargets(state, def.target, action.targets, hostileCard(def))
    }
  }
}

/** Карта с враждебными эффектами не может целить «заякоренные» фигуры врага. */
function hostileCard(def: ReturnType<typeof cardDef>): boolean {
  return def.effects.some(fx =>
    fx.op === 'destroy' || fx.op === 'push' || fx.op === 'swap' ||
    (fx.op === 'addTrait' && (traitDef(fx.trait).blocksMovement ?? false)))
}

function validateTargets(
  state: BattleState,
  spec: TargetSpec,
  targets: Sq[],
  hostile: boolean,
): Verdict {
  switch (spec.kind) {
    case 'none':
      return targets.length === 0 ? OK : bad('targets')

    case 'tile': {
      if (targets.length !== 1) return bad('targets')
      return validTile(state, targets[0] as Sq, spec) ? OK : bad('badTile')
    }

    case 'piece': {
      if (targets.length !== 1) return bad('targets')
      return validPieceTarget(state, targets[0] as Sq, spec, hostile) ? OK : bad('badTarget')
    }

    case 'twoPieces': {
      if (targets.length !== 2 || targets[0] === targets[1]) return bad('targets')
      const okA = validPieceTarget(state, targets[0] as Sq, spec, hostile)
      const okB = validPieceTarget(state, targets[1] as Sq, spec, hostile)
      return okA && okB ? OK : bad('badTarget')
    }
  }
}

function validTile(state: BattleState, sq: Sq, spec: TargetSpec): boolean {
  const b = state.board
  const x = sq & 15, y = sq >> 4
  if (x < 0 || y < 0 || x >= b.w || y >= b.h) return false
  const terr = tileAt(b, sq)
  switch (spec.tile ?? 'any') {
    case 'empty':
      if (terr === HOLE || pieceAt(state, sq)) return false
      break
    case 'hole':
      if (terr !== HOLE) return false
      break
    case 'any':
      if (terr === HOLE) return false
      break
  }
  if (spec.ownHalf) {
    const half = b.h >> 1
    if (state.active === 0 ? y < b.h - half : y >= half) return false
  }
  return true
}

function validPieceTarget(state: BattleState, sq: Sq, spec: TargetSpec, hostile: boolean): boolean {
  const p = pieceAt(state, sq)
  if (!p) return false
  const rel = p.owner === state.active ? 'ally' : 'enemy'
  if ((spec.side ?? 'any') !== 'any' && spec.side !== rel) return false
  if (spec.maxValue !== undefined && pieceType(p.type).value > spec.maxValue) return false
  if (hostile && rel === 'enemy') {
    for (const t of p.traits) if (traitDef(t.id).anchored) return false
  }
  // Ворота/структуры не целятся картами-перемещениями.
  if (p.hp > 0 && hostile) return false
  return true
}

// ---------------------------------------------------------------------------
// Полные генераторы (для ИИ-фаззинга, тестов и подсветки UI)

export function legalMovesFor(state: BattleState, pieceId: number): Sq[] {
  if (state.phase !== 'main' || state.movedThisTurn) return []
  const piece = findPiece(state, pieceId)
  if (!piece || piece.owner !== state.active) return []
  return movesFor(state, piece)
}

/** Все допустимые цели карты (для подсветки при перетаскивании). */
export function legalTargetsFor(state: BattleState, iid: number): Sq[] {
  const card = state.cards.find(c => c.iid === iid)
  if (!card) return []
  const def = cardDef(card.def)
  const hostile = hostileCard(def)
  const spec = def.target
  const out: Sq[] = []
  if (spec.kind === 'none') return out
  const b = state.board
  for (let y = 0; y < b.h; y++) {
    for (let x = 0; x < b.w; x++) {
      const sq = mkSq(x, y)
      if (spec.kind === 'tile' && validTile(state, sq, spec)) out.push(sq)
      else if ((spec.kind === 'piece' || spec.kind === 'twoPieces') &&
               validPieceTarget(state, sq, spec, hostile)) out.push(sq)
    }
  }
  return out
}

/** Исчерпывающий список действий (мат-детект не нужен — используется тестами и ИИ). */
export function legalActions(state: BattleState): Action[] {
  const out: Action[] = []
  if (state.phase === 'ended') return out

  if (state.phase === 'promote' && state.promoting) {
    for (const into of state.promoting.options) {
      out.push({ t: 'promote', piece: state.promoting.piece, into })
    }
    return out
  }

  if (!state.movedThisTurn) {
    for (const p of state.pieces) {
      if (p.owner !== state.active) continue
      for (const to of movesFor(state, p)) {
        out.push({ t: 'move', piece: p.id, to })
      }
    }
  }

  const side = state.sides[state.active]
  for (const iid of side.hand) {
    const card = state.cards.find(c => c.iid === iid) as CardInstance
    const def = cardDef(card.def)
    if (side.paint < effectiveCost(state, state.active, card.upgraded, def.id)) continue
    if (def.target.kind === 'none') {
      out.push({ t: 'playCard', iid, targets: [] })
    } else if (def.target.kind === 'twoPieces') {
      const ts = legalTargetsFor(state, iid)
      for (let i = 0; i < ts.length; i++) {
        for (let j = 0; j < ts.length; j++) {
          if (i !== j) out.push({ t: 'playCard', iid, targets: [ts[i] as Sq, ts[j] as Sq] })
        }
      }
    } else {
      for (const sq of legalTargetsFor(state, iid)) {
        out.push({ t: 'playCard', iid, targets: [sq] })
      }
    }
  }

  out.push({ t: 'endTurn' })
  return out
}

/** Последняя линия для промоушена пешек владельца. */
export function promotionRank(state: BattleState, owner: PlayerId): number {
  return owner === 0 ? 0 : state.board.h - 1
}
