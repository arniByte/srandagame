import type { Action, BattleState, Sq } from '../engine'
import { applyMut, computeZobrist, movesFor, pieceAt, unmake } from '../engine'
import { evaluate } from './evaluate'
import { cardCandidates } from './cardCandidates'
import { type KillerTable, makeKillers, noteKiller, orderActions } from './ordering'

/**
 * Негамакс с нюансом: за один «ход» сторона делает несколько действий
 * (ход фигурой + карты + endTurn). Знак меняется ТОЛЬКО когда действие
 * передало ход (child.active !== parent.active, т.е. после endTurn).
 * Alpha-beta, итеративное углубление, TT, killer'ы, квиесенс-лайт.
 * Детерминизм: тай-брейк строго по порядку генерации, никакого Math.random.
 */

/** Победа = WIN - ply: ближе к корню — лучше. */
export const WIN = 100_000
const INF = 1 << 28
const TT_CAP = 1 << 18
/** Проверка бюджета времени раз в 2048 узлов. */
const TIME_MASK = 2047
/** Бюджет карточных действий на линию поиска. */
const CARD_PLIES = 2
/** Максимум доп. слоёв квиесенса (только взятия/удары по воротам). */
const Q_LAYERS = 4

const EXACT = 0, LOWER = 1, UPPER = 2

interface TTEntry {
  depth: number
  score: number
  flag: number
  actionIdx: number
}

export interface SearchLimits {
  maxDepth: number
  /** Мс на весь поиск; не задан — без лимита времени (тесты). */
  budgetMs?: number
  /** Жёсткий лимит узлов (тесты). */
  maxNodes?: number
  useCards: boolean
  /** false — TT отключена (тест эквивалентности). По умолчанию включена. */
  useTT?: boolean
  /** Полное окно на корне: точные оценки всех ходов (нужно softmax-тиру). */
  exactRoot?: boolean
  /** Источник времени (подменяем в тестах). */
  now?: () => number
}

export interface RootMove {
  action: Action
  score: number
}

export interface SearchOutcome {
  action: Action | null
  score: number
  /** Последняя полностью завершённая глубина. */
  depth: number
  nodes: number
  /** Ходы корня с оценками (по убыванию) — для softmax слабых тиров. */
  rootMoves: RootMove[]
}

const defaultNow = (): number =>
  typeof performance !== 'undefined' ? performance.now() : 0

class Searcher {
  nodes = 0
  private stopped = false
  private readonly tt = new Map<string, TTEntry>()
  private readonly killers: KillerTable = makeKillers()
  private readonly deadline: number
  private readonly now: () => number
  private readonly maxNodes: number

  constructor(private readonly limits: SearchLimits) {
    this.now = limits.now ?? defaultNow
    this.deadline = limits.budgetMs !== undefined ? this.now() + limits.budgetMs : Infinity
    this.maxNodes = limits.maxNodes ?? Infinity
  }

  run(state: BattleState): SearchOutcome {
    const out: SearchOutcome = { action: null, score: 0, depth: 0, nodes: 0, rootMoves: [] }
    if (state.result) return out

    let prevBestIdx = -1

    for (let d = 1; d <= this.limits.maxDepth; d++) {
      const actions = this.genActions(state, d, CARD_PLIES)
      if (actions.length === 0) break
      // Страховка худшего случая: до первой завершённой итерации — первое действие.
      if (!out.action) out.action = actions[0] ?? null

      const order = orderActions(state, actions, prevBestIdx, this.killers, 0)
      let alpha = -INF
      let best = -INF
      let bestIdx = -1
      let bestAction: Action | null = null
      const scores: RootMove[] = []
      let aborted = false

      for (let oi = 0; oi < order.length; oi++) {
        const idx = order[oi] as number
        const act = actions[idx] as Action
        const parentActive = state.active
        const nextCards = act.t === 'playCard' ? CARD_PLIES - 1 : CARD_PLIES
        const undo = applyMut(state, act)
        const score = state.active === parentActive
          ? this.negamax(state, d - 1, alpha, INF, 1, nextCards)
          : -this.negamax(state, d - 1, -INF, -alpha, 1, nextCards)
        unmake(state, undo)
        if (this.stopped) { aborted = true; break }
        scores.push({ action: act, score })
        if (score > best) { best = score; bestIdx = idx; bestAction = act }
        if (!this.limits.exactRoot && score > alpha) alpha = score
      }

      // Прерванную итерацию отбрасываем — результат предыдущей уже полный.
      if (aborted) break
      out.action = bestAction ?? out.action
      out.score = best
      out.depth = d
      scores.sort((a, b) => b.score - a.score)
      out.rootMoves = scores
      prevBestIdx = bestIdx
      // Немедленная победа найдена — глубже искать незачем.
      if (best >= WIN - 64) break
    }

    out.nodes = this.nodes
    return out
  }

  private tick(): void {
    this.nodes++
    if (this.nodes >= this.maxNodes) { this.stopped = true; return }
    if ((this.nodes & TIME_MASK) === 0 && this.now() > this.deadline) this.stopped = true
  }

  private terminal(state: BattleState, ply: number): number {
    const r = state.result
    if (!r || r.winner === 'draw') return 0
    return r.winner === state.active ? WIN - ply : -(WIN - ply)
  }

  /** Действия узла: промоушен форсирован; карты — по бюджету и глубине. */
  private genActions(state: BattleState, depth: number, cardPlies: number): Action[] {
    if (state.phase === 'promote' && state.promoting) {
      const pr = state.promoting
      return pr.options.map(into => ({ t: 'promote' as const, piece: pr.piece, into }))
    }
    const out: Action[] = []
    if (!state.movedThisTurn) {
      for (const p of state.pieces) {
        if (p.owner !== state.active) continue
        for (const to of movesFor(state, p)) out.push({ t: 'move', piece: p.id, to })
      }
    }
    if (this.limits.useCards && cardPlies > 0 && depth >= 2) {
      for (const a of cardCandidates(state)) out.push(a)
    }
    out.push({ t: 'endTurn' })
    return out
  }

  private negamax(
    state: BattleState,
    depth: number,
    alpha: number,
    beta: number,
    ply: number,
    cardPlies: number,
  ): number {
    this.tick()
    if (this.stopped) return 0
    if (state.result) return this.terminal(state, ply)
    if (depth <= 0) return this.qsearch(state, alpha, beta, ply, Q_LAYERS)

    const useTT = this.limits.useTT !== false
    let key = ''
    let ttIdx = -1
    if (useTT) {
      const z = computeZobrist(state)
      key = z[0].toString(36) + ':' + z[1].toString(36) + ':' + cardPlies
      const e = this.tt.get(key)
      if (e) {
        ttIdx = e.actionIdx
        // Возвращаем только ТОЧНЫЕ оценки той же глубины: результат поиска
        // с TT и без совпадает (важно для тестов и отладки); bound-записи
        // работают через сортировку (ttIdx).
        if (e.depth === depth && e.flag === EXACT) return e.score
      }
    }

    const actions = this.genActions(state, depth, cardPlies)
    const order = orderActions(state, actions, ttIdx, this.killers, ply)
    const alpha0 = alpha
    let best = -INF
    let bestIdx = -1

    for (let oi = 0; oi < order.length; oi++) {
      const idx = order[oi] as number
      const act = actions[idx] as Action
      const parentActive = state.active
      const nextCards = act.t === 'playCard' ? cardPlies - 1 : cardPlies
      const undo = applyMut(state, act)
      const score = state.active === parentActive
        ? this.negamax(state, depth - 1, alpha, beta, ply + 1, nextCards)
        : -this.negamax(state, depth - 1, -beta, -alpha, ply + 1, nextCards)
      unmake(state, undo)
      if (this.stopped) return 0
      if (score > best) { best = score; bestIdx = idx }
      if (score > alpha) alpha = score
      if (alpha >= beta) {
        // Тихий ход с отсечкой — killer.
        if (act.t === 'move' && !pieceAt(state, act.to)) noteKiller(this.killers, ply, act)
        break
      }
    }

    if (useTT && bestIdx >= 0 && Math.abs(best) < WIN - 256) {
      const flag = best <= alpha0 ? UPPER : best >= beta ? LOWER : EXACT
      this.ttStore(key, { depth, score: best, flag, actionIdx: bestIdx })
    }
    return best
  }

  /**
   * Квиесенс-лайт: на глубине 0 продолжаем только взятия/удары по воротам
   * (не больше Q_LAYERS слоёв). Промоушен форсирован и слой не тратит.
   */
  private qsearch(
    state: BattleState,
    alpha: number,
    beta: number,
    ply: number,
    layers: number,
  ): number {
    this.tick()
    if (this.stopped) return 0
    if (state.result) return this.terminal(state, ply)

    if (state.phase === 'promote' && state.promoting) {
      const pr = state.promoting
      let best = -INF
      for (const into of pr.options) {
        const undo = applyMut(state, { t: 'promote', piece: pr.piece, into })
        const score = this.qsearch(state, alpha, beta, ply + 1, layers) // active не меняется
        unmake(state, undo)
        if (this.stopped) return 0
        if (score > best) best = score
        if (score > alpha) alpha = score
        if (alpha >= beta) break
      }
      return best
    }

    const stand = evaluate(state)
    // Уже ходили в этот ход — взятий больше нет, только стоячая оценка.
    if (layers <= 0 || state.movedThisTurn) return stand
    if (stand >= beta) return stand
    if (stand > alpha) alpha = stand
    let best = stand

    for (const p of state.pieces) {
      if (p.owner !== state.active) continue
      const ms = movesFor(state, p)
      for (let i = 0; i < ms.length; i++) {
        const to = ms[i] as Sq
        if (!pieceAt(state, to)) continue // только взятия/бампы
        const undo = applyMut(state, { t: 'move', piece: p.id, to })
        const score = this.qsearch(state, alpha, beta, ply + 1, layers - 1)
        unmake(state, undo)
        if (this.stopped) return 0
        if (score > best) best = score
        if (score > alpha) alpha = score
        if (alpha >= beta) return best
      }
    }
    return best
  }

  private ttStore(key: string, e: TTEntry): void {
    const tt = this.tt
    if (!tt.has(key) && tt.size >= TT_CAP) {
      // Простое вытеснение: удаляем самую старую запись (порядок вставки Map).
      const oldest = tt.keys().next()
      if (!oldest.done) tt.delete(oldest.value)
    }
    tt.set(key, e)
  }
}

export function search(state: BattleState, limits: SearchLimits): SearchOutcome {
  return new Searcher(limits).run(state)
}

/**
 * Детерминированный softmax-выбор из топ-N корневых ходов (тир apprentice).
 * Сид → splitmix32 → равномерное [0,1); Math.random не используется.
 */
export function pickSoftmax(
  rootMoves: RootMove[],
  seed: number,
  topN = 4,
  temperature = 150,
): Action | null {
  if (rootMoves.length === 0) return null
  const top = rootMoves.slice(0, Math.min(topN, rootMoves.length))
  const bestScore = (top[0] as RootMove).score
  // Немедленную победу не разыгрываем в лотерею.
  if (bestScore >= WIN - 256) return (top[0] as RootMove).action
  // Грубые зевки (хуже лучшего на >500cp) отсекаем.
  const pool = top.filter(m => bestScore - m.score <= 500)
  const weights: number[] = []
  let sum = 0
  for (const m of pool) {
    const w = Math.exp((m.score - bestScore) / temperature)
    weights.push(w)
    sum += w
  }
  let z = (seed ^ 0x9e3779b9) >>> 0
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0
  z = (z ^ (z >>> 15)) >>> 0
  let r = (z / 4294967296) * sum
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i] as number
    if (r <= 0) return (pool[i] as RootMove).action
  }
  return (pool[pool.length - 1] as RootMove).action
}
