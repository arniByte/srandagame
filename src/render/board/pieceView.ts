import { Container, Graphics, Sprite } from 'pixi.js'
import type { Piece } from '../../engine/types'
import { assets } from '../../assets/manifest'
import { PIECE_TEX } from '../../assets/placeholders'
import { PAL, factionOf } from '../../assets/palette'
import {
  hopMove, idleSway, tipOver, visualRng, SM_HZ, type SwayHandle,
} from '../anim/stopmotion'
import { killTweensOf, tween, wait } from '../anim/tween'

/** Отношение высоты фигуры к клетке (фигуры чуть выше клетки — театральность). */
const PIECE_HEIGHT = 1.5

/**
 * Спрайт фигуры: тело (качается в простое), «бумажная» тень-блоб
 * (сжимается в прыжке), вуаль заморозки, королевская/эскортная метка.
 * root позиционируется в «точку ног» на тайле; zIndex = y.
 */
export class PieceView {
  root = new Container()
  readonly id: number
  readonly owner: 0 | 1
  type: string

  private body = new Container()
  private sprite: Sprite
  private shadow: Sprite
  private veil = new Graphics()
  private badge = new Graphics()
  private hpBar = new Graphics()
  private sway: SwayHandle
  private cell: number
  private shadowBase = 1

  constructor(piece: Piece, cell: number) {
    this.id = piece.id
    this.owner = piece.owner
    this.type = piece.type
    this.cell = cell

    this.shadow = new Sprite(assets.texture('ui.shadow'))
    this.shadow.anchor.set(0.5)
    this.root.addChild(this.shadow)

    this.sprite = new Sprite()
    this.root.addChild(this.body)
    this.body.addChild(this.sprite, this.veil, this.badge, this.hpBar)
    this.applyTexture()
    this.applyScale()

    // Фаза покачивания — по id, чтобы армия не качалась синхронно.
    this.sway = idleSway(this.body, (piece.id * 0.37) % 2)
    this.updateHp(piece.hp, piece.maxHp)
  }

  private applyTexture(): void {
    const key = `piece.${factionOf(this.owner)}.${this.type}`
    this.sprite.texture = assets.texture(key)
    const entry = assets.entry(key)
    const pivot = entry?.pivot
    this.sprite.anchor.set(pivot?.[0] ?? PIECE_TEX.anchorX, pivot?.[1] ?? PIECE_TEX.anchorY)
  }

  private applyScale(): void {
    const key = `piece.${factionOf(this.owner)}.${this.type}`
    const world = assets.entry(key)?.worldScale ?? 1
    const s = ((this.cell * PIECE_HEIGHT) / PIECE_TEX.h) * world
    this.sprite.scale.set(s)
    const sw = (this.cell * 0.8) / this.shadow.texture.width
    this.shadowBase = sw
    this.shadow.scale.set(sw)
    this.shadow.alpha = 0.9
  }

  /** Пересадка на новую клетку/проекцию без анимации. */
  setPos(x: number, y: number, cell?: number): void {
    if (cell !== undefined && cell !== this.cell) {
      this.cell = cell
      this.applyScale()
      this.redrawOverlays()
    }
    this.root.position.set(x, y)
    this.root.zIndex = y
  }

  get x(): number { return this.root.x }
  get y(): number { return this.root.y }

  // -------------------------------------------------------------------------
  // Анимации

  /** Прыжок на клетку (стоп-моушен): тень сжимается с высотой дуги. */
  async hopTo(x: number, y: number): Promise<void> {
    this.sway.setPaused(true)
    killTweensOf(this.root)
    const arc = Math.max(18, this.cell * 0.45)
    await hopMove(this.root, { x: this.root.x, y: this.root.y }, { x, y }, {
      arc,
      steps: 3,
      seed: this.id * 17 + 3,
      onAir: (h) => {
        this.shadow.scale.set(this.shadowBase * (1 - 0.4 * h))
        this.shadow.alpha = 0.9 - 0.55 * h
        // Тень остаётся «на земле»: компенсируем подъём тела.
        this.shadow.y = arc * h
        this.root.zIndex = this.root.y + arc * h
      },
    })
    this.shadow.y = 0
    this.shadow.scale.set(this.shadowBase)
    this.shadow.alpha = 0.9
    this.root.zIndex = this.root.y
    this.sway.setPaused(false)
  }

  /** Скольжение (толчок/Куратор): жёсткие шаги, без дуги. */
  async slideTo(x: number, y: number): Promise<void> {
    this.sway.setPaused(true)
    killTweensOf(this.root)
    await tween(this.root, { x, y }, { dur: 4 / SM_HZ, quantizeHz: SM_HZ }).done
    this.root.zIndex = this.root.y
    this.sway.setPaused(false)
  }

  /** Появление призванной фигуры: шлёпается сверху. */
  async appear(): Promise<void> {
    this.sway.setPaused(true)
    const y = this.root.y
    this.root.y = y - this.cell * 1.6
    this.root.alpha = 0.85
    this.body.scale.set(1.15)
    await tween(this.root, { y }, { dur: 3 / SM_HZ, quantizeHz: SM_HZ }).done
    this.root.alpha = 1
    this.body.scale.set(1.2, 0.72)
    await wait(1 / SM_HZ)
    this.body.scale.set(0.94, 1.1)
    await wait(1 / SM_HZ)
    this.body.scale.set(1)
    this.sway.setPaused(false)
  }

  /** Гибель: опрокидывание набок (осколки/брызги — забота battleScene). */
  async die(): Promise<void> {
    this.sway.stop()
    killTweensOf(this.root)
    killTweensOf(this.body)
    tween(this.shadow, { alpha: 0 }, { dur: 0.25, owner: this.root })
    await tipOver(this.body, this.id * 29 + 11)
  }

  /** Вспышка при уроне (ворота). */
  async flashDamage(): Promise<void> {
    this.sprite.tint = 0xff8866
    await wait(2 / SM_HZ)
    this.sprite.tint = 0xffffff
  }

  /** Смена типа при промоушене. */
  refreshType(type: string): void {
    this.type = type
    this.applyTexture()
    this.applyScale()
  }

  /** Горячая подмена арта (bus 'assetsSwapped'). */
  refreshTexture(): void {
    this.applyTexture()
    this.applyScale()
  }

  // -------------------------------------------------------------------------
  // Оверлеи

  /** Заморозка: голубая вуаль поверх аппликации. */
  setFrozen(on: boolean): void {
    this.veil.clear()
    if (on) {
      const h = this.cell * PIECE_HEIGHT
      const rng = visualRng(this.id + 77)
      this.veil
        .roundRect(-this.cell * 0.34, -h * 0.92, this.cell * 0.68, h * 0.94, 8)
        .fill({ color: 0xa8d4f5, alpha: 0.45 })
      // Пара «трещинок льда».
      for (let i = 0; i < 3; i++) {
        const x0 = (rng() - 0.5) * this.cell * 0.5
        const y0 = -h * (0.2 + rng() * 0.6)
        this.veil.moveTo(x0, y0).lineTo(x0 + (rng() - 0.5) * 14, y0 + (rng() - 0.5) * 14)
          .stroke({ width: 1.5, color: 0xe8f4ff, alpha: 0.8 })
      }
      this.sprite.tint = 0xbfd8ee
    } else {
      this.sprite.tint = 0xffffff
    }
  }

  /** Метка: королевская фигура или цель эскорта — золотой кружок. */
  setBadge(kind: 'royal' | 'escort' | null): void {
    this.badge.clear()
    if (!kind) return
    const h = this.cell * PIECE_HEIGHT
    if (kind === 'royal') {
      this.badge.circle(this.cell * 0.3, -h * 0.98, 5).fill(PAL.ochre)
    } else {
      this.badge.circle(this.cell * 0.3, -h * 0.98, 6).stroke({ width: 3, color: PAL.ochre })
    }
  }

  /** HP структуры (ворота): пипсы прочности. */
  updateHp(hp: number, maxHp: number): void {
    this.hpBar.clear()
    if (maxHp <= 0) return
    const w = this.cell * 0.7
    const h = this.cell * PIECE_HEIGHT
    const step = w / maxHp
    for (let i = 0; i < maxHp; i++) {
      this.hpBar
        .rect(-w / 2 + i * step + 0.5, -h * 1.02, step - 1, 4)
        .fill({ color: i < hp ? PAL.green : PAL.bg, alpha: i < hp ? 1 : 0.5 })
    }
  }

  private redrawOverlays(): void {
    // Пересборка оверлеев под новый масштаб делается лениво заказчиком
    // (battleScene знает актуальные hp/traits) — здесь только сброс.
  }

  destroy(): void {
    this.sway.stop()
    killTweensOf(this.root)
    killTweensOf(this.body)
    killTweensOf(this.shadow)
    this.root.destroy({ children: true })
  }
}
