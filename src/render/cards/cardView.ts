import { Container, Sprite, Text } from 'pixi.js'
import type { CardDef } from '../../engine/types'
import { assets } from '../../assets/manifest'
import { CARD_TEX } from '../../assets/placeholders'
import { PAL, cssColor } from '../../assets/palette'

export const CARD_W = CARD_TEX.w
export const CARD_H = CARD_TEX.h

/**
 * Карта в руке: рамка по редкости, иллюстрация, стоимость-капля краски,
 * название (Georgia — «книжный» шрифт коллекционера вырезок), рваный край
 * даёт текстура рамки. Карты — UI: анимируются плавно, БЕЗ квантования.
 */
export class CardView {
  root = new Container()
  readonly iid: number
  readonly defId: string
  cost: number

  /** Домашняя раскладка в сетке руки (устанавливает HandView). */
  homeX = 0
  homeY = 0
  homeRot = 0
  homeScale = 1

  hovered = false
  dragging = false
  /** Карта ждёт вторую цель (twoPieces). */
  awaiting = false

  private costText: Text

  constructor(iid: number, def: CardDef, cost: number) {
    this.iid = iid
    this.defId = def.id
    this.cost = cost

    const frame = new Sprite(assets.texture(`card.frame.${def.rarity}`))
    frame.anchor.set(0.5)
    // Рамка растягивается в дизайн-бокс карты (сгенерённый арт любого размера).
    frame.width = CARD_W
    frame.height = CARD_H
    this.root.addChild(frame)

    const illus = new Sprite(assets.texture(`card.illus.${def.id}`))
    illus.anchor.set(0.5)
    illus.position.set(0, -34)
    // Вписываем по ФАКТИЧЕСКОМУ размеру текстуры (плейсхолдер или сгенерённый арт).
    const iw = Math.max(1, illus.texture.width)
    const ih = Math.max(1, illus.texture.height)
    const fit = Math.min((CARD_W - 30) / iw, 72 / ih)
    illus.scale.set(fit)
    this.root.addChild(illus)

    const name = new Text({ resolution: 2,
      text: def.name,
      style: {
        fontFamily: '"Amatic SC", Georgia, serif',
        fontSize: 22,
        fontWeight: 'bold',
        fill: cssColor(PAL.ink),
        align: 'center',
      },
    })
    name.anchor.set(0.5, 0)
    name.position.set(0, 10)
    if (name.width > CARD_W - 20) name.scale.set((CARD_W - 20) / name.width)
    this.root.addChild(name)

    const desc = new Text({ resolution: 2,
      text: def.desc,
      style: {
        fontFamily: 'Neucha, Georgia, serif',
        fontSize: 12,
        fill: '#4a453b',
        align: 'center',
        wordWrap: true,
        wordWrapWidth: CARD_W - 26,
      },
    })
    desc.anchor.set(0.5, 0)
    desc.position.set(0, 32)
    this.root.addChild(desc)

    // Капля краски со стоимостью.
    const drop = new Sprite(assets.texture('ui.paintDrop'))
    drop.anchor.set(0.5)
    drop.scale.set(1.35)
    drop.position.set(-CARD_W / 2 + 16, -CARD_H / 2 + 18)
    this.root.addChild(drop)

    this.costText = new Text({ resolution: 2,
      text: String(cost),
      style: {
        fontFamily: 'Caveat, Georgia, serif',
        fontSize: 19,
        fontWeight: '700',
        fill: cssColor(PAL.paper),
      },
    })
    this.costText.anchor.set(0.5)
    this.costText.position.set(-CARD_W / 2 + 16, -CARD_H / 2 + 20)
    this.root.addChild(this.costText)
  }

  /** Обновить стоимость (реликвии-скидки). */
  setCost(cost: number): void {
    if (cost === this.cost) return
    this.cost = cost
    this.costText.text = String(cost)
  }

  /** «Призрачность» над доской при перетаскивании. */
  setGhost(on: boolean): void {
    this.root.alpha = on ? 0.4 : 1
  }

  /** Затемнение, когда краски не хватает. */
  setAffordable(on: boolean): void {
    this.root.tint = on ? 0xffffff : 0x9a958a
  }

  destroy(): void {
    this.root.destroy({ children: true })
  }
}
