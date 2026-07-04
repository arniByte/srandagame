import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js'
import type { NetMsg } from './protocol'
import type { PeerInfo, RoomTransport } from './transport'

/**
 * Комната на Supabase Realtime broadcast + presence. Без БД и авторизации:
 * код комнаты = capability. Трафик пошаговый — единицы сообщений в минуту.
 */

let client: SupabaseClient | null = null

// Фолбэк: anon-ключ Supabase публичен по дизайну (защита — RLS/отсутствие таблиц),
// поэтому кооп работает даже без env-переменных на хостинге.
const FALLBACK_URL = 'https://heirpnnazjrcnfljridj.supabase.co'
const FALLBACK_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhlaXJwbm5hempyY25mbGpyaWRqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1Nzc2OTMsImV4cCI6MjA5ODE1MzY5M30.5LOw-XvLbg4mxxkEWGi08vr3aWfAYO-2R9z2Pj_yto8'

const supaUrl = (): string => (import.meta.env.VITE_SUPABASE_URL as string | undefined) || FALLBACK_URL
const supaKey = (): string => (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || FALLBACK_ANON

export function supabaseAvailable(): boolean {
  return Boolean(supaUrl() && supaKey())
}

function getClient(): SupabaseClient {
  if (!client) {
    client = createClient(supaUrl(), supaKey(),
      { realtime: { params: { eventsPerSecond: 20 } } })
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
