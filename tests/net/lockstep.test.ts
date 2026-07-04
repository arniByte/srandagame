import { describe, expect, it } from 'vitest'
import { battle } from '../engine/helpers'
import { applyMut } from '../../src/engine/reducer'
import { validate, legalActions } from '../../src/engine/rules'
import { decodeState, encodeState, hashState } from '../../src/engine/serialize'
import type { Action, BattleState } from '../../src/engine/types'
import { loopbackPair } from '../../src/net/transport'
import { GuestSession, HostSession, type GuestDelegate, type HostDelegate } from '../../src/net/session'

/**
 * Локстеп на loopback-паре: хост применяет и рассылает, гость зеркалит,
 * хеши сходятся; рассинхрон лечится снапшотом.
 */

const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 0))
}

const BOARD = [
  '.nbknb.',
  'ppppppp',
  '.......',
  '...#...',
  '.......',
  '*******',
  '*******',
]

function makeHost(state: BattleState) {
  const [hostT, guestT] = loopbackPair()
  const applied: Action[] = []
  const delegate: HostDelegate = {
    getBattle: () => state,
    getRunJson: () => JSON.stringify({ v: 1, marker: 'run' }),
    getScreen: () => 'battle',
    async onGuestPropose(action) {
      const v = validate(state, action, 0)
      if (!v.ok) return false
      applyMut(state, action)
      applied.push(action)
      host.announce(action, state)
      return true
    },
    onGuestPresence() {},
  }
  const host = new HostSession(hostT, delegate, 'host')
  return { host, guestT, state, applied }
}

function makeGuest(guestT: ReturnType<typeof loopbackPair>[1]) {
  const g: {
    state: BattleState | null
    desyncs: number
    rejected: number
    screens: string[]
  } = { state: null, desyncs: 0, rejected: 0, screens: [] }

  const delegate: GuestDelegate = {
    async applyRemote(action) {
      applyMut(g.state as BattleState, action)
      return hashState(g.state as BattleState)
    },
    async loadSnapshot(_runJson, battleJson, screen) {
      if (battleJson) g.state = decodeState(battleJson)
      g.screens.push(screen)
    },
    onDenied() {},
    onRejected() { g.rejected++ },
    onDesync() { g.desyncs++ },
  }
  const session = new GuestSession(guestT, delegate, 'guest')
  return { session, g }
}

describe('кооп lockstep', () => {
  it('хост рассылает, гость зеркалит бит-в-бит; propose гостя работает', async () => {
    const state = battle(BOARD, { seed: 'net-1' })
    const { host, guestT } = makeHost(state)
    const { session, g } = makeGuest(guestT)
    await flush()

    await host.announceBattleStart(state)
    await flush()
    expect(g.state).not.toBeNull()
    expect(encodeState(g.state as BattleState)).toBe(encodeState(state))

    // Хост играет 5 действий.
    for (let i = 0; i < 5; i++) {
      const a = legalActions(state)[0] as Action
      applyMut(state, a)
      host.announce(a, state)
      await flush()
      expect(hashState(g.state as BattleState)).toBe(hashState(state))
    }

    // Докручиваем до хода игрока 0 в основной фазе.
    let guard = 0
    while ((state.active !== 0 || state.phase !== 'main') && !state.result && guard++ < 30) {
      const a = legalActions(state)[0] as Action
      applyMut(state, a)
      host.announce(a, state)
      await flush()
    }

    // Гость предлагает endTurn — хост применяет и рассылает обратно.
    const before = state.ply
    session.propose({ t: 'endTurn' })
    await flush()
    expect(state.ply).toBe(before + 1)
    expect(hashState(g.state as BattleState)).toBe(hashState(state))
    expect(g.desyncs).toBe(0)
  })

  it('нелегальный propose отклоняется', async () => {
    const state = battle(BOARD, { seed: 'net-2' })
    const { guestT } = makeHost(state)
    const { session, g } = makeGuest(guestT)
    await flush()

    session.propose({ t: 'move', piece: 99999, to: 0 })
    await flush()
    expect(g.rejected).toBe(1)
  })

  it('десинк ловится по хешу и лечится снапшотом', async () => {
    const state = battle(BOARD, { seed: 'net-3' })
    const { host, guestT } = makeHost(state)
    const { g } = makeGuest(guestT)
    await flush()
    await host.announceBattleStart(state)
    await flush()

    // Портим состояние гостя тайком.
    ;(g.state as BattleState).sides[0].paint = 9

    const a = legalActions(state)[0] as Action
    applyMut(state, a)
    host.announce(a, state)
    await flush()

    expect(g.desyncs).toBeGreaterThan(0)
    // После снапшота гость снова бит-в-бит.
    expect(encodeState(g.state as BattleState)).toBe(encodeState(state))
  })

  it('пропуск seq (потерянное сообщение) вызывает ресинк', async () => {
    const state = battle(BOARD, { seed: 'net-4' })
    const { host, guestT } = makeHost(state)
    const { g } = makeGuest(guestT)
    await flush()
    await host.announceBattleStart(state)
    await flush()

    // Симулируем потерю: хост применяет действие, но «сеть съела» announce —
    // увеличиваем seq вручную и шлём следующее.
    const a1 = legalActions(state)[0] as Action
    applyMut(state, a1)
    host.seq++ // потерянное сообщение
    const a2 = legalActions(state)[0] as Action
    applyMut(state, a2)
    host.announce(a2, state)
    await flush()

    expect(g.desyncs).toBeGreaterThan(0)
    expect(encodeState(g.state as BattleState)).toBe(encodeState(state))
  })
})
