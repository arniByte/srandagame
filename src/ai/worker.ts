/// <reference lib="webworker" />
import { loadContent } from '../content'
import type { Action } from '../engine'
import { decodeState, legalActions } from '../engine'
import { pickSoftmax, search } from './search'
import type { AiRequest, AiResponse } from './protocol'
import { TIER_PARAMS } from './protocol'

/**
 * Модульный Web Worker поискового ИИ.
 * Поиск синхронный, поэтому cancel работает как флаг: отменяет запрос,
 * ждущий в очереди, либо гасит отправку результата уже посчитанного.
 */

loadContent()

const scope = self as unknown as DedicatedWorkerGlobalScope
const cancelled = new Set<number>()

scope.onmessage = (ev: MessageEvent<AiRequest>) => {
  const msg = ev.data
  if (msg.cmd === 'cancel') {
    cancelled.add(msg.requestId)
    return
  }
  if (cancelled.delete(msg.requestId)) return // отменили до старта

  const params = TIER_PARAMS[msg.tier]
  let action: Action | null = null
  let score = 0
  let depth = 0
  let nodes = 0
  try {
    const state = decodeState(msg.stateJson)
    const out = search(state, {
      maxDepth: params.maxDepth,
      budgetMs: msg.budgetMs ?? params.budgetMs,
      useCards: params.useCards,
      exactRoot: params.softmax,
    })
    score = out.score
    depth = out.depth
    nodes = out.nodes
    action = params.softmax
      ? pickSoftmax(out.rootMoves, msg.seed ?? 0) ?? out.action
      : out.action
  } catch {
    action = null
  }
  // Худший случай: первое легальное действие на свежекодированном состоянии.
  if (!action) {
    action = legalActions(decodeState(msg.stateJson))[0] ?? { t: 'endTurn' }
  }
  if (cancelled.delete(msg.requestId)) return

  const res: AiResponse = { requestId: msg.requestId, action, score, depth, nodes }
  scope.postMessage(res)
}
