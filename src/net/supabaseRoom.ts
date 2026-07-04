import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js'
import type { NetMsg } from './protocol'
import type { PeerInfo, RoomTransport } from './transport'

/**
 * Комната на Supabase Realtime broadcast + presence. Без БД и авторизации:
 * код комнаты = capability. Трафик пошаговый — единицы сообщений в минуту.
 */

let client: SupabaseClient | null = null

export function supabaseAvailable(): boolean {
  return Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY)
}

function getClient(): SupabaseClient {
  if (!client) {
    client = createClient(
      import.meta.env.VITE_SUPABASE_URL as string,
      import.meta.env.VITE_SUPABASE_ANON_KEY as string,
      { realtime: { params: { eventsPerSecond: 20 } } },
    )
  }
  return client
}

export async function joinRoom(
  code: string,
  me: { role: 'host' | 'guest'; name: string },
): Promise<RoomTransport> {
  const channel: RealtimeChannel = getClient().channel(`cm:${code}`, {
    config: {
      broadcast: { self: false, ack: false },
      presence: { key: `${me.role}-${Math.random().toString(36).slice(2, 8)}` },
    },
  })

  const msgHandlers = new Set<(m: NetMsg) => void>()
  const presHandlers = new Set<(p: PeerInfo[]) => void>()

  channel.on('broadcast', { event: 'cm' }, payload => {
    const msg = payload.payload as NetMsg
    for (const fn of [...msgHandlers]) fn(msg)
  })

  const emitPresence = (): void => {
    const state = channel.presenceState<{ role: 'host' | 'guest'; name: string }>()
    const peers: PeerInfo[] = []
    for (const [key, metas] of Object.entries(state)) {
      const m = metas[0]
      if (m) peers.push({ key, role: m.role, name: m.name })
    }
    for (const fn of [...presHandlers]) fn(peers)
  }
  channel.on('presence', { event: 'sync' }, emitPresence)
  channel.on('presence', { event: 'join' }, emitPresence)
  channel.on('presence', { event: 'leave' }, emitPresence)

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('supabase: таймаут подключения')), 12000)
    channel.subscribe(status => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(timer)
        void channel.track({ role: me.role, name: me.name })
        resolve()
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        clearTimeout(timer)
        reject(new Error(`supabase: ${status}`))
      }
    })
  })

  return {
    send(msg) {
      void channel.send({ type: 'broadcast', event: 'cm', payload: msg })
    },
    onMessage(fn) {
      msgHandlers.add(fn)
      return () => msgHandlers.delete(fn)
    },
    onPresence(fn) {
      presHandlers.add(fn)
      return () => presHandlers.delete(fn)
    },
    close() {
      void channel.unsubscribe()
      msgHandlers.clear()
      presHandlers.clear()
    },
  }
}
