import type { NetMsg } from './protocol'

/**
 * Абстракция комнаты: Supabase Realtime в проде, Loopback в тестах.
 */
export interface PeerInfo {
  key: string
  role: 'host' | 'guest'
  name: string
}

export interface RoomTransport {
  send(msg: NetMsg): void
  onMessage(fn: (msg: NetMsg) => void): () => void
  onPresence(fn: (peers: PeerInfo[]) => void): () => void
  close(): void
}

/** Пара связанных транспортов в памяти (для тестов и локальной отладки). */
export function loopbackPair(): [RoomTransport, RoomTransport] {
  const aHandlers = new Set<(m: NetMsg) => void>()
  const bHandlers = new Set<(m: NetMsg) => void>()

  const mk = (mine: Set<(m: NetMsg) => void>, theirs: Set<(m: NetMsg) => void>): RoomTransport => ({
    send(msg) {
      // Асинхронность как в реальной сети (микротаск), с копией сообщения.
      const copy = JSON.parse(JSON.stringify(msg)) as NetMsg
      queueMicrotask(() => { for (const fn of [...theirs]) fn(copy) })
    },
    onMessage(fn) {
      mine.add(fn)
      return () => mine.delete(fn)
    },
    onPresence() { return () => {} },
    close() { mine.clear() },
  })

  return [mk(aHandlers, bHandlers), mk(bHandlers, aHandlers)]
}
