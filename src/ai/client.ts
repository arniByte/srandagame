import type { Action, AiTier, BattleState } from '../engine'
import { decodeState, encodeState, legalActions } from '../engine'
import { loadContent } from '../content'
import type { AiRequest, AiResponse } from './protocol'
import { MIN_THINK_MS, TIER_PARAMS } from './protocol'

/**
 * Фасад ИИ для главного потока. Таймауты/пейсинг — чисто презентационная
 * логика (Date.now допустим): выбранное действие детерминирует воркер.
 */

interface Pending {
  resolve(a: Action): void
  reject(e: Error): void
  timer: ReturnType<typeof setTimeout>
  startedAt: number
}

export class AiClient {
  private readonly worker: Worker
  private readonly pending = new Map<number, Pending>()
  private nextId = 1

  constructor() {
    loadContent() // идемпотентно; нужен для fallback-legalActions
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    this.worker.onmessage = (ev: MessageEvent<AiResponse>) => this.onResult(ev.data)
  }

  /**
   * Запросить ход ИИ. seed — детерминированный сид softmax тира apprentice.
   * Резолвится не раньше MIN_THINK_MS (стоп-моушен «думает»); при молчании
   * воркера дольше budget*3 — страховка первым легальным действием.
   */
  requestMove(state: BattleState, tier: AiTier, seed = 0): Promise<Action> {
    const requestId = this.nextId++
    const params = TIER_PARAMS[tier]
    const stateJson = encodeState(state)

    return new Promise<Action>((resolve, reject) => {
      const startedAt = Date.now()
      const timer = setTimeout(() => {
        if (!this.pending.delete(requestId)) return
        this.post({ cmd: 'cancel', requestId })
        const fallback = legalActions(decodeState(stateJson))[0] ?? { t: 'endTurn' as const }
        resolve(fallback)
      }, params.budgetMs * 3)
      this.pending.set(requestId, { resolve, reject, timer, startedAt })
      this.post({ cmd: 'search', requestId, stateJson, tier, budgetMs: params.budgetMs, seed })
    })
  }

  /** Отменить все висящие запросы (промисы реджектятся 'ai-cancelled'). */
  cancel(): void {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer)
      this.post({ cmd: 'cancel', requestId: id })
      p.reject(new Error('ai-cancelled'))
    }
    this.pending.clear()
  }

  dispose(): void {
    this.cancel()
    this.worker.terminate()
  }

  private onResult(res: AiResponse): void {
    const p = this.pending.get(res.requestId)
    if (!p) return
    this.pending.delete(res.requestId)
    clearTimeout(p.timer)
    // Пейсинг: ИИ отвечает не раньше MIN_THINK_MS после запроса.
    const wait = Math.max(0, MIN_THINK_MS - (Date.now() - p.startedAt))
    if (wait === 0) p.resolve(res.action)
    else setTimeout(() => p.resolve(res.action), wait)
  }

  private post(msg: AiRequest): void {
    this.worker.postMessage(msg)
  }
}
