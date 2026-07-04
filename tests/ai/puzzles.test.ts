import { describe, expect, it } from 'vitest'
import type { Action, BattleState } from '../../src/engine/types'
import { mkSq } from '../../src/engine/types'
import {
  applyMut, encodeState, legalActions, rngInt, seedFromString, validate,
} from '../../src/engine'
import { loadContent } from '../../src/content'
import { WIN, search } from '../../src/ai/search'
import { battle, act } from '../engine/helpers'

loadContent()

/** Тесты детерминированы: фиксированная глубина/узлы, никаких таймеров. */

function ownPiece(st: BattleState, type: string) {
  const p = st.pieces.find(pc => pc.owner === 0 && pc.type === type)
  if (!p) throw new Error(`no own ${type}`)
  return p
}

describe('ai/puzzles', () => {
  it('взятие короля в 1: ладья обязана срубить короля', () => {
    const st = battle([
      'k...',
      '....',
      '*...',
      '...*',
    ], { roster: [{ type: 'rook' }, { type: 'king' }], deck: ['palette'] })
    const rook = ownPiece(st, 'rook')
    const before = encodeState(st)

    const out = search(st, { maxDepth: 3, useCards: false })

    expect(encodeState(st)).toBe(before) // make/unmake вернул состояние
    expect(out.action).toEqual({ t: 'move', piece: rook.id, to: mkSq(0, 0) })
    expect(out.score).toBeGreaterThan(WIN - 64)
  })

  it('не зевает ферзя: защищённая пешка не берётся на глубине 3', () => {
    // Пешка (0,1) защищена ладьёй (0,0); безопасная добыча — пешка (2,2).
    const st = battle([
      'r...k',
      'p....',
      '..p..',
      '.....',
      '*...*',
    ], { roster: [{ type: 'queen' }, { type: 'king' }], deck: ['palette'] })
    const queen = ownPiece(st, 'queen')

    const out = search(st, { maxDepth: 3, useCards: false })

    expect(out.action).not.toBeNull()
    const a = out.action as Action
    // Любое действие, кроме взятия отравленной пешки ферзём.
    if (a.t === 'move' && a.piece === queen.id) {
      expect(a.to).not.toBe(mkSq(0, 1))
    }
  })

  it('осада: добивает ворота немедленно', () => {
    const st = battle([
      '..k..',
      '.....',
      '..G..',
      '..*..',
      '....*',
    ], {
      objective: { kind: 'siege' },
      roster: [{ type: 'rook' }, { type: 'king' }],
      deck: ['palette'],
    })
    const gate = st.pieces.find(p => p.type === 'gate')
    if (!gate) throw new Error('no gate')
    gate.hp = 3 // бамп ладьи (урон 5) сносит ворота
    const rook = ownPiece(st, 'rook')

    const out = search(st, { maxDepth: 2, useCards: false })

    expect(out.action).toEqual({ t: 'move', piece: rook.id, to: gate.pos })
    expect(out.score).toBeGreaterThan(WIN - 64)
  })

  it('в фазе промоушена возвращает promote', () => {
    const st = battle([
      '...k',
      '*...',
      '....',
      '..*.',
    ], { roster: [{ type: 'pawn' }, { type: 'king' }], deck: ['palette'] })
    const pawn = ownPiece(st, 'pawn')
    act(st, { t: 'move', piece: pawn.id, to: mkSq(0, 0) })
    expect(st.phase).toBe('promote')

    const out = search(st, { maxDepth: 2, useCards: false })

    expect(out.action).not.toBeNull()
    expect((out.action as Action).t).toBe('promote')
    expect(validate(st, out.action as Action).ok).toBe(true)
  })

  // --- Фаззинг: случайные позиции сидированным rng движка.

  const FUZZ_BOARD = [
    'r.bqk.',
    '.ppp.p',
    '......',
    '......',
    '.***..',
    '**.**.',
  ]

  function randomPosition(i: number): BattleState | null {
    const st = battle(FUZZ_BOARD, { seed: `fuzz-${i}` })
    const rng = seedFromString(`walk-${i}`)
    const steps = 3 + rngInt(rng, 12)
    for (let s = 0; s < steps; s++) {
      if (st.result) return null
      const acts = legalActions(st)
      if (acts.length === 0) return null
      const a = acts[rngInt(rng, acts.length)] as Action
      applyMut(st, a)
    }
    return st.result ? null : st
  }

  it('всегда возвращает валидное действие на 30 случайных позициях', () => {
    let tested = 0
    for (let i = 0; i < 30; i++) {
      const st = randomPosition(i)
      if (!st) continue
      tested++
      const before = encodeState(st)
      const out = search(st, { maxDepth: 2, useCards: true })
      expect(encodeState(st)).toBe(before)
      expect(out.action).not.toBeNull()
      expect(validate(st, out.action as Action).ok).toBe(true)
    }
    expect(tested).toBeGreaterThanOrEqual(15)
  })

  it('TT не меняет счёт на фиксированной глубине 3', () => {
    let tested = 0
    for (const i of [3, 7, 11]) {
      const st = randomPosition(i)
      if (!st) continue
      tested++
      for (const useCards of [false, true]) {
        const withTT = search(structuredClone(st), { maxDepth: 3, useCards, useTT: true })
        const withoutTT = search(structuredClone(st), { maxDepth: 3, useCards, useTT: false })
        expect(withTT.score).toBe(withoutTT.score)
      }
    }
    expect(tested).toBeGreaterThanOrEqual(1)
  })
})
