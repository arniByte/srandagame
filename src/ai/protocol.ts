import type { Action, AiTier } from '../engine/types'

/**
 * Протокол main thread ↔ AI-воркер и параметры тиров.
 * Отдельный модуль: клиент не должен импортировать worker.ts (side effects).
 */

export interface TierParams {
  budgetMs: number
  maxDepth: number
  useCards: boolean
  /** Мягкий детерминированный выбор из топ-4 (слабый ИИ «ошибается» правдоподобно). */
  softmax: boolean
}

export const TIER_PARAMS: Record<AiTier, TierParams> = {
  apprentice: { budgetMs: 300, maxDepth: 3, useCards: false, softmax: true },
  journeyman: { budgetMs: 900, maxDepth: 5, useCards: true, softmax: false },
  master: { budgetMs: 2500, maxDepth: 8, useCards: true, softmax: false },
}

/** Минимальная «пауза раздумий» ИИ — стоп-моушен думает. */
export const MIN_THINK_MS = 600

export interface AiSearchRequest {
  cmd: 'search'
  requestId: number
  stateJson: string
  tier: AiTier
  budgetMs?: number
  /** Сид детерминированного softmax-выбора (apprentice). */
  seed?: number
}

export interface AiCancelRequest {
  cmd: 'cancel'
  requestId: number
}

export type AiRequest = AiSearchRequest | AiCancelRequest

export interface AiResponse {
  requestId: number
  action: Action
  score: number
  depth: number
  nodes: number
}
