import { Container, Graphics, Rectangle, Texture, type Renderer } from 'pixi.js'
import { cardDef } from '../engine'
import { FACTION, PAL, type FactionColors, type FactionKey } from './palette'
import { edgeSeed, tornCircle, tornPoly, tornRect } from './paperEdge'

/**
 * КОДОВЫЕ плейсхолдеры в духе Матисса/Малевича: каждая фигура — узнаваемая
 * композиция из 2-4 плоских «вырезанных из бумаги» форм с рваными краями
 * и лёгким смещением слоёв. Рендерится в RenderTexture 2x, кэш по ключу.
 */

let renderer: Renderer | null = null
const cache = new Map<string, Texture>()

export function initPlaceholders(r: Renderer): void {
  renderer = r
}

/** Дизайн-боксы текстур (для якорей спрайтов). */
export const PIECE_TEX = { w: 112, h: 144, anchorX: 0.5, anchorY: 0.95 } as const
export const TILE_TEX = { size: 68 } as const
export const CARD_TEX = { w: 132, h: 184 } as const
export const ILLUS_TEX = { w: 104, h: 76 } as const

// ---------------------------------------------------------------------------
// Примитивы

/** Плоская «бумажная» форма: рваный полигон + цвет + смещение слоя. */
function paperShape(
  g: Graphics, pts: number[], color: number,
  dx = 0, dy = 0, alpha = 1,
): void {
  const moved: number[] = []
  for (let i = 0; i < pts.length; i += 2) {
    moved.push((pts[i] ?? 0) + dx, (pts[i + 1] ?? 0) + dy)
  }
  g.poly(moved).fill({ color, alpha })
}

/** Изогнутая полоса-дуга (для росчерков Матисса). */
function arcBand(
  cx: number, cy: number, r: number, halfW: number,
  a0: number, a1: number, n = 14,
): number[] {
  const out: number[] = []
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n
    out.push(cx + Math.cos(a) * (r + halfW), cy + Math.sin(a) * (r + halfW))
  }
  for (let i = n; i >= 0; i--) {
    const a = a0 + ((a1 - a0) * i) / n
    out.push(cx + Math.cos(a) * (r - halfW), cy + Math.sin(a) * (r - halfW))
  }
  return out
}

/** Серп (крыло голубя): внешняя дуга + внутренняя со сдвинутым центром. */
function crescent(
  cx: number, cy: number, r: number, innerR: number,
  ox: number, oy: number, a0: number, a1: number, n = 16,
): number[] {
  const out: number[] = []
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n
    out.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r)
  }
  for (let i = n; i >= 0; i--) {
    const a = a0 + ((a1 - a0) * i) / n
    out.push(cx + ox + Math.cos(a) * innerR, cy + oy + Math.sin(a) * innerR)
  }
  return out
}

const rectPts = (cx: number, cy: number, w: number, h: number): number[] => [
  cx - w / 2, cy - h / 2, cx + w / 2, cy - h / 2,
  cx + w / 2, cy + h / 2, cx - w / 2, cy + h / 2,
]

const triPts = (x0: number, y0: number, x1: number, y1: number, x2: number, y2: number): number[] =>
  [x0, y0, x1, y1, x2, y2]

// ---------------------------------------------------------------------------
// Композиции фигур. Система координат: (0,0) — точка опоры (низ), y вверх — отрицательный.

type PieceDrawFn = (g: Graphics, p: FactionColors, s: number) => void

const PIECE_DRAW: Record<string, PieceDrawFn> = {
  // Пешка: малый круг на прямоугольнике.
  pawn(g, p, s) {
    paperShape(g, tornPoly(rectPts(0, -26, 30, 52), s + 1), p.primary)
    paperShape(g, tornCircle(17, s + 2), p.secondary, 2, -62)
  },

  // Конь: чёрный четырёхугольник с красным клином-мордой.
  knight(g, p, s) {
    const quad = [-20, 0, 24, 0, 16, -92, -28, -66]
    paperShape(g, tornPoly(quad, s + 1), p.primary)
    paperShape(g, tornPoly(triPts(6, -88, 44, -70, 10, -56), s + 2), p.secondary, 2, 1)
    paperShape(g, tornCircle(4, s + 3), p.accent, -6, -76)
  },

  // Слон: вытянутый треугольник с кругом.
  bishop(g, p, s) {
    paperShape(g, tornPoly(triPts(-24, 0, 24, 0, 2, -104), s + 1), p.primary)
    paperShape(g, tornCircle(12, s + 2), p.secondary, 4, -76)
  },

  // Ладья: три сложенных бруска.
  rook(g, p, s) {
    paperShape(g, tornPoly(rectPts(0, -14, 60, 26), s + 1), p.primary)
    paperShape(g, tornPoly(rectPts(-3, -42, 52, 24), s + 2), p.primary, 0, 0)
    paperShape(g, tornPoly(rectPts(2, -70, 58, 24), s + 3), p.secondary)
  },

  // Ферзь: высокий силуэт с зубцами-лучами.
  queen(g, p, s) {
    paperShape(g, tornPoly([-18, 0, 18, 0, 12, -96, -12, -96], s + 1), p.primary)
    for (let i = 0; i < 4; i++) {
      const a = -Math.PI / 2 + (i - 1.5) * 0.5
      const x0 = 12 * Math.cos(a), y0 = -96 + 12 * Math.sin(a)
      const x1 = 34 * Math.cos(a), y1 = -96 + 34 * Math.sin(a)
      paperShape(g, tornPoly([x0 - 5, y0, x0 + 5, y0, x1, y1], s + 2 + i, { amp: 1.2, step: 5 }), p.secondary)
    }
    paperShape(g, tornCircle(8, s + 9), p.accent, 0, -60)
  },

  // Король: крест + золотой круг (королевская отметина).
  king(g, p, s) {
    paperShape(g, tornPoly(rectPts(0, -46, 24, 92), s + 1), p.primary)
    paperShape(g, tornPoly(rectPts(0, -64, 62, 20), s + 2), p.primary, 2, 0)
    paperShape(g, tornCircle(15, s + 3), PAL.ochre, 1, -100)
  },

  // Ворота: арка из брусков.
  gate(g, p, s) {
    paperShape(g, tornPoly(rectPts(-30, -32, 20, 64), s + 1), p.primary)
    paperShape(g, tornPoly(rectPts(30, -32, 20, 64), s + 2), p.primary)
    paperShape(g, tornPoly(rectPts(0, -70, 92, 20), s + 3), p.secondary, 0, 0)
    paperShape(g, tornPoly(rectPts(0, -86, 56, 12), s + 4), p.primary, 3, 0)
  },

  // Голубь Матисса: белая птица-росчерк из двух серпов.
  dove(g, p, s) {
    // Тело-серп.
    paperShape(g, tornPoly(crescent(-2, -46, 40, 30, 6, -12, Math.PI * 0.15, Math.PI * 1.05), s + 1, { amp: 1.4 }), p.accent)
    // Крыло-серп вверх.
    paperShape(g, tornPoly(crescent(8, -56, 34, 24, -8, 10, -Math.PI * 0.85, -Math.PI * 0.05), s + 2, { amp: 1.4 }), p.accent, 4, -6)
    // Глаз.
    paperShape(g, tornCircle(3.4, s + 3), p.primary, -30, -58)
  },

  // Красный Танцор: пляшущая фигура из дуг.
  dancer(g, p, s) {
    paperShape(g, tornPoly(arcBand(-8, -46, 30, 8, -Math.PI * 0.15, Math.PI * 0.6), s + 1, { amp: 1.4 }), p.primary)      // торс
    paperShape(g, tornPoly(arcBand(16, -14, 24, 7, Math.PI * 0.55, Math.PI * 1.2), s + 2, { amp: 1.4 }), p.primary)       // нога
    paperShape(g, tornPoly(arcBand(-12, -78, 26, 6, -Math.PI * 0.9, -Math.PI * 0.1), s + 3, { amp: 1.2 }), p.secondary)   // руки
    paperShape(g, tornCircle(10, s + 4), p.primary, 14, -92)                                                              // голова
  },

  // Чёрный Квадрат. Просто чёрный квадрат (!) — с бумажной подложкой фракции.
  square(g, p, s) {
    paperShape(g, tornPoly(rectPts(0, -36, 62, 62), s + 1), p.secondary, 4, 4, 0.85)
    paperShape(g, tornPoly(rectPts(0, -36, 62, 62), s + 2), PAL.ink)
  },

  // Лоза: зелёный зигзаг с листьями.
  vine(g, p, s) {
    const zig = [
      -26, 0, -6, -30, -22, -56, 0, -88, 14, -66, -2, -42, 18, -12, 2, 0,
    ]
    paperShape(g, tornPoly(zig, s + 1, { amp: 1.6, step: 6 }), PAL.green)
    paperShape(g, tornCircle(8, s + 2), PAL.green, 18, -84)
    paperShape(g, tornCircle(6, s + 3), p.secondary, -24, -50)
  },
}

/** Неизвестный тип: узнаваемая «заглушка-вырезка». */
function drawUnknownPiece(g: Graphics, p: FactionColors, s: number): void {
  paperShape(g, tornPoly(rectPts(0, -40, 44, 80), s + 1), p.primary)
  paperShape(g, tornCircle(10, s + 2), p.accent, 0, -40)
}

// ---------------------------------------------------------------------------
// Иллюстрации карт по категории

type IllusFn = (g: Graphics, s: number) => void

const ILLUS_DRAW: Record<string, IllusFn> = {
  // Террейн: ножницы/угол.
  terrain(g, s) {
    paperShape(g, tornPoly(triPts(-40, 26, -30, 18, 34, -20), s + 1, { amp: 1.2 }), PAL.ink)
    paperShape(g, tornPoly(triPts(-40, -26, -30, -18, 34, 20), s + 2, { amp: 1.2 }), PAL.ink)
    paperShape(g, tornCircle(7, s + 3), PAL.vermilion, -36, 24)
    paperShape(g, tornCircle(7, s + 4), PAL.vermilion, -36, -24)
  },
  // Ремувал: клякса.
  removal(g, s) {
    paperShape(g, tornCircle(22, s + 1, { amp: 6 }), PAL.ink, 0, 0)
    paperShape(g, tornCircle(6, s + 2), PAL.ink, 26, -14)
    paperShape(g, tornCircle(4, s + 3), PAL.vermilion, -28, 12)
  },
  // Призыв: мазок кисти.
  summon(g, s) {
    paperShape(g, tornPoly([-42, 18, -34, 6, 38, -22, 44, -8, -24, 26], s + 1, { amp: 2 }), PAL.vermilion)
    paperShape(g, tornCircle(5, s + 2), PAL.ochre, 40, -18)
  },
  // Бафф: спираль.
  buff(g, s) {
    for (let i = 0; i < 3; i++) {
      const r = 8 + i * 8
      paperShape(
        g,
        tornPoly(arcBand(0, 0, r, 3, i * 1.8, i * 1.8 + Math.PI * 1.35), s + 1 + i, { amp: 0.8, step: 5 }),
        i === 1 ? PAL.blue : PAL.ink,
      )
    }
  },
  // Экономика: палитра с каплями краски.
  economy(g, s) {
    paperShape(g, tornCircle(26, s + 1, { amp: 3 }), 0xe8dfc8)
    paperShape(g, tornCircle(6, s + 2), PAL.vermilion, -10, -8)
    paperShape(g, tornCircle(6, s + 3), PAL.blue, 10, -4)
    paperShape(g, tornCircle(6, s + 4), PAL.green, 0, 12)
  },
}

// ---------------------------------------------------------------------------
// Сборка текстур

function makeTexture(build: (g: Graphics) => void, frame: Rectangle): Texture {
  if (!renderer) return Texture.WHITE
  const root = new Container()
  const g = new Graphics()
  root.addChild(g)
  build(g)
  const tex = renderer.generateTexture({
    target: root,
    frame,
    resolution: 2,
    antialias: true,
  })
  root.destroy({ children: true })
  return tex
}

function pieceTexture(faction: FactionKey, type: string): Texture {
  const p = FACTION[faction]
  const s = edgeSeed(`piece.${faction}.${type}`)
  const draw = PIECE_DRAW[type]
  return makeTexture(g => {
    if (draw) draw(g, p, s)
    else drawUnknownPiece(g, p, s)
  }, new Rectangle(-PIECE_TEX.w / 2, -(PIECE_TEX.h - 8), PIECE_TEX.w, PIECE_TEX.h))
}

function tileTexture(variant: string): Texture {
  const light = variant !== 'dark'
  const s = edgeSeed(`tile.${variant}`)
  const size = 60
  return makeTexture(g => {
    // «Приклеенная» тень — тёмная бумага, чуть съехавшая вниз-вправо.
    paperShape(g, tornRect(size, size, s + 1, { amp: 1.6 }), PAL.bg, 2.5, 3, 0.35)
    paperShape(g, tornRect(size, size, s + 2, { amp: 1.6 }), light ? PAL.paper : 0xe6dcc3)
  }, new Rectangle(-TILE_TEX.size / 2, -TILE_TEX.size / 2, TILE_TEX.size, TILE_TEX.size))
}

const RARITY_EDGE: Record<string, number> = {
  common: 0x8f887a, uncommon: PAL.blue, rare: PAL.ochre,
}

function cardFrameTexture(rarity: string): Texture {
  const s = edgeSeed(`card.frame.${rarity}`)
  const edge = RARITY_EDGE[rarity] ?? 0x8f887a
  const { w, h } = CARD_TEX
  return makeTexture(g => {
    // Подложка-обводка редкости торчит из-под бумаги.
    paperShape(g, tornRect(w, h, s + 1, { amp: 2.2 }), edge, 0, 0)
    paperShape(g, tornRect(w - 7, h - 7, s + 2, { amp: 2 }), PAL.paper)
    // Плашка иллюстрации.
    paperShape(g, tornRect(w - 24, 78, s + 3, { amp: 1.5 }), 0xefe6d0, 0, -34)
  }, new Rectangle(-w / 2 - 4, -h / 2 - 4, w + 8, h + 8))
}

function cardIllusTexture(cardId: string): Texture {
  let cat = 'buff'
  try {
    cat = cardDef(cardId).aiHint.cat
  } catch { /* карта не зарегистрирована — рисуем по умолчанию */ }
  const s = edgeSeed(`card.illus.${cardId}`)
  const draw = ILLUS_DRAW[cat] ?? (ILLUS_DRAW['buff'] as IllusFn)
  return makeTexture(g => draw(g, s),
    new Rectangle(-ILLUS_TEX.w / 2, -ILLUS_TEX.h / 2, ILLUS_TEX.w, ILLUS_TEX.h))
}

function uiTexture(name: string): Texture {
  const s = edgeSeed(`ui.${name}`)
  switch (name) {
    case 'paintDrop':
      // Капля краски: круг + хвостик.
      return makeTexture(g => {
        paperShape(g, tornCircle(11, s + 1, { amp: 1 }), PAL.vermilion, 0, 3)
        paperShape(g, tornPoly(triPts(-3, -6, 3, -6, 0, -15), s + 2, { amp: 0.6, step: 3 }), PAL.vermilion)
      }, new Rectangle(-16, -18, 32, 34))
    case 'shadow':
      // Мягкий блоб-тень фигуры.
      return makeTexture(g => {
        g.ellipse(0, 0, 26, 11).fill({ color: PAL.bg, alpha: 0.28 })
        g.ellipse(0, 0, 18, 7).fill({ color: PAL.bg, alpha: 0.3 })
      }, new Rectangle(-28, -13, 56, 26))
    case 'moveDot':
      // Капля-кружок легального хода.
      return makeTexture(g => {
        paperShape(g, tornCircle(9, s + 1, { amp: 1.2 }), PAL.green)
      }, new Rectangle(-12, -12, 24, 24))
    default:
      return makeTexture(g => {
        paperShape(g, tornRect(28, 28, s + 1), 0x8f887a)
      }, new Rectangle(-16, -16, 32, 32))
  }
}

/**
 * Плейсхолдер по ключу ассета:
 *   piece.{vermilion|ink}.{type} | tile.{light|dark} |
 *   card.frame.{rarity} | card.illus.{cardId} | ui.{name}
 */
export function placeholderTexture(key: string): Texture {
  const hit = cache.get(key)
  if (hit) return hit

  const parts = key.split('.')
  let tex: Texture
  if (parts[0] === 'piece' && (parts[1] === 'vermilion' || parts[1] === 'ink')) {
    tex = pieceTexture(parts[1], parts[2] ?? 'pawn')
  } else if (parts[0] === 'tile') {
    tex = tileTexture(parts[1] ?? 'light')
  } else if (parts[0] === 'card' && parts[1] === 'frame') {
    tex = cardFrameTexture(parts[2] ?? 'common')
  } else if (parts[0] === 'card' && parts[1] === 'illus') {
    tex = cardIllusTexture(parts.slice(2).join('.'))
  } else if (parts[0] === 'ui') {
    tex = uiTexture(parts.slice(1).join('.'))
  } else {
    tex = uiTexture('unknown')
  }

  if (tex !== Texture.WHITE) cache.set(key, tex)
  return tex
}
