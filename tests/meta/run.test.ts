import { describe, expect, it } from 'vitest'
import { loadContent } from '../../src/content'
import {
  newRun, chooseNode, availableNodes, startBattle, appendBattleAction,
  finishBattle, buyCard, removeCard, trainPiece, upgradeCard, buyRecruit,
} from '../../src/meta/runState'
import { rollBattleReward, rollShop } from '../../src/meta/rewards'
import { EVENTS } from '../../src/meta/events'

loadContent()

describe('состояние забега', () => {
  it('newRun валиден и детерминирован', () => {
    const a = newRun('run-seed')
    const b = newRun('run-seed')
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    expect(a.roster.length).toBeGreaterThan(0)
    expect(a.roster.some(r => r.type === 'king')).toBe(true)
    expect(a.deck.length).toBeGreaterThan(0)
    expect(a.map.length).toBeGreaterThan(20)
  })

  it('навигация: старт → ряд 0, дальше по рёбрам; недостижимые запрещены', () => {
    let run = newRun('nav')
    const starts = availableNodes(run)
    expect(starts.every(n => n.row === 0)).toBe(true)
    run = chooseNode(run, (starts[0]!).id)
    expect(run.nodeId).toBe((starts[0]!).id)
    const nexts = availableNodes(run)
    expect(nexts.every(n => n.row === 1)).toBe(true)
    expect(() => chooseNode(run, 'n12-3')).toThrow()
  })

  it('бой: сид фиксируется, лог копится, погибшие покидают ростер, промоушен сохраняется', () => {
    let run = newRun('battle-flow')
    const start = (availableNodes(run)[0]!)
    run = chooseNode(run, start.id)
    run = startBattle(run, start.encounterId as string)
    expect(run.inBattle).not.toBeNull()
    run = appendBattleAction(run, { t: 'endTurn' })
    expect(run.inBattle?.log).toHaveLength(1)

    // Выжили король и одна пешка, ставшая Танцором; остальные погибли.
    const king = run.roster.find(r => r.type === 'king')!
    const pawn = run.roster.find(r => r.type === 'pawn')!
    run = finishBattle(run, [
      { rid: king.rid, type: 'king', traits: [] },
      { rid: pawn.rid, type: 'dancer', traits: ['thirsty'] },
    ], true, 25)

    expect(run.roster).toHaveLength(2)
    expect(run.roster.find(r => r.rid === pawn.rid)?.type).toBe('dancer')
    expect(run.roster.find(r => r.rid === pawn.rid)?.traits).toContain('thirsty')
    expect(run.gold).toBe(60 + 25)
    expect(run.inBattle).toBeNull()
    expect(run.history.at(-1)?.outcome).toBe('win')
  })

  it('лавка и колода: покупка/удаление/апгрейд/рекрут', () => {
    let run = newRun('shop')
    const deckSize = run.deck.length
    run = buyCard(run, 'solvent', 50)
    expect(run.deck.length).toBe(deckSize + 1)
    expect(run.gold).toBe(10)
    expect(() => buyCard(run, 'solvent', 50)).toThrow()
    run = { ...run, gold: 200 }
    run = removeCard(run, 0, 75)
    expect(run.deck.length).toBe(deckSize)
    run = upgradeCard(run, 0)
    expect((run.deck[0]!).upgraded).toBe(true)
    const rosterSize = run.roster.length
    run = buyRecruit(run, 'knight', 90, 'Тестовый конь')
    expect(run.roster.length).toBe(rosterSize + 1)
  })

  it('тренировка фигуры добавляет черту', () => {
    let run = newRun('train')
    const rid = (run.roster[0]!).rid
    run = trainPiece(run, rid, 'anchor')
    expect(run.roster.find(r => r.rid === rid)?.traits).toContain('anchor')
  })

  it('награды и лавка детерминированы от rng забега', () => {
    const r1 = newRun('rewards')
    const r2 = newRun('rewards')
    const a = rollBattleReward(r1, 'a1-skirmish-pawns')
    const b = rollBattleReward(r2, 'a1-skirmish-pawns')
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    expect(a.cardChoices).toHaveLength(3)
    const s1 = rollShop(r1)
    expect(s1.cards).toHaveLength(5)
    expect(s1.removalPrice).toBe(75)
  })

  it('события: apply чисты и не ломают RunState', () => {
    const run = newRun('events')
    for (const ev of EVENTS) {
      for (const choice of ev.choices) {
        if (choice.condition && !choice.condition(run)) continue
        const next = choice.apply(run)
        expect(next.v).toBe(1)
        expect(next.roster.length).toBeGreaterThan(0)
        // Исходный run не изменён (чистота).
        expect(run.gold).toBe(60)
      }
    }
  })

  it('RunState переживает JSON туда-обратно', () => {
    const run = newRun('json')
    const back = JSON.parse(JSON.stringify(run))
    expect(JSON.stringify(back)).toBe(JSON.stringify(run))
  })
})
