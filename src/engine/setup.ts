import type {
  BattleState, BoardState, DeckInput, EncounterDef, Objective, Piece,
  RngState, RosterInput, Sq,
} from './types'
import { HOLE, T_GATE, T_PLAIN, mkSq } from './types'
import { rngInt, rngShuffle, seedFromString } from './rng'
import { pieceType, relicDef } from './registry'
import { insertPiece } from './board'

/** Буквы ASCII-доски → типы вражеских фигур. */
const ENEMY_CHARS: Record<string, string> = {
  p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king',
  d: 'dancer', v: 'dove', s: 'square',
}

export interface SetupArgs {
  encounter: EncounterDef
  roster: RosterInput[]
  deck: DeckInput[]
  relics: string[]
  seed: string | RngState
  startingPaint?: number
}

/**
 * Сборка начального BattleState из энкаунтера и армии игрока.
 * Детерминирована: одинаковые аргументы → идентичное состояние.
 */
export function newBattle(args: SetupArgs): BattleState {
  const { encounter, roster, deck, relics } = args
  const rng: RngState = typeof args.seed === 'string' ? seedFromString(args.seed) : [...args.seed]

  // --- Парсинг ASCII-доски.
  const rows = encounter.board
  const h = rows.length
  const w = Math.max(...rows.map(r => r.length))
  if (w > 12 || h > 12) throw new Error(`board too big: ${w}x${h}`)
  const board: BoardState = { w, h, tiles: new Array(w * h).fill(T_PLAIN) }

  const spawnSquares: Sq[] = []
  const enemies: { type: string; at: Sq }[] = []
  let gateSq: Sq = -1

  for (let y = 0; y < h; y++) {
    const row = rows[y] as string
    for (let x = 0; x < w; x++) {
      const ch = (row[x] ?? '#')
      const idx = y * w + x
      if (ch === '#') board.tiles[idx] = HOLE
      else if (ch === '*') spawnSquares.push(mkSq(x, y))
      else if (ch === 'G') { board.tiles[idx] = T_GATE; gateSq = mkSq(x, y) }
      else if (ch !== '.') {
        const type = ENEMY_CHARS[ch.toLowerCase()]
        if (type) enemies.push({ type, at: mkSq(x, y) })
      }
    }
  }

  const state: BattleState = {
    v: 1,
    rng,
    turn: 1,
    ply: 0,
    active: 0,
    phase: 'main',
    promoting: null,
    movedThisTurn: false,
    board,
    pieces: [],
    cards: [],
    sides: [
      {
        paint: args.startingPaint ?? 3, paintMax: 10,
        draw: [], hand: [], discard: [], exhausted: [], handLimit: 5,
      },
      {
        paint: encounter.enemyPaint ?? 3, paintMax: 10,
        draw: [], hand: [], discard: [], exhausted: [], handLimit: 5,
      },
    ],
    objective: { kind: 'regicide' },
    hadRoyal: [false, false],
    relics: relics.slice(),
    curator: null,
    nextId: 1,
    result: null,
  }

  // --- Вражеские фигуры.
  for (const e of enemies) {
    const def = pieceType(e.type)
    const piece: Piece = {
      id: state.nextId++,
      owner: 1, type: e.type, pos: e.at,
      hp: def.hp ?? -1, maxHp: def.hp ?? -1,
      traits: [], moved: false, rosterId: null,
    }
    insertPiece(state, piece)
  }

  // --- Ворота (осада).
  let gatePieceId = -1
  if (gateSq !== -1) {
    const def = pieceType('gate')
    const gate: Piece = {
      id: state.nextId++,
      owner: 1, type: 'gate', pos: gateSq,
      hp: def.hp ?? 10, maxHp: def.hp ?? 10,
      traits: [], moved: false, rosterId: null,
    }
    insertPiece(state, gate)
    gatePieceId = gate.id
  }

  // --- Армия игрока на клетках расстановки (порядок ростера).
  for (let i = 0; i < roster.length && i < spawnSquares.length; i++) {
    const r = roster[i] as RosterInput
    const piece: Piece = {
      id: state.nextId++,
      owner: 0, type: r.type, pos: spawnSquares[i] as Sq,
      hp: -1, maxHp: -1,
      traits: r.traits.map(id => ({ id, turnsLeft: -1 })),
      moved: false, rosterId: r.rid,
    }
    insertPiece(state, piece)
  }

  // Фиксируем наличие королевских фигур (их гибель = поражение стороны).
  for (const p of state.pieces) {
    if (pieceType(p.type).royal) state.hadRoyal[p.owner] = true
  }

  // --- Цель боя.
  let objective: Objective
  switch (encounter.objective.kind) {
    case 'regicide':
      objective = { kind: 'regicide' }
      break
    case 'siege':
      if (gatePieceId === -1) throw new Error(`siege encounter ${encounter.id} has no gate (G)`)
      objective = { kind: 'siege', gatePieceId }
      break
    case 'survive':
      objective = { kind: 'survive', turnsRequired: encounter.objective.turns }
      break
    case 'escort': {
      // Эскорт — самая дешёвая не-королевская фигура игрока.
      let escort: Piece | null = null
      for (const p of state.pieces) {
        if (p.owner !== 0 || pieceType(p.type).royal) continue
        if (!escort || pieceType(p.type).value < pieceType(escort.type).value) escort = p
      }
      if (!escort) throw new Error(`escort encounter ${encounter.id}: no escortable piece`)
      const goalRow = encounter.objective.goalRow
      const goals: Sq[] = []
      for (let x = 0; x < w; x++) {
        if ((board.tiles[goalRow * w + x] ?? HOLE) !== HOLE) goals.push(mkSq(x, goalRow))
      }
      objective = { kind: 'escort', escortPieceId: escort.id, goals }
      break
    }
  }
  state.objective = objective

  // --- Колоды: игрок.
  const mkDeck = (side: 0 | 1, cards: DeckInput[]): void => {
    const iids: number[] = []
    for (const c of cards) {
      const iid = state.nextId++
      state.cards.push({ iid, def: c.def, upgraded: c.upgraded })
      iids.push(iid)
    }
    rngShuffle(state.rng, iids)
    state.sides[side].draw = iids
    // Стартовая рука 3.
    for (let i = 0; i < 3 && state.sides[side].draw.length > 0; i++) {
      state.sides[side].hand.push(state.sides[side].draw.pop() as number)
    }
  }
  mkDeck(0, deck)
  if (encounter.enemyDeck && encounter.enemyDeck.length > 0) {
    mkDeck(1, encounter.enemyDeck.map(def => ({ def, upgraded: false })))
  }
  state.cards.sort((a, b) => a.iid - b.iid)

  // --- Куратор.
  if (encounter.curatorPeriod) {
    state.curator = {
      period: encounter.curatorPeriod,
      nextAt: 1 + encounter.curatorPeriod,
      row: rngInt(state.rng, h),
      dir: rngInt(state.rng, 2) === 0 ? 1 : -1,
    }
  }

  // --- Реликвии: onBattleStart (через мини-контекст без undo — setup не откатывается).
  // Хуки onBattleStart применяются в meta-слое при формировании армии,
  // здесь оставлен только вызов для боевых реликвий вида «+краска на старте».
  for (const rid of state.relics) {
    const hook = relicDef(rid).hooks?.onBattleStart
    if (hook) {
      // Лёгкий контекст: жульничаем аккуратно — импорт Recorder создал бы цикл.
      const paint = state.sides[0].paint
      hook({
        state,
        events: [],
        rngInt: n => rngInt(state.rng, n),
        pieceAt: () => null,
        pieceById: () => null,
        gainPaint: (side, n) => {
          const s = state.sides[side]
          s.paint = Math.max(0, Math.min(s.paintMax, s.paint + n))
        },
        dealDamage: () => {},
        destroyPiece: () => {},
        spawnPiece: () => null,
        addTrait: (target, traitId, turns) => {
          target.traits.push({ id: traitId, turnsLeft: turns })
        },
        pushPiece: () => {},
        cutTile: () => {},
        glueTile: () => {},
        drawCards: (side, n) => {
          const s = state.sides[side]
          for (let i = 0; i < n && s.draw.length > 0 && s.hand.length < s.handLimit; i++) {
            s.hand.push(s.draw.pop() as number)
          }
        },
        swapPieces: () => {},
      })
      void paint
    }
  }

  return state
}
