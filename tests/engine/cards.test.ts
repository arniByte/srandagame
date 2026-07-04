import { describe, expect, it } from 'vitest'
import { battle, act, pieceAtXY } from './helpers'
import { HOLE, T_PLAIN, mkSq, tileAt } from '../../src/engine/types'
import type { BattleState, Piece } from '../../src/engine/types'
import { findPiece, hasTrait } from '../../src/engine/board'
import { validate } from '../../src/engine/rules'

/** Кладёт нужную карту в руку и возвращает iid. */
function inHand(s: BattleState, def: string): number {
  const card = s.cards.find(c => c.def === def)
  if (!card) throw new Error(`нет карты ${def} в колоде`)
  const side = s.sides[0]
  for (const zone of [side.draw, side.discard] as number[][]) {
    const i = zone.indexOf(card.iid)
    if (i >= 0) { zone.splice(i, 1); side.hand.push(card.iid) }
  }
  s.sides[0].paint = 10
  return card.iid
}

const BOARD = [
  '..k..',
  '.....',
  '..n..',
  '.#...',
  '.*.*.',
]

describe('карты', () => {
  it('Ножницы вырезают пустую клетку, занятую — нельзя', () => {
    const s = battle(BOARD, { deck: ['scissors'] })
    const iid = inHand(s, 'scissors')
    expect(validate(s, { t: 'playCard', iid, targets: [mkSq(2, 2)] }).ok).toBe(false) // конь стоит
    act(s, { t: 'playCard', iid, targets: [mkSq(2, 1)] })
    expect(tileAt(s.board, mkSq(2, 1))).toBe(HOLE)
  })

  it('Клей заклеивает дыру', () => {
    const s = battle(BOARD, { deck: ['glue'] })
    const iid = inHand(s, 'glue')
    act(s, { t: 'playCard', iid, targets: [mkSq(1, 3)] })
    expect(tileAt(s.board, mkSq(1, 3))).toBe(T_PLAIN)
  })

  it('Свежий мазок призывает пешку только на своей половине', () => {
    const s = battle(BOARD, { deck: ['freshStroke'] })
    const iid = inHand(s, 'freshStroke')
    expect(validate(s, { t: 'playCard', iid, targets: [mkSq(2, 1)] }).ok).toBe(false) // чужая половина
    act(s, { t: 'playCard', iid, targets: [mkSq(2, 4)] })
    const p = pieceAtXY(s, 2, 4) as Piece
    expect(p.type).toBe('pawn')
    expect(p.owner).toBe(0)
  })

  it('Оцепенение замораживает и истекает', () => {
    const s = battle(BOARD, { deck: ['stiffen'] })
    const iid = inHand(s, 'stiffen')
    const knight = pieceAtXY(s, 2, 2) as Piece
    act(s, { t: 'playCard', iid, targets: [mkSq(2, 2)] })
    expect(hasTrait(knight, 'frozen')).toBe(true)
    // Враг не может ходить конём.
    act(s, { t: 'endTurn' })
    const v = validate(s, { t: 'move', piece: knight.id, to: mkSq(1, 4) })
    expect(v.ok).toBe(false)
    // Тикает на ходах врага: 2 хода → оттаял.
    act(s, { t: 'endTurn' }); act(s, { t: 'endTurn' })
    act(s, { t: 'endTurn' })
    expect(hasTrait(findPiece(s, knight.id) as Piece, 'frozen')).toBe(false)
  })

  it('Растворитель уничтожает дешёвую фигуру, но не короля', () => {
    const s = battle(BOARD, { deck: ['solvent'] })
    const iid = inHand(s, 'solvent')
    expect(validate(s, { t: 'playCard', iid, targets: [mkSq(2, 0)] }).ok).toBe(false) // король: ценность > 3
    const knight = pieceAtXY(s, 2, 2) as Piece
    act(s, { t: 'playCard', iid, targets: [mkSq(2, 2)] })
    expect(findPiece(s, knight.id)).toBeNull()
  })

  it('Толчок сталкивает врага в дыру — гибель', () => {
    const s = battle([
      '..k..',
      '.....',
      '.n...',
      '.#...',
      '..*..',
    ], { deck: ['shove'] })
    const iid = inHand(s, 'shove')
    const knight = pieceAtXY(s, 1, 2) as Piece
    // Толчок от игрока 0 — «вверх» (к y=0): (1,2) → (1,1) → (1,0). Дыры нет — сдвиг.
    act(s, { t: 'playCard', iid, targets: [mkSq(1, 2)] })
    expect(findPiece(s, knight.id)?.pos).toBe(mkSq(1, 0))
  })

  it('Пируэт меняет свои фигуры местами', () => {
    const s = battle(BOARD, { deck: ['pirouette'], roster: [{ type: 'king' }, { type: 'rook' }] })
    const iid = inHand(s, 'pirouette')
    const a = pieceAtXY(s, 1, 4) as Piece
    const b = pieceAtXY(s, 3, 4) as Piece
    act(s, { t: 'playCard', iid, targets: [mkSq(1, 4), mkSq(3, 4)] })
    expect(a.pos).toBe(mkSq(3, 4))
    expect(b.pos).toBe(mkSq(1, 4))
  })

  it('Палитра даёт краску, Вдохновение — карты', () => {
    const s = battle(BOARD, { deck: ['palette', 'inspiration', 'glue', 'scissors', 'shove'] })
    const iid = inHand(s, 'palette')
    s.sides[0].paint = 0
    act(s, { t: 'playCard', iid, targets: [] })
    expect(s.sides[0].paint).toBe(2)
  })

  it('краски не хватает — карта нелегальна', () => {
    const s = battle(BOARD, { deck: ['solvent'] })
    const iid = inHand(s, 'solvent')
    s.sides[0].paint = 3 // стоит 4
    expect(validate(s, { t: 'playCard', iid, targets: [mkSq(2, 2)] }).ok).toBe(false)
  })
})
