import type { PieceTypeDef } from '../engine/types'

/**
 * Типы фигур. ПОРЯДОК РЕГИСТРАЦИИ ФИКСИРОВАН (индексы Zobrist).
 * Добавлять новые — только в конец списка.
 */

const KNIGHT_LEAPS = [
  [1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2],
] as const

const KING_LEAPS = [
  [0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1],
] as const

const ORTHO = [[0, 1], [1, 0], [0, -1], [-1, 0]] as const
const DIAG = [[1, 1], [1, -1], [-1, -1], [-1, 1]] as const

/** Все клетки в радиусе Чебышёва 2 (перелёт Голубя). */
const DOVE_LEAPS: (readonly [number, number])[] = []
for (let dx = -2; dx <= 2; dx++) {
  for (let dy = -2; dy <= 2; dy++) {
    if (dx !== 0 || dy !== 0) DOVE_LEAPS.push([dx, dy] as const)
  }
}

export const PIECE_TYPES: PieceTypeDef[] = [
  { id: 'pawn', name: 'Пешка', value: 1, paintValue: 1, pawn: true },
  { id: 'knight', name: 'Конь', value: 3, paintValue: 2, leaps: KNIGHT_LEAPS },
  { id: 'bishop', name: 'Слон', value: 3, paintValue: 2, rides: DIAG },
  { id: 'rook', name: 'Ладья', value: 5, paintValue: 3, rides: ORTHO },
  { id: 'queen', name: 'Ферзь', value: 9, paintValue: 4, rides: [...ORTHO, ...DIAG] },
  { id: 'king', name: 'Король', value: 100, paintValue: 5, royal: true, leaps: KING_LEAPS },
  { id: 'gate', name: 'Ворота замка', value: 6, paintValue: 0, immobile: true, hp: 10 },

  // --- Промоушен-мутации (пул драфта пешки).
  {
    id: 'dove', name: 'Голубь Матисса', value: 4, paintValue: 2,
    leaps: DOVE_LEAPS, promo: true,
  },
  {
    id: 'dancer', name: 'Красный Танцор', value: 5, paintValue: 3,
    leaps: [...KNIGHT_LEAPS, ...KING_LEAPS], promo: true,
  },
  {
    id: 'square', name: 'Чёрный Квадрат', value: 2, paintValue: 1,
    immobile: true, promo: true,
  },
  {
    id: 'vine', name: 'Лоза', value: 4, paintValue: 2,
    leaps: [[1, 1], [1, -1], [-1, -1], [-1, 1], [2, 2], [2, -2], [-2, -2], [-2, 2]],
    promo: true,
  },
]
