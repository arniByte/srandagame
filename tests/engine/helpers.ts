import type { Action, BattleState, EncounterDef, EngineEvent } from '../../src/engine/types'
import { newBattle } from '../../src/engine/setup'
import { applyMut } from '../../src/engine/reducer'
import { validate } from '../../src/engine/rules'
import { loadContent, STARTER_DECK, STARTER_ROSTER } from '../../src/content'

loadContent()

export function enc(partial: Partial<EncounterDef> & { board: string[] }): EncounterDef {
  return {
    id: 'test', name: 'test',
    objective: { kind: 'regicide' },
    aiTier: 'apprentice',
    gold: [0, 0],
    ...partial,
  }
}

export function battle(
  board: string[],
  opts: {
    objective?: EncounterDef['objective']
    roster?: { type: string }[]
    deck?: string[]
    relics?: string[]
    seed?: string
    curatorPeriod?: number
    enemyDeck?: string[]
  } = {},
): BattleState {
  const roster = (opts.roster ?? STARTER_ROSTER).map((r, i) => ({
    rid: `r${i}`, type: r.type, traits: [],
  }))
  const deck = (opts.deck ?? STARTER_DECK).map(def => ({ def, upgraded: false }))
  return newBattle({
    encounter: enc({
      board,
      objective: opts.objective ?? { kind: 'regicide' },
      curatorPeriod: opts.curatorPeriod,
      enemyDeck: opts.enemyDeck,
    }),
    roster,
    deck,
    relics: opts.relics ?? [],
    seed: opts.seed ?? 'test-seed',
  })
}

/** Применить действие с проверкой валидности; вернуть события. */
export function act(state: BattleState, action: Action): EngineEvent[] {
  const v = validate(state, action)
  if (!v.ok) throw new Error(`invalid action ${JSON.stringify(action)}: ${v.reason}`)
  const events: EngineEvent[] = []
  applyMut(state, action, events)
  return events
}

export function pieceAtXY(state: BattleState, x: number, y: number) {
  const sq = x + y * 16
  return state.pieces.find(p => p.pos === sq) ?? null
}
