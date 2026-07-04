import { describe, expect, it } from 'vitest'
import { battle, act, pieceAtXY } from './helpers'
import { mkSq } from '../../src/engine/types'
import type { Piece } from '../../src/engine/types'

describe('условия победы', () => {
  it('regicide: срубить короля врага = победа', () => {
    const s = battle([
      '.k...',
      '.....',
      '.....',
      '.....',
      '.*...',
    ], { roster: [{ type: 'rook' }] })
    const rook = pieceAtXY(s, 1, 4) as Piece
    act(s, { t: 'move', piece: rook.id, to: mkSq(1, 0) })
    expect(s.result?.winner).toBe(0)
    expect(s.result?.reason).toBe('regicide')
    expect(s.phase).toBe('ended')
  })

  it('гибель нашего короля = поражение в любом сценарии', () => {
    const s = battle([
      '.r.k.',
      '.....',
      '.....',
      '.....',
      '.*...',
    ], { roster: [{ type: 'king' }] })
    act(s, { t: 'endTurn' })
    const rook = pieceAtXY(s, 1, 0) as Piece
    act(s, { t: 'move', piece: rook.id, to: mkSq(1, 4) })
    expect(s.result?.winner).toBe(1)
  })

  it('survive: пережить N ходов', () => {
    const s = battle([
      '.k...',
      'r....',
      '.....',
      '.....',
      '...*.',
    ], { objective: { kind: 'survive', turns: 2 }, roster: [{ type: 'king' }] })
    // turn=1 → нужно turn > 2.
    act(s, { t: 'endTurn' }) // враг
    act(s, { t: 'endTurn' }) // turn=2, наш
    expect(s.result).toBeNull()
    act(s, { t: 'endTurn' }) // враг
    act(s, { t: 'endTurn' }) // turn=3 > 2 → победа
    expect(s.result?.winner).toBe(0)
    expect(s.result?.reason).toBe('survived')
  })

  it('escort: довести фигуру до цели', () => {
    const s = battle([
      '.k...',
      '.....',
      '.....',
      '.....',
      '..*..',
    ], { objective: { kind: 'escort', goalRow: 0 }, roster: [{ type: 'dove' }] })
    const dove = pieceAtXY(s, 2, 4) as Piece
    act(s, { t: 'move', piece: dove.id, to: mkSq(3, 2) })
    act(s, { t: 'endTurn' }); act(s, { t: 'endTurn' })
    act(s, { t: 'move', piece: dove.id, to: mkSq(3, 0) })
    expect(s.result?.winner).toBe(0)
    expect(s.result?.reason).toBe('escorted')
  })
})
