import type { EngineEvent } from '../engine/types'

/**
 * Единственный канал связи между слоями (engine → render/diorama/audio/ui).
 * Никто из слоёв не импортирует другой слой напрямую.
 */
export interface GameEvents {
  /** События движка после применения действия (пакетом, в порядке возникновения). */
  engine: { events: EngineEvent[] }
  /** Экранная тряска: сила в пикселях. */
  shake: { power: number }
  /** Смена экрана верхнего уровня. */
  screen: { name: ScreenName }
  /** Ассеты подменились (горячая подмена арта). */
  assetsSwapped: { keys: string[] }
  /** Изменение качества рендера. */
  quality: { tier: QualityTier }
  /** Логический ресайз вьюпорта. */
  resize: { w: number; h: number; dpr: number }
}

export type ScreenName =
  | 'menu' | 'map' | 'battle' | 'shop' | 'event' | 'rest'
  | 'reward' | 'lobby' | 'gameover' | 'victory'

export type QualityTier = 'high' | 'medium' | 'low'

type Handler<T> = (payload: T) => void

class Bus {
  private handlers = new Map<keyof GameEvents, Set<Handler<never>>>()

  on<K extends keyof GameEvents>(type: K, fn: Handler<GameEvents[K]>): () => void {
    let set = this.handlers.get(type)
    if (!set) { set = new Set(); this.handlers.set(type, set) }
    set.add(fn as Handler<never>)
    return () => set.delete(fn as Handler<never>)
  }

  emit<K extends keyof GameEvents>(type: K, payload: GameEvents[K]): void {
    const set = this.handlers.get(type)
    if (!set) return
    for (const fn of [...set]) (fn as Handler<GameEvents[K]>)(payload)
  }
}

export const bus = new Bus()
