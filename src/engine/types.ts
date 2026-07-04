/**
 * КОНТРАКТ ДВИЖКА. Всё здесь — чистые данные: только целые числа,
 * никаких ссылок на DOM/Pixi/Three, полностью сериализуемо structuredClone/JSON.
 *
 * Правила детерминизма (обязательны для lockstep-коопа):
 * - никакого Math.random / Date / транцендентных функций в движке;
 * - вся случайность — из state.rng (xoshiro128**);
 * - pieces отсортированы по id, cards по iid — канонический порядок итерации.
 */

export type PlayerId = 0 | 1
/** Клетка: x + y*16 (доска максимум 12×12); -1 = нет. */
export type Sq = number
export type RngState = [number, number, number, number]

export const NO_SQ = -1
export const HOLE = -1
export const T_PLAIN = 0
/** Клетка-зона ворот (визуальная пометка «замок»). */
export const T_GATE = 2

export const sqX = (s: Sq): number => s & 15
export const sqY = (s: Sq): number => s >> 4
export const mkSq = (x: number, y: number): Sq => x + y * 16

export interface BoardState {
  w: number
  h: number
  /** Длина w*h, индекс y*w+x; HOLE(-1) = дыра в «бумаге», иначе террейн. */
  tiles: number[]
}

export const tileIdx = (b: BoardState, s: Sq): number => sqY(s) * b.w + sqX(s)
export const onBoard = (b: BoardState, x: number, y: number): boolean =>
  x >= 0 && y >= 0 && x < b.w && y < b.h
export const tileAt = (b: BoardState, s: Sq): number => {
  const x = sqX(s), y = sqY(s)
  if (!onBoard(b, x, y)) return HOLE
  return b.tiles[y * b.w + x] ?? HOLE
}

export interface PieceTrait {
  id: string
  /** Оставшиеся ходы; -1 = навсегда. Тикает в начале хода владельца. */
  turnsLeft: number
}

export interface Piece {
  id: number
  owner: PlayerId
  /** PieceTypeId из реестра. */
  type: string
  pos: Sq
  /** -1 = классическая шахматная фигура (взятие = смерть); >0 = структура/ворота с HP. */
  hp: number
  maxHp: number
  traits: PieceTrait[]
  moved: boolean
  /** Связь с ростером забега; null у призванных/вражеских. */
  rosterId: string | null
}

export interface CardInstance {
  iid: number
  /** CardDefId из реестра. */
  def: string
  upgraded: boolean
}

export type Zone = 'draw' | 'hand' | 'discard' | 'exhausted'

export interface SideState {
  paint: number
  paintMax: number
  draw: number[]
  hand: number[]
  discard: number[]
  exhausted: number[]
  handLimit: number
}

export type Objective =
  /** «Мат» в духе рогалика: срубить вражескую королевскую фигуру. */
  | { kind: 'regicide' }
  | { kind: 'siege'; gatePieceId: number }
  | { kind: 'survive'; turnsRequired: number }
  | { kind: 'escort'; escortPieceId: number; goals: Sq[] }

export interface CuratorState {
  /** Каждые period полных ходов Куратор сдвигает ряд коллажа. */
  period: number
  nextAt: number
  row: number
  dir: 1 | -1
}

export type Phase = 'main' | 'promote' | 'ended'

export interface BattleState {
  v: 1
  rng: RngState
  /** Номер полного хода (инкремент при возврате хода игроку 0). */
  turn: number
  ply: number
  active: PlayerId
  phase: Phase
  promoting: { piece: number; options: string[] } | null
  movedThisTurn: boolean
  board: BoardState
  pieces: Piece[]
  cards: CardInstance[]
  sides: [SideState, SideState]
  objective: Objective
  /** Была ли у стороны королевская фигура на старте (гибель = поражение). */
  hadRoyal: [boolean, boolean]
  /** Реликвии игрока, влияющие на бой (id из реестра). */
  relics: string[]
  curator: CuratorState | null
  nextId: number
  result: { winner: PlayerId | 'draw'; reason: string } | null
}

// ---------------------------------------------------------------------------
// Действия

export type Action =
  | { t: 'move'; piece: number; to: Sq }
  | { t: 'playCard'; iid: number; targets: Sq[] }
  | { t: 'promote'; piece: number; into: string }
  | { t: 'endTurn' }
  | { t: 'concede' }

// ---------------------------------------------------------------------------
// События движка (для рендера/звука/диорамы; ИИ их не читает)

export type EngineEvent =
  | { e: 'turnStarted'; side: PlayerId; turn: number }
  | { e: 'moved'; piece: number; type: string; owner: PlayerId; from: Sq; to: Sq }
  | { e: 'captured'; victim: number; type: string; owner: PlayerId; at: Sq; by: number }
  | { e: 'bumped'; attacker: number; target: number; at: Sq; dmg: number }
  | { e: 'damaged'; piece: number; at: Sq; hp: number; dmg: number }
  | { e: 'destroyed'; piece: number; type: string; owner: PlayerId; at: Sq }
  | { e: 'summoned'; piece: number; type: string; owner: PlayerId; at: Sq }
  | { e: 'cardPlayed'; side: PlayerId; iid: number; def: string; targets: Sq[] }
  | { e: 'cardDrawn'; side: PlayerId; iid: number }
  | { e: 'reshuffled'; side: PlayerId }
  | { e: 'paint'; side: PlayerId; delta: number; now: number }
  | { e: 'tileCut'; at: Sq }
  | { e: 'tileGlued'; at: Sq }
  | { e: 'traitAdded'; piece: number; trait: string }
  | { e: 'traitExpired'; piece: number; trait: string }
  | { e: 'pushed'; piece: number; from: Sq; to: Sq }
  | { e: 'swapped'; a: number; b: number }
  | { e: 'promoteOffered'; piece: number; options: string[] }
  | { e: 'promoted'; piece: number; into: string }
  | { e: 'check'; side: PlayerId; royal: number }
  | { e: 'curatorWarn'; row: number; dir: 1 | -1; inTurns: number }
  | { e: 'curatorShift'; row: number; dir: 1 | -1 }
  | { e: 'battleEnded'; winner: PlayerId | 'draw'; reason: string }

// ---------------------------------------------------------------------------
// Определения контента (регистрируются из src/content)

export interface PieceTypeDef {
  id: string
  name: string
  /** Ценность в «пешках» (оценка ИИ, лимиты карт). */
  value: number
  /** Сколько краски даёт взятие этой фигуры. */
  paintValue: number
  royal?: boolean
  /** Прыжки (конь/король): пары [dx,dy], dy положительный = «вперёд» владельца. */
  leaps?: readonly (readonly [number, number])[]
  /** Лучи (слон/ладья/ферзь). */
  rides?: readonly (readonly [number, number])[]
  /** Пешечная логика: шаг вперёд, двойной с места, взятие по диагонали, промоушен. */
  pawn?: boolean
  /** Не может двигаться вообще (ворота, Чёрный Квадрат). */
  immobile?: boolean
  /** Входит в пул промоушен-драфта. */
  promo?: boolean
  /** Структура с очками прочности (ворота). */
  hp?: number
}

/** Фигура ростера, входящая в бой (подмножество RosterPiece из меты). */
export interface RosterInput {
  rid: string
  type: string
  traits: string[]
}

export interface DeckInput {
  def: string
  upgraded: boolean
}

export interface TargetSpec {
  kind: 'none' | 'tile' | 'piece' | 'twoPieces'
  /** Для tile. */
  tile?: 'empty' | 'hole' | 'any'
  /** Для piece/twoPieces. */
  side?: 'ally' | 'enemy' | 'any'
  /** Максимальная ценность фигуры-цели (для «растворителя»). */
  maxValue?: number
  /** Клетка должна быть на своей половине доски. */
  ownHalf?: boolean
}

export type EffectOp =
  | { op: 'summon'; pieceType: string; traits?: string[] }
  | { op: 'damage'; n: number }
  | { op: 'destroy' }
  | { op: 'addTrait'; trait: string; turns: number }
  | { op: 'cutTile' }
  | { op: 'glueTile' }
  | { op: 'push'; dist: number }
  | { op: 'gainPaint'; n: number }
  | { op: 'draw'; n: number }
  | { op: 'swap' }

export interface CardDef {
  id: string
  name: string
  desc: string
  cost: number
  rarity: 'common' | 'uncommon' | 'rare'
  /** Ключ ассета иллюстрации. */
  illus: string
  target: TargetSpec
  effects: EffectOp[]
  /** Подсказка ИИ. */
  aiHint: { weight: number; cat: 'removal' | 'summon' | 'terrain' | 'buff' | 'economy' }
  /** Изменения при апгрейде (упрощённо: скидка стоимости). */
  upgradeCostDelta?: number
}

/**
 * Контекст санкционированных операций для хуков черт/реликвий и эффектов карт.
 * Все операции записывают undo-записи — make/unmake остаётся корректным.
 */
export interface Ctx {
  state: BattleState
  events: EngineEvent[]
  rngInt(n: number): number
  pieceAt(s: Sq): Piece | null
  pieceById(id: number): Piece | null
  gainPaint(side: PlayerId, n: number): void
  dealDamage(target: Piece, n: number): void
  destroyPiece(target: Piece): void
  spawnPiece(owner: PlayerId, type: string, at: Sq, traits?: string[]): Piece | null
  addTrait(target: Piece, traitId: string, turns: number): void
  pushPiece(target: Piece, from: Sq, dist: number): void
  cutTile(at: Sq): void
  glueTile(at: Sq): void
  drawCards(side: PlayerId, n: number): void
  swapPieces(a: Piece, b: Piece): void
}

export interface TraitDef {
  id: string
  name: string
  desc: string
  stacking: 'none' | 'refresh' | 'stack'
  /** Фигура с этой чертой не может ходить. */
  blocksMovement?: boolean
  /** Иммунитет к push/swap/freeze/destroy от карт. */
  anchored?: boolean
  hooks?: {
    /** Модифицирует список ходов фигуры (добавить/убрать клетки). */
    modifyMoves?(state: BattleState, self: Piece, moves: Sq[]): Sq[]
    onCapture?(ctx: Ctx, self: Piece, victimValue: number): void
    onTurnStart?(ctx: Ctx, self: Piece): void
    /** Бонус к оценке ИИ (в сантипешках). */
    evalBonus?: number
  }
}

export interface RelicDef {
  id: string
  name: string
  desc: string
  /** Ключ ассета. */
  illus: string
  hooks?: {
    onBattleStart?(ctx: Ctx): void
    onCapture?(ctx: Ctx, byOwner: PlayerId, victimValue: number): void
    /** Модификация стоимости карты игрока. */
    modifyCardCost?(state: BattleState, def: CardDef, cost: number): number
    onTurnStart?(ctx: Ctx, side: PlayerId): void
  }
}

export type AiTier = 'apprentice' | 'journeyman' | 'master'

export interface EncounterDef {
  id: string
  name: string
  /**
   * ASCII-доска, строки сверху вниз. Символы:
   * '.' пустая клетка, '#' дыра, '*' зона расстановки игрока,
   * буквы = вражеские фигуры (p n b r q k d = пешка конь слон ладья ферзь король ворота),
   * 'G' = ворота (hp), заглавные/строчные не различаются для врага.
   */
  board: string[]
  objective:
    | { kind: 'regicide' }
    | { kind: 'siege' }
    | { kind: 'survive'; turns: number }
    | { kind: 'escort'; goalRow: number }
  aiTier: AiTier
  curatorPeriod?: number
  /** Колода врага (для элиток/боссов). */
  enemyDeck?: string[]
  /** Стартовая краска врага. */
  enemyPaint?: number
  /** Награда золотом. */
  gold: [min: number, max: number]
  elite?: boolean
  boss?: boolean
}

// ---------------------------------------------------------------------------
// Undo (для make/unmake ИИ)

export interface MetaSnapshot {
  rng: RngState
  turn: number
  ply: number
  active: PlayerId
  phase: Phase
  promoting: { piece: number; options: string[] } | null
  movedThisTurn: boolean
  curator: CuratorState | null
  result: { winner: PlayerId | 'draw'; reason: string } | null
  nextId: number
}

export type UndoOp =
  | { u: 'pos'; id: number; pos: Sq; moved: boolean }
  | { u: 'hp'; id: number; hp: number }
  | { u: 'addP'; id: number }
  | { u: 'remP'; piece: Piece }
  | { u: 'trait+'; id: number; trait: string }
  | { u: 'trait-'; id: number; index: number; trait: PieceTrait }
  | { u: 'traitT'; id: number; index: number; turns: number }
  | { u: 'tile'; idx: number; terrain: number }
  | { u: 'paint'; side: PlayerId; paint: number }
  | { u: 'zones'; side: PlayerId; draw: number[]; hand: number[]; discard: number[]; exhausted: number[] }

export interface UndoRecord {
  meta: MetaSnapshot
  ops: UndoOp[]
}
