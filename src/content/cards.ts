import type { CardDef } from '../engine/types'

/**
 * Карты. Порядок регистрации фиксирован (Zobrist).
 * M1-набор; M2 расширяет до 25+.
 */
export const CARDS: CardDef[] = [
  {
    id: 'scissors', name: 'Ножницы', desc: 'Вырезать пустую клетку из доски.',
    cost: 2, rarity: 'common', illus: 'card.illus.scissors',
    target: { kind: 'tile', tile: 'empty' },
    effects: [{ op: 'cutTile' }],
    aiHint: { weight: 3, cat: 'terrain' },
  },
  {
    id: 'glue', name: 'Клей', desc: 'Приклеить бумажную клетку на дыру.',
    cost: 1, rarity: 'common', illus: 'card.illus.glue',
    target: { kind: 'tile', tile: 'hole' },
    effects: [{ op: 'glueTile' }],
    aiHint: { weight: 2, cat: 'terrain' },
  },
  {
    id: 'freshStroke', name: 'Свежий мазок', desc: 'Призвать пешку на своей половине.',
    cost: 3, rarity: 'common', illus: 'card.illus.freshStroke',
    target: { kind: 'tile', tile: 'empty', ownHalf: true },
    effects: [{ op: 'summon', pieceType: 'pawn' }],
    aiHint: { weight: 4, cat: 'summon' },
  },
  {
    id: 'stiffen', name: 'Оцепенение', desc: 'Заморозить фигуру врага на 2 хода.',
    cost: 2, rarity: 'uncommon', illus: 'card.illus.stiffen',
    target: { kind: 'piece', side: 'enemy' },
    effects: [{ op: 'addTrait', trait: 'frozen', turns: 2 }],
    aiHint: { weight: 5, cat: 'removal' },
  },
  {
    id: 'solvent', name: 'Растворитель', desc: 'Растворить фигуру врага ценностью до 3.',
    cost: 5, rarity: 'rare', illus: 'card.illus.solvent',
    target: { kind: 'piece', side: 'enemy', maxValue: 3 },
    effects: [{ op: 'destroy' }],
    aiHint: { weight: 7, cat: 'removal' },
  },
  {
    id: 'pirouette', name: 'Пируэт', desc: 'Поменять местами две свои фигуры.',
    cost: 1, rarity: 'common', illus: 'card.illus.pirouette',
    target: { kind: 'twoPieces', side: 'ally' },
    effects: [{ op: 'swap' }],
    aiHint: { weight: 2, cat: 'buff' },
  },
  {
    id: 'inspiration', name: 'Вдохновение', desc: 'Взять 2 карты.',
    cost: 2, rarity: 'common', illus: 'card.illus.inspiration',
    target: { kind: 'none' },
    effects: [{ op: 'draw', n: 2 }],
    aiHint: { weight: 2, cat: 'economy' },
  },
  {
    id: 'palette', name: 'Палитра', desc: 'Получить 2 краски.',
    cost: 0, rarity: 'common', illus: 'card.illus.palette',
    target: { kind: 'none' },
    effects: [{ op: 'gainPaint', n: 2 }],
    aiHint: { weight: 1, cat: 'economy' },
  },
  {
    id: 'shove', name: 'Толчок', desc: 'Оттолкнуть фигуру врага на 2 клетки. В дыру — насовсем.',
    cost: 1, rarity: 'uncommon', illus: 'card.illus.shove',
    target: { kind: 'piece', side: 'enemy' },
    effects: [{ op: 'push', dist: 2 }],
    aiHint: { weight: 4, cat: 'removal' },
  },
  {
    id: 'gust', name: 'Порыв', desc: 'Своя фигура 3 хода дополнительно ходит как король.',
    cost: 2, rarity: 'uncommon', illus: 'card.illus.gust',
    target: { kind: 'piece', side: 'ally' },
    effects: [{ op: 'addTrait', trait: 'swift', turns: 3 }],
    aiHint: { weight: 3, cat: 'buff' },
  },
]
