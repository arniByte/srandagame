import { describe, expect, it } from 'vitest'
import { battle } from '../engine/helpers'
import { applyMut, unmake, apply } from '../../src/engine/reducer'
import { legalActions } from '../../src/engine/rules'
import { encodeState, hashState } from '../../src/engine/serialize'
import { seedFromString, rngInt } from '../../src/engine/rng'
import type { Action, BattleState } from '../../src/engine/types'

/**
 * Главный тест движка: случайные партии.
 * 1) applyMut + unmake восстанавливает состояние байт-в-байт.
 * 2) apply (чистый) и applyMut дают идентичный результат.
 * 3) Одинаковый сид + одинаковые действия → одинаковый финальный хеш.
 * 4) Инварианты: фигуры не на дырах, краска в границах, pieces отсортированы.
 */

const BOARDS: string[][] = [
  [
    '.nbknb.',
    'ppppppp',
    '.......',
    '...#...',
    '.......',
    '*******',
    '*******',
  ],
  [
    '..s.G.s.',
    '.n.ss.n.',
    'p.p..p.p',
    '........',
    '...##...',
    '........',
    '********',
    '********',
  ],
]

function randomPlayout(seed: string, boardIdx: number, plies: number): BattleState {
  const s = battle(BOARDS[boardIdx] as string[], {
    seed,
    objective: boardIdx === 1 ? { kind: 'siege' } : { kind: 'regicide' },
    curatorPeriod: boardIdx === 0 ? 3 : undefined,
    enemyDeck: boardIdx === 1 ? ['stiffen', 'shove', 'palette'] : undefined,
  })
  const rng = seedFromString(seed + ':chooser')

  for (let i = 0; i < plies && !s.result; i++) {
    const actions = legalActions(s)
    expect(actions.length).toBeGreaterThan(0)
    const action = actions[rngInt(rng, actions.length)] as Action

    // make/unmake симметрия на каждом шаге.
    const before = encodeState(s)
    const undo = applyMut(s, action)
    unmake(s, undo)
    const restored = encodeState(s)
    expect(restored).toBe(before)

    // Эквивалентность apply и applyMut.
    const pure = apply(s, action)
    applyMut(s, action)
    expect(encodeState(pure.state)).toBe(encodeState(s))

    // Инварианты.
    for (const p of s.pieces) {
      const x = p.pos & 15, y = p.pos >> 4
      expect(x).toBeLessThan(s.board.w)
      expect(y).toBeLessThan(s.board.h)
      expect(s.board.tiles[y * s.board.w + x]).not.toBe(-1)
    }
    for (const side of s.sides) {
      expect(side.paint).toBeGreaterThanOrEqual(0)
      expect(side.paint).toBeLessThanOrEqual(side.paintMax)
    }
    for (let k = 1; k < s.pieces.length; k++) {
      expect((s.pieces[k]!).id).toBeGreaterThan((s.pieces[k - 1]!).id)
    }
  }
  return s
}

describe('детерминизм и make/unmake', () => {
  it('случайные партии: симметрия отката и инварианты (40 сидов)', () => {
    for (let seedN = 0; seedN < 40; seedN++) {
      randomPlayout(`fuzz-${seedN}`, seedN % 2, 60)
    }
  })

  it('одинаковый сид → одинаковый итоговый хеш', () => {
    const a = randomPlayout('replay-check', 0, 80)
    const b = randomPlayout('replay-check', 0, 80)
    expect(hashState(a)).toBe(hashState(b))
  })

  it('разные сиды → разные партии', () => {
    const a = randomPlayout('seed-a', 0, 40)
    const b = randomPlayout('seed-b', 0, 40)
    expect(hashState(a)).not.toBe(hashState(b))
  })
})
