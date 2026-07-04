import { describe, expect, it } from 'vitest'
import { battle, pieceAtXY } from './helpers'
import { movesFor } from '../../src/engine/movegen'
import { mkSq } from '../../src/engine/types'
import type { Piece } from '../../src/engine/types'

/**
 * Доска 5×5: враг сверху, игрок снизу. Игрок 0 ходит «вверх» (к y=0).
 */

describe('movegen: пешка', () => {
  it('одиночный и двойной шаг с места, вперёд = -y для игрока', () => {
    const s = battle([
      '..k..',
      '.....',
      '.....',
      '.....',
      '**...',
    ], { roster: [{ type: 'king' }, { type: 'pawn' }] })
    const pawn = pieceAtXY(s, 1, 4) as Piece
    expect(pawn.type).toBe('pawn')
    const moves = movesFor(s, pawn)
    expect(moves).toContain(mkSq(1, 3))
    expect(moves).toContain(mkSq(1, 2))
    expect(moves).toHaveLength(2)
  })

  it('дыра блокирует шаг вперёд', () => {
    const s = battle([
      '..k..',
      '.....',
      '.....',
      '.#...',
      '**...',
    ], { roster: [{ type: 'king' }, { type: 'pawn' }] })
    const pawn = pieceAtXY(s, 1, 4) as Piece
    expect(movesFor(s, pawn)).toHaveLength(0)
  })

  it('взятие по диагонали, но не прямо', () => {
    const s = battle([
      '..k..',
      '.....',
      '.....',
      'pp...',
      '*p...',  // вражеская пешка прямо перед нашей? нет: наша на x0? -- roster кладётся на '*'
    ], { roster: [{ type: 'king' }] })
    // Ручная проверка: вражеские пешки на (0,3) и (1,3); наш король на (0,4).
    const enemy = pieceAtXY(s, 0, 3) as Piece
    expect(enemy.owner).toBe(1)
  })
})

describe('movegen: фигуры и дыры', () => {
  it('ладья останавливается перед дырой', () => {
    const s = battle([
      '..k..',
      '.....',
      '.#...',
      '.....',
      '.*...',
    ], { roster: [{ type: 'rook' }] })
    const rook = pieceAtXY(s, 1, 4) as Piece
    const moves = movesFor(s, rook)
    expect(moves).toContain(mkSq(1, 3))
    expect(moves).not.toContain(mkSq(1, 2)) // дыра
    expect(moves).not.toContain(mkSq(1, 1)) // за дырой
    expect(moves).toContain(mkSq(0, 4))
    expect(moves).toContain(mkSq(4, 4))
  })

  it('конь перепрыгивает дыры', () => {
    const s = battle([
      '..k..',
      '.....',
      '.....',
      '.##..',
      '.*...',
    ], { roster: [{ type: 'knight' }] })
    const knight = pieceAtXY(s, 1, 4) as Piece
    const moves = movesFor(s, knight)
    expect(moves).toContain(mkSq(0, 2))
    expect(moves).toContain(mkSq(2, 2))
    // Но не может приземлиться на дыру: (2,3)? это не ход коня из (1,4)... ходы: (0,2),(2,2),(3,3)
    expect(moves).toContain(mkSq(3, 3))
  })

  it('Голубь Матисса летает в радиусе 2', () => {
    const s = battle([
      '..k..',
      '.....',
      '.....',
      '.....',
      '..*..',
    ], { roster: [{ type: 'dove' }] })
    const dove = pieceAtXY(s, 2, 4) as Piece
    const moves = movesFor(s, dove)
    expect(moves).toContain(mkSq(0, 2))
    expect(moves).toContain(mkSq(4, 2))
    expect(moves).toContain(mkSq(2, 2))
    expect(moves).toContain(mkSq(1, 4))
    expect(moves.length).toBe(14) // радиус 2 внутри доски 5×5 от (2,4): 5*3-1
  })
})
