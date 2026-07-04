import { Container, Graphics, Rectangle, Sprite } from 'pixi.js'
import type { BattleState, Sq } from '../../engine/types'
import { HOLE, mkSq, sqX, sqY, tileAt } from '../../engine/types'
import { assets } from '../../assets/manifest'
import { PAL } from '../../assets/palette'
import { ticker, TICK } from '../../core/ticker'
import { tornPoly } from '../../assets/paperEdge'
import { SM_HZ, visualRng } from '../anim/stopmotion'
import { killTweensOf, tween, wait } from '../anim/tween'
import { cellAt, scaleAt, sqToXY, xyToSq, type Projection } from './projection'

/** Дизайн-размер тайла в текстуре (см. placeholders.tileTexture). */
const TILE_DESIGN = 60

/**
 * Вид доски: бумажные тайлы (дыры = отсутствие тайла, сквозь них видна
 * диорама), подсветки ходов/целей, анимации cut/glue и сдвиг ряда Куратором.
 */
export class BoardView {
  container = new Container()
  /** Клик по клетке (сюда роутится ВЕСЬ ввод по доске). */
  onTileClick: ((sq: Sq) => void) | null = null

  private tilesLayer = new Container()
  private hintsLayer = new Container()
  private tiles = new Map<Sq, Sprite>()
  private proj: Projection | null = null

  private selectedG = new Graphics()
  private moveDots = new Container()
  private targetFrames = new Container()
  private firstMarkG = new Graphics()
  private telegraphG = new Graphics()

  private pulseT = 0
  private lastBreathStep = -1
  private offTick: () => void

  constructor() {
    this.container.addChild(this.tilesLayer, this.hintsLayer)
    this.hintsLayer.addChild(this.telegraphG, this.selectedG, this.moveDots, this.targetFrames, this.firstMarkG)

    this.container.eventMode = 'static'
    this.container.on('pointertap', (e) => {
      if (!this.proj || !this.onTileClick) return
      const local = e.getLocalPosition(this.tilesLayer)
      const sq = xyToSq(this.proj, local.x, local.y)
      if (sq !== -1) this.onTileClick(sq)
    })

    // Пульс рамок-целей — плавный (это UI-подсветка, не стоп-моушен).
    this.offTick = ticker.add((dt) => {
      this.pulseT += dt
      const a = 0.55 + 0.35 * Math.sin(this.pulseT * 6)
      this.targetFrames.alpha = a
      this.firstMarkG.alpha = 0.7 + 0.3 * Math.sin(this.pulseT * 8)

      // Дыхание бумаги: едва заметное степпед-покачивание тайлов (3 шага/с),
      // у каждого своя фаза — коллаж «живёт», но не ёрзает.
      const step = Math.floor(this.pulseT * 3)
      if (step !== this.lastBreathStep) {
        this.lastBreathStep = step
        for (const [sq, sp] of this.tiles) {
          const base = (visualRng(sq + 7)() * 2 - 1) * 0.02
          const phase = (sq * 0.61) % 6.28
          sp.rotation = base + Math.sin(step * 0.7 + phase) * 0.006
        }
      }
    }, TICK.TWEEN)
  }

  // -------------------------------------------------------------------------

  /** Полная пересборка тайлов по состоянию. */
  build(state: BattleState, proj: Projection): void {
    this.proj = proj
    for (const sp of this.tiles.values()) { killTweensOf(sp); sp.destroy() }
    this.tiles.clear()
    const b = state.board
    for (let y = 0; y < b.h; y++) {
      for (let x = 0; x < b.w; x++) {
        const sq = mkSq(x, y)
        if (tileAt(b, sq) !== HOLE) this.addTile(sq)
      }
    }
    this.container.hitArea = new Rectangle(
      proj.cx - (proj.bw * proj.cell) / 2, proj.rowTop[0] ?? 0,
      proj.bw * proj.cell,
      (proj.rowBottom[proj.bh - 1] ?? 0) - (proj.rowTop[0] ?? 0),
    )
  }

  setProjection(proj: Projection, state: BattleState): void {
    this.build(state, proj)
  }

  getProjection(): Projection | null {
    return this.proj
  }

  /** Добавить/убрать тайлы после изменений террейна (без анимаций). */
  syncTiles(state: BattleState): void {
    if (!this.proj) return
    const b = state.board
    for (let y = 0; y < b.h; y++) {
      for (let x = 0; x < b.w; x++) {
        const sq = mkSq(x, y)
        const hole = tileAt(b, sq) === HOLE
        const has = this.tiles.has(sq)
        if (hole && has) {
          const sp = this.tiles.get(sq) as Sprite
          killTweensOf(sp)
          sp.destroy()
          this.tiles.delete(sq)
        } else if (!hole && !has) {
          this.addTile(sq)
        }
      }
    }
  }

  private addTile(sq: Sq): Sprite {
    const p = this.proj as Projection
    const light = (sqX(sq) + sqY(sq)) % 2 === 0
    const sp = new Sprite(assets.texture(light ? 'tile.light' : 'tile.dark'))
    sp.anchor.set(0.5)
    const { x, y } = sqToXY(p, sq)
    sp.position.set(x, y)
    const rs = scaleAt(p, sqY(sq))
    sp.scale.set((p.cell * rs * 1.03) / TILE_DESIGN, (p.cellH * rs * 1.07) / TILE_DESIGN)
    // Едва заметный разнобой поворота — «наклеено руками».
    sp.rotation = (visualRng(sq + 7)() * 2 - 1) * 0.02
    this.tilesLayer.addChild(sp)
    this.tiles.set(sq, sp)
    return sp
  }

  tileSprite(sq: Sq): Sprite | null {
    return this.tiles.get(sq) ?? null
  }

  allTiles(): { sq: Sq; sprite: Sprite }[] {
    const out: { sq: Sq; sprite: Sprite }[] = []
    for (const [sq, sprite] of this.tiles) out.push({ sq, sprite })
    return out
  }

  // -------------------------------------------------------------------------
  // Подсветки

  /** Рамка выбранной фигуры. */
  setSelected(sq: Sq): void {
    this.selectedG.clear()
    if (sq === -1 || !this.proj) return
    const p = this.proj
    const { x, y } = sqToXY(p, sq)
    const cw = cellAt(p, sqY(sq)), ch = p.cellH * scaleAt(p, sqY(sq))
    this.selectedG
      .roundRect(x - cw / 2 + 2, y - ch / 2 + 2, cw - 4, ch - 4, 6)
      .stroke({ width: 3, color: PAL.ochre })
  }

  /** Кружки-«капли краски» легальных ходов. */
  showMoveHints(sqs: Sq[]): void {
    this.moveDots.removeChildren().forEach(c => c.destroy())
    if (!this.proj) return
    for (const sq of sqs) {
      const dot = new Sprite(assets.texture('ui.moveDot'))
      dot.anchor.set(0.5)
      const { x, y } = sqToXY(this.proj, sq)
      dot.position.set(x, y)
      dot.alpha = 0.85
      dot.scale.set(cellAt(this.proj, sqY(sq)) / 90)
      this.moveDots.addChild(dot)
    }
  }

  /** Пульсирующие рамки допустимых целей карты. */
  showTargetHints(sqs: Sq[]): void {
    this.targetFrames.removeChildren().forEach(c => c.destroy())
    if (!this.proj) return
    const p = this.proj
    for (const sq of sqs) {
      const g = new Graphics()
      const { x, y } = sqToXY(p, sq)
      const cw = cellAt(p, sqY(sq)), ch = p.cellH * scaleAt(p, sqY(sq))
      g.roundRect(x - cw / 2 + 3, y - ch / 2 + 3, cw - 6, ch - 6, 5)
        .stroke({ width: 2.5, color: PAL.blue })
      this.targetFrames.addChild(g)
    }
  }

  /** Метка первой цели двухцелевой карты. */
  markFirstTarget(sq: Sq): void {
    this.firstMarkG.clear()
    if (sq === -1 || !this.proj) return
    const { x, y } = sqToXY(this.proj, sq)
    this.firstMarkG
      .circle(x, y, this.proj.cell * 0.3)
      .stroke({ width: 4, color: PAL.vermilion })
  }

  /** Телеграф Куратора: подсветить ряд (-1 = снять). */
  telegraphRow(row: number): void {
    this.telegraphG.clear()
    if (row < 0 || !this.proj) return
    const p = this.proj
    const rw = p.bw * p.cell * scaleAt(p, row)
    const rx = p.cx - rw / 2
    const ry = p.rowTop[row] ?? 0
    const rh = (p.rowBottom[row] ?? 0) - ry
    this.telegraphG
      .rect(rx, ry, rw, rh)
      .fill({ color: PAL.ochre, alpha: 0.14 })
      .rect(rx, ry, rw, rh)
      .stroke({ width: 2, color: PAL.ochre, alpha: 0.5 })
  }

  clearHints(): void {
    this.setSelected(-1)
    this.showMoveHints([])
    this.showTargetHints([])
    this.markFirstTarget(-1)
  }

  // -------------------------------------------------------------------------
  // Анимации террейна

  /** Тайл рвётся: две половинки разлетаются с вращением. */
  async animateCut(at: Sq): Promise<void> {
    const p = this.proj
    const sp = this.tiles.get(at)
    if (!p) return
    if (sp) {
      killTweensOf(sp)
      sp.destroy()
      this.tiles.delete(at)
    }
    const { x, y } = sqToXY(p, at)
    const rsC = scaleAt(p, sqY(at))
    const hw = (p.cell * rsC) / 2, hh = (p.cellH * rsC) / 2
    const rng = visualRng(at + 31)
    const light = (sqX(at) + sqY(at)) % 2 === 0
    const color = light ? PAL.paper : 0xe6dcc3

    // Рваная диагональ: два полигона-половинки.
    const mkHalf = (pts: number[], seedOff: number): Graphics => {
      const g = new Graphics()
      g.poly(tornPoly(pts, at + seedOff, { amp: 2.5, step: 6 })).fill(color)
      g.position.set(x, y)
      this.tilesLayer.addChild(g)
      return g
    }
    const a = mkHalf([-hw, -hh, hw, -hh, -hw + 6, hh], 11)
    const b = mkHalf([hw, -hh, hw, hh, -hw + 6, hh], 12)

    const dur = 4 / SM_HZ
    const fly = (g: Graphics, dx: number, rot: number): Promise<void> =>
      tween(g, { x: g.x + dx, y: g.y + p.cellH * 0.5, rotation: rot, alpha: 0 }, {
        dur, quantizeHz: SM_HZ,
      }).done
    await Promise.all([
      fly(a, -p.cell * (0.4 + rng() * 0.3), -0.6 - rng() * 0.4),
      fly(b, p.cell * (0.4 + rng() * 0.3), 0.5 + rng() * 0.5),
    ])
    a.destroy()
    b.destroy()
  }

  /** Тайл шлёпается сверху с oversquash. */
  async animateGlue(at: Sq): Promise<void> {
    const p = this.proj
    if (!p || this.tiles.has(at)) return
    const sp = this.addTile(at)
    const { x, y } = sqToXY(p, at)
    const sx = sp.scale.x, sy = sp.scale.y

    // Старт: выше и крупнее («подлетает» к столу).
    sp.position.set(x, y - p.cellH * 1.3)
    sp.scale.set(sx * 1.35, sy * 1.35)
    sp.alpha = 0.9
    await tween(sp, { y }, { dur: 3 / SM_HZ, quantizeHz: SM_HZ, owner: sp }).done

    // Oversquash — ровно один шаг.
    sp.alpha = 1
    sp.scale.set(sx * 1.28, sy * 0.68)
    await wait(1 / SM_HZ)
    sp.scale.set(sx * 0.94, sy * 1.08)
    await wait(1 / SM_HZ)
    sp.scale.set(sx, sy)
  }

  /**
   * Сдвиг ряда Куратором: тайлы едут с 12fps-степпингом, крайний
   * заворачивается. state — состояние ПОСЛЕ сдвига (для пересборки).
   */
  async animateCurator(row: number, dir: 1 | -1, state: BattleState): Promise<void> {
    const p = this.proj
    if (!p) return
    this.telegraphRow(-1)
    const movers: Promise<void>[] = []
    for (const [sq, sp] of this.tiles) {
      if (sqY(sq) !== row) continue
      const nx = sqX(sq) + dir
      const wraps = nx < 0 || nx >= p.bw
      const target = sp.x + dir * p.cell * scaleAt(p, row)
      if (wraps) {
        movers.push(tween(sp, { x: target, alpha: 0 }, { dur: 4 / SM_HZ, quantizeHz: SM_HZ, owner: sp }).done)
      } else {
        movers.push(tween(sp, { x: target }, { dur: 4 / SM_HZ, quantizeHz: SM_HZ, owner: sp }).done)
      }
    }
    await Promise.all(movers)
    // Жёсткая пересборка ряда по новому состоянию.
    for (const [sq, sp] of [...this.tiles]) {
      if (sqY(sq) !== row) continue
      killTweensOf(sp)
      sp.destroy()
      this.tiles.delete(sq)
    }
    const b = state.board
    for (let x = 0; x < b.w; x++) {
      const sq = mkSq(x, row)
      if (tileAt(b, sq) !== HOLE) this.addTile(sq)
    }
  }

  destroy(): void {
    this.offTick()
    for (const sp of this.tiles.values()) killTweensOf(sp)
    this.container.destroy({ children: true })
    this.tiles.clear()
  }
}
