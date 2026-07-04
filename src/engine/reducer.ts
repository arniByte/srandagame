import type {
  Action, BattleState, Ctx, EngineEvent, MetaSnapshot, Piece, PieceTrait,
  PlayerId, Sq, UndoOp, UndoRecord,
} from './types'
import { HOLE, T_PLAIN, mkSq, sqX, sqY, tileAt, tileIdx } from './types'
import { cloneRng, rngInt, rngShuffle } from './rng'
import { findPiece, insertPiece, pieceAt, removePiece, royalOf } from './board'
import { cardDef, pieceType, promoPool, relicDef, traitDef } from './registry'
import { isAttacked } from './movegen'
import { executeEffects } from './cards'
import { checkResult } from './objectives'

/** Краска, начисляемая в начале каждого своего хода. */
export const PAINT_PER_TURN = 2
/** Сколько вариантов предлагает промоушен-драфт. */
export const PROMO_CHOICES = 3

// ---------------------------------------------------------------------------

class Recorder implements Ctx {
  ops: UndoOp[] = []
  private zonesSaved = new Set<PlayerId>()
  private paintSaved = new Set<PlayerId>()

  constructor(
    public state: BattleState,
    public events: EngineEvent[],
  ) {}

  emit(ev: EngineEvent): void {
    this.events.push(ev)
  }

  rngInt(n: number): number {
    return rngInt(this.state.rng, n)
  }

  pieceAt(s: Sq): Piece | null {
    return pieceAt(this.state, s)
  }

  pieceById(id: number): Piece | null {
    return findPiece(this.state, id)
  }

  savePos(p: Piece): void {
    this.ops.push({ u: 'pos', id: p.id, pos: p.pos, moved: p.moved })
  }

  saveZones(side: PlayerId): void {
    if (this.zonesSaved.has(side)) return
    this.zonesSaved.add(side)
    const s = this.state.sides[side]
    this.ops.push({
      u: 'zones', side,
      draw: s.draw.slice(), hand: s.hand.slice(),
      discard: s.discard.slice(), exhausted: s.exhausted.slice(),
    })
  }

  savePaint(side: PlayerId): void {
    if (this.paintSaved.has(side)) return
    this.paintSaved.add(side)
    this.ops.push({ u: 'paint', side, paint: this.state.sides[side].paint })
  }

  gainPaint(side: PlayerId, n: number): void {
    if (n === 0) return
    this.savePaint(side)
    const s = this.state.sides[side]
    const next = Math.max(0, Math.min(s.paintMax, s.paint + n))
    const delta = next - s.paint
    if (delta === 0) return
    s.paint = next
    this.emit({ e: 'paint', side, delta, now: next })
  }

  dealDamage(target: Piece, n: number): void {
    if (target.hp <= 0) return // классические фигуры не получают урон — только взятие/destroy
    this.ops.push({ u: 'hp', id: target.id, hp: target.hp })
    target.hp -= n
    this.emit({ e: 'damaged', piece: target.id, at: target.pos, hp: target.hp, dmg: n })
    if (target.hp <= 0) this.destroyPiece(target)
  }

  destroyPiece(target: Piece): void {
    const removed = removePiece(this.state, target.id)
    if (!removed) return
    this.ops.push({ u: 'remP', piece: removed })
    this.emit({
      e: 'destroyed', piece: removed.id, type: removed.type,
      owner: removed.owner, at: removed.pos,
    })
  }

  spawnPiece(owner: PlayerId, type: string, at: Sq, traits?: string[]): Piece | null {
    if (tileAt(this.state.board, at) === HOLE || pieceAt(this.state, at)) return null
    const def = pieceType(type)
    const piece: Piece = {
      id: this.state.nextId++,
      owner, type, pos: at,
      hp: -1, maxHp: -1,
      traits: (traits ?? []).map(id => ({ id, turnsLeft: -1 })),
      moved: true,
      rosterId: null,
    }
    void def
    insertPiece(this.state, piece)
    this.ops.push({ u: 'addP', id: piece.id })
    this.emit({ e: 'summoned', piece: piece.id, type, owner, at })
    return piece
  }

  addTrait(target: Piece, traitId: string, turns: number): void {
    const def = traitDef(traitId)
    const existing = target.traits.findIndex(t => t.id === traitId)
    if (existing >= 0) {
      if (def.stacking === 'none') return
      if (def.stacking === 'refresh') {
        const tr = target.traits[existing] as PieceTrait
        this.ops.push({ u: 'traitT', id: target.id, index: existing, turns: tr.turnsLeft })
        tr.turnsLeft = turns
        return
      }
    }
    target.traits.push({ id: traitId, turnsLeft: turns })
    this.ops.push({ u: 'trait+', id: target.id, trait: traitId })
    this.emit({ e: 'traitAdded', piece: target.id, trait: traitId })
  }

  pushPiece(target: Piece, _from: Sq, dist: number): void {
    if (hasAnchor(target)) return
    // Направление — «от активного игрока»: вперёд по ходу его пешек.
    const dir = this.state.active === 0 ? -1 : 1
    let x = sqX(target.pos), y = sqY(target.pos)
    const from = target.pos
    for (let step = 0; step < dist; step++) {
      const ny = y + dir
      const next = mkSq(x, ny)
      const terr = tileAt(this.state.board, next)
      if (terr === HOLE) {
        // Проверяем: за краем доски или настоящая дыра?
        if (ny < 0 || ny >= this.state.board.h) break
        // Падение в дыру — фигура гибнет.
        this.savePos(target)
        target.pos = next
        this.emit({ e: 'pushed', piece: target.id, from, to: next })
        this.destroyPiece(target)
        return
      }
      if (pieceAt(this.state, next)) break
      y = ny
    }
    const to = mkSq(x, y)
    if (to !== from) {
      this.savePos(target)
      target.pos = to
      this.emit({ e: 'pushed', piece: target.id, from, to })
    }
  }

  cutTile(at: Sq): void {
    const b = this.state.board
    const idx = tileIdx(b, at)
    const old = b.tiles[idx] ?? HOLE
    if (old === HOLE) return
    this.ops.push({ u: 'tile', idx, terrain: old })
    b.tiles[idx] = HOLE
    this.emit({ e: 'tileCut', at })
  }

  glueTile(at: Sq): void {
    const b = this.state.board
    const idx = tileIdx(b, at)
    const old = b.tiles[idx] ?? HOLE
    if (old !== HOLE) return
    this.ops.push({ u: 'tile', idx, terrain: old })
    b.tiles[idx] = T_PLAIN
    this.emit({ e: 'tileGlued', at })
  }

  drawCards(side: PlayerId, n: number): void {
    const s = this.state.sides[side]
    for (let i = 0; i < n; i++) {
      if (s.hand.length >= s.handLimit) return
      if (s.draw.length === 0) {
        if (s.discard.length === 0) return
        this.saveZones(side)
        s.draw = rngShuffle(this.state.rng, s.discard.slice())
        s.discard.length = 0
        this.emit({ e: 'reshuffled', side })
      }
      this.saveZones(side)
      const iid = s.draw.pop() as number
      s.hand.push(iid)
      this.emit({ e: 'cardDrawn', side, iid })
    }
  }

  swapPieces(a: Piece, b: Piece): void {
    if (hasAnchor(a) || hasAnchor(b)) return
    this.savePos(a)
    this.savePos(b)
    const tmp = a.pos
    a.pos = b.pos
    b.pos = tmp
    this.emit({ e: 'swapped', a: a.id, b: b.id })
  }
}

function hasAnchor(p: Piece): boolean {
  for (const t of p.traits) if (traitDef(t.id).anchored) return true
  return false
}

// ---------------------------------------------------------------------------
// Применение действия (mutate + undo)

const NULL_EVENTS: EngineEvent[] = []

function snapshotMeta(state: BattleState): MetaSnapshot {
  return {
    rng: cloneRng(state.rng),
    turn: state.turn,
    ply: state.ply,
    active: state.active,
    phase: state.phase,
    promoting: state.promoting ? { piece: state.promoting.piece, options: state.promoting.options.slice() } : null,
    movedThisTurn: state.movedThisTurn,
    curator: state.curator ? { ...state.curator } : null,
    result: state.result,
    nextId: state.nextId,
  }
}

/**
 * Применяет действие МУТИРУЯ state; возвращает undo-запись.
 * Валидность действия НЕ проверяется — вызывающий обязан пройти validate().
 */
export function applyMut(
  state: BattleState,
  action: Action,
  events: EngineEvent[] | null = null,
): UndoRecord {
  const evs = events ?? NULL_EVENTS
  if (events === null) NULL_EVENTS.length = 0
  const rec = new Recorder(state, evs)
  const meta = snapshotMeta(state)

  switch (action.t) {
    case 'move': {
      const piece = findPiece(state, action.piece) as Piece
      const from = piece.pos
      const target = pieceAt(state, action.to)

      if (target && target.hp > 0) {
        // «Бамп»-атака структуры с HP: урон = ценность атакующего, атакующий
        // занимает клетку только если структура разрушена.
        const dmg = Math.max(1, pieceType(piece.type).value)
        rec.emit({ e: 'bumped', attacker: piece.id, target: target.id, at: action.to, dmg })
        rec.dealDamage(target, dmg)
        const destroyed = !findPiece(state, target.id)
        rec.savePos(piece)
        piece.moved = true
        if (destroyed) {
          piece.pos = action.to
          rec.emit({ e: 'moved', piece: piece.id, type: piece.type, owner: piece.owner, from, to: action.to })
        }
      } else {
        if (target) {
          // Классическое взятие.
          rec.emit({
            e: 'captured', victim: target.id, type: target.type,
            owner: target.owner, at: action.to, by: piece.id,
          })
          rec.destroyPiece(target)
          const gain = pieceType(target.type).paintValue
          rec.gainPaint(piece.owner, gain)
          // Черты атакующего: onCapture.
          for (const t of piece.traits) {
            traitDef(t.id).hooks?.onCapture?.(rec, piece, pieceType(target.type).value)
          }
          // Реликвии игрока: onCapture.
          if (piece.owner === 0) {
            for (const rid of state.relics) {
              relicDef(rid).hooks?.onCapture?.(rec, piece.owner, pieceType(target.type).value)
            }
          }
        }
        rec.savePos(piece)
        piece.pos = action.to
        piece.moved = true
        rec.emit({ e: 'moved', piece: piece.id, type: piece.type, owner: piece.owner, from, to: action.to })
      }

      state.movedThisTurn = true

      // Промоушен пешки: драфт из PROMO_CHOICES случайных фигур.
      const stillAlive = findPiece(state, piece.id)
      if (stillAlive) {
        const def = pieceType(piece.type)
        const lastRank = piece.owner === 0 ? 0 : state.board.h - 1
        if (def.pawn && sqY(piece.pos) === lastRank) {
          const pool = promoPool()
          const options: string[] = []
          const bag = pool.slice()
          for (let i = 0; i < PROMO_CHOICES && bag.length > 0; i++) {
            const k = rngInt(state.rng, bag.length)
            options.push(bag.splice(k, 1)[0] as string)
          }
          if (options.length > 0) {
            state.phase = 'promote'
            state.promoting = { piece: piece.id, options }
            rec.emit({ e: 'promoteOffered', piece: piece.id, options })
          }
        }
      }

      // Событие «шах» (предупреждение UX; взятие короля легально).
      emitCheckWarning(state, rec)
      break
    }

    case 'playCard': {
      const side = state.active
      const s = state.sides[side]
      const card = state.cards.find(c => c.iid === action.iid) as { iid: number; def: string; upgraded: boolean }
      const def = cardDef(card.def)
      rec.saveZones(side)
      rec.savePaint(side)
      s.paint -= effectiveCost(state, side, card.upgraded, def.id)
      const hi = s.hand.indexOf(action.iid)
      s.hand.splice(hi, 1)
      s.discard.push(action.iid)
      rec.emit({ e: 'cardPlayed', side, iid: action.iid, def: def.id, targets: action.targets })
      executeEffects(rec, def, action.targets)
      emitCheckWarning(state, rec)
      break
    }

    case 'promote': {
      const old = removePiece(state, action.piece) as Piece
      rec.ops.push({ u: 'remP', piece: old })
      const evolved: Piece = { ...old, type: action.into, traits: old.traits.map(t => ({ ...t })) }
      insertPiece(state, evolved)
      rec.ops.push({ u: 'addP', id: evolved.id })
      state.phase = 'main'
      state.promoting = null
      rec.emit({ e: 'promoted', piece: evolved.id, into: action.into })
      emitCheckWarning(state, rec)
      break
    }

    case 'endTurn': {
      state.ply++
      state.active = (1 - state.active) as PlayerId
      state.movedThisTurn = false
      if (state.active === 0) {
        state.turn++
        runCurator(state, rec)
      }
      startTurn(state, rec)
      break
    }

    case 'concede': {
      state.result = { winner: (1 - state.active) as PlayerId, reason: 'concede' }
      break
    }
  }

  // Проверка исхода боя.
  if (!state.result) {
    const res = checkResult(state)
    if (res) state.result = res
  }
  if (state.result && state.phase !== 'ended') {
    state.phase = 'ended'
    rec.emit({ e: 'battleEnded', winner: state.result.winner, reason: state.result.reason })
  }

  return { meta, ops: rec.ops }
}

function effectiveCost(state: BattleState, side: PlayerId, upgraded: boolean, defId: string): number {
  const def = cardDef(defId)
  let cost = def.cost + (upgraded ? (def.upgradeCostDelta ?? 0) : 0)
  if (side === 0) {
    for (const rid of state.relics) {
      const hook = relicDef(rid).hooks?.modifyCardCost
      if (hook) cost = hook(state, def, cost)
    }
  }
  return Math.max(0, cost)
}

export { effectiveCost }

/** Начало хода стороны state.active: тик черт, краска, добор. */
function startTurn(state: BattleState, rec: Recorder): void {
  const side = state.active
  rec.emit({ e: 'turnStarted', side, turn: state.turn })

  // Тик черт фигур активной стороны (в каноническом порядке id).
  for (const p of state.pieces.slice()) {
    if (p.owner !== side) continue
    for (let i = p.traits.length - 1; i >= 0; i--) {
      const tr = p.traits[i] as PieceTrait
      if (tr.turnsLeft > 0) {
        rec.ops.push({ u: 'traitT', id: p.id, index: i, turns: tr.turnsLeft })
        tr.turnsLeft--
        if (tr.turnsLeft === 0) {
          rec.ops.push({ u: 'trait-', id: p.id, index: i, trait: { ...tr, turnsLeft: 1 } })
          p.traits.splice(i, 1)
          rec.emit({ e: 'traitExpired', piece: p.id, trait: tr.id })
        }
      }
    }
    // Хуки onTurnStart (фигура могла погибнуть от предыдущего хука — проверяем).
    if (findPiece(state, p.id)) {
      for (const t of p.traits) {
        traitDef(t.id).hooks?.onTurnStart?.(rec, p)
      }
    }
  }

  rec.gainPaint(side, PAINT_PER_TURN)
  if (side === 0) {
    for (const rid of state.relics) {
      relicDef(rid).hooks?.onTurnStart?.(rec, side)
    }
  }
  rec.drawCards(side, 1)

  // Телеграф Куратора за ход до сдвига.
  if (state.curator && side === 0 && state.curator.nextAt - state.turn === 1) {
    rec.emit({ e: 'curatorWarn', row: state.curator.row, dir: state.curator.dir, inTurns: 1 })
  }
}

/** Куратор: циклический сдвиг ряда коллажа вместе с фигурами. */
function runCurator(state: BattleState, rec: Recorder): void {
  const cur = state.curator
  if (!cur || state.turn < cur.nextAt) return
  const { row, dir } = cur
  const b = state.board
  const w = b.w

  // Тайлы: new[x] = old[(x - dir + w) % w]
  const oldRow: number[] = []
  for (let x = 0; x < w; x++) oldRow.push(b.tiles[row * w + x] ?? HOLE)
  for (let x = 0; x < w; x++) {
    const idx = row * w + x
    const nv = oldRow[(x - dir + w) % w] as number
    if ((b.tiles[idx] ?? HOLE) !== nv) {
      rec.ops.push({ u: 'tile', idx, terrain: b.tiles[idx] ?? HOLE })
      b.tiles[idx] = nv
    }
  }
  // Фигуры ряда едут вместе с тайлами.
  for (const p of state.pieces) {
    if (sqY(p.pos) !== row) continue
    rec.savePos(p)
    p.pos = mkSq((sqX(p.pos) + dir + w) % w, row)
  }
  rec.emit({ e: 'curatorShift', row, dir })

  // Планируем следующий сдвиг.
  cur.nextAt = state.turn + cur.period
  cur.row = rngInt(state.rng, b.h)
  cur.dir = rngInt(state.rng, 2) === 0 ? 1 : -1
}

function emitCheckWarning(state: BattleState, rec: Recorder): void {
  if (rec.events === NULL_EVENTS) return
  for (const side of [0, 1] as const) {
    const royal = royalOf(state, side)
    if (royal && isAttacked(state, royal.pos, (1 - side) as PlayerId)) {
      rec.emit({ e: 'check', side, royal: royal.id })
    }
  }
}

// ---------------------------------------------------------------------------
// Откат

export function unmake(state: BattleState, undo: UndoRecord): void {
  // Структурные операции — в обратном порядке.
  for (let i = undo.ops.length - 1; i >= 0; i--) {
    const op = undo.ops[i] as UndoOp
    switch (op.u) {
      case 'pos': {
        const p = findPiece(state, op.id) as Piece
        p.pos = op.pos
        p.moved = op.moved
        break
      }
      case 'hp': {
        const p = findPiece(state, op.id) as Piece
        p.hp = op.hp
        break
      }
      case 'addP': {
        removePiece(state, op.id)
        break
      }
      case 'remP': {
        insertPiece(state, op.piece)
        break
      }
      case 'trait+': {
        const p = findPiece(state, op.id) as Piece
        const idx = p.traits.findIndex(t => t.id === op.trait)
        if (idx >= 0) p.traits.splice(idx, 1)
        break
      }
      case 'trait-': {
        const p = findPiece(state, op.id) as Piece
        p.traits.splice(op.index, 0, op.trait)
        break
      }
      case 'traitT': {
        const p = findPiece(state, op.id) as Piece
        const tr = p.traits[op.index]
        if (tr) tr.turnsLeft = op.turns
        break
      }
      case 'tile': {
        state.board.tiles[op.idx] = op.terrain
        break
      }
      case 'paint': {
        state.sides[op.side].paint = op.paint
        break
      }
      case 'zones': {
        const s = state.sides[op.side]
        s.draw = op.draw
        s.hand = op.hand
        s.discard = op.discard
        s.exhausted = op.exhausted
        break
      }
    }
  }
  // Скаляры.
  const m = undo.meta
  state.rng = cloneRng(m.rng)
  state.turn = m.turn
  state.ply = m.ply
  state.active = m.active
  state.phase = m.phase
  state.promoting = m.promoting ? { piece: m.promoting.piece, options: m.promoting.options.slice() } : null
  state.movedThisTurn = m.movedThisTurn
  state.curator = m.curator ? { ...m.curator } : null
  state.result = m.result
  state.nextId = m.nextId
}

/** Чистое применение: клонирует state, мутирует клон. Для UI/сети. */
export function apply(
  state: BattleState,
  action: Action,
): { state: BattleState; events: EngineEvent[] } {
  const next = structuredClone(state)
  const events: EngineEvent[] = []
  applyMut(next, action, events)
  return { state: next, events }
}
