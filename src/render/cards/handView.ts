import { Container, type FederatedPointerEvent } from 'pixi.js'
import type { BattleState, CardInstance } from '../../engine/types'
import { cardDef, effectiveCost } from '../../engine'
import { cubicOut, backOut } from '../anim/easings'
import { killTweensOf, tween, wait } from '../anim/tween'
import { CardView, CARD_H, CARD_W } from './cardView'
import type { DragController, DragHost } from './dragController'

/**
 * Рука игрока: «столик художника» — сетка 2 колонки у правого края.
 * Карты НЕ перекрываются (лимит руки 5 ≤ 6 мест) — каждую видно целиком
 * и брать её удобно. Лёгкий коллажный разнобой поворотов; hover приподнимает
 * и увеличивает карту (плавные 60 fps — карты живут в мире UI).
 */

export interface HandArea { x: number; y: number; w: number; h: number }

/** Детерминированный «наклеено руками» разнобой по iid карты. */
const jitterRot = (iid: number): number => (((iid * 47) % 9) - 4) * 0.009
const jitterX = (iid: number): number => ((iid * 31) % 7) - 3
const jitterY = (iid: number): number => ((iid * 53) % 5) - 2

export class HandView {
  container = new Container()

  private views = new Map<number, CardView>()
  private order: number[] = []
  private area: HandArea = { x: 0, y: 0, w: 320, h: 460 }
  private drag: DragController | null = null
  /** Масштаб карт в сетке (подбирается под область). */
  private gridScale = 1

  constructor(private host: DragHost) {
    this.container.sortableChildren = true
  }

  attachDrag(drag: DragController): void {
    this.drag = drag
    drag.onCardHome = () => this.relayout(false)
  }

  setArea(area: HandArea): void {
    this.area = area
    this.relayout(false)
  }

  /** Синхронизация с рукой игрока 0; новые карты въезжают, ушедшие тают. */
  sync(state: BattleState): void {
    const hand = state.sides[0].hand
    // Удалить ушедшие.
    for (const [iid, view] of [...this.views]) {
      if (!hand.includes(iid)) {
        this.views.delete(iid)
        if (view.dragging || view.awaiting) continue // dragController сам разрулит
        killTweensOf(view.root)
        tween(view.root, { alpha: 0, y: view.root.y + 40 }, {
          dur: 0.22, ease: cubicOut, onDone: () => view.destroy(),
        })
      }
    }
    // Добавить новые.
    for (const iid of hand) {
      if (this.views.has(iid)) continue
      const inst = state.cards.find(c => c.iid === iid) as CardInstance | undefined
      if (!inst) continue
      const def = cardDef(inst.def)
      const cost = effectiveCost(state, 0, inst.upgraded, def.id)
      const view = new CardView(iid, def, cost)
      // Въезд из-за правого края.
      view.root.position.set(this.area.x + this.area.w + CARD_W, this.area.y + this.area.h * 0.6)
      view.root.rotation = 0.5
      this.container.addChild(view.root)
      this.views.set(iid, view)
      this.bindInput(view)
    }
    this.order = hand.slice()
    // Обновить стоимость/доступность.
    for (const iid of hand) {
      const view = this.views.get(iid)
      const inst = state.cards.find(c => c.iid === iid)
      if (!view || !inst) continue
      const cost = effectiveCost(state, 0, inst.upgraded, cardDef(inst.def).id)
      view.setCost(cost)
      view.setAffordable(state.sides[0].paint >= cost)
    }
    this.relayout(false)
  }

  /** Раскладка сетки 2×N, прижатой к низу области; instant — без твинов. */
  relayout(instant: boolean): void {
    const n = this.order.length
    const rows = Math.max(1, Math.ceil(n / 2))
    const gapX = 10
    const gapY = 12
    const sByW = (this.area.w - gapX) / 2 / CARD_W
    const sByH = (this.area.h - (rows - 1) * gapY) / rows / CARD_H
    const s = Math.min(1.12, sByW, sByH)
    this.gridScale = s
    const cw = CARD_W * s
    const ch = CARD_H * s
    const cx = this.area.x + this.area.w / 2
    const colX = [cx - cw / 2 - gapX / 2, cx + cw / 2 + gapX / 2]
    const bottom = this.area.y + this.area.h

    let z = 0
    for (let i = 0; i < n; i++) {
      const iid = this.order[i] as number
      const view = this.views.get(iid)
      if (!view) continue
      const row = Math.floor(i / 2)
      const col = i % 2
      view.homeX = (colX[col] as number) + jitterX(iid)
      view.homeY = bottom - ch / 2 - (rows - 1 - row) * (ch + gapY) + jitterY(iid)
      view.homeRot = jitterRot(iid)
      view.homeScale = s
      view.root.zIndex = z++
      if (view.dragging || view.awaiting || view.hovered) continue
      if (instant) {
        killTweensOf(view.root)
        view.root.position.set(view.homeX, view.homeY)
        view.root.rotation = view.homeRot
        view.root.scale.set(s)
        view.root.alpha = 1
      } else {
        killTweensOf(view.root)
        tween(view.root, { x: view.homeX, y: view.homeY, rotation: view.homeRot, alpha: 1 }, {
          dur: 0.28, ease: cubicOut,
        })
        tween(view.root.scale, { x: s, y: s }, { dur: 0.28, ease: cubicOut, owner: view.root })
      }
    }
  }

  private bindInput(view: CardView): void {
    const r = view.root
    r.eventMode = 'static'
    r.cursor = 'pointer'
    r.on('pointerover', () => this.hover(view, true))
    r.on('pointerout', () => this.hover(view, false))
    r.on('pointerdown', (e: FederatedPointerEvent) => {
      if (e.button !== 0) return // RMB — вращение доски, не драг
      this.hover(view, false)
      this.drag?.begin(view, e)
    })
  }

  private hover(view: CardView, on: boolean): void {
    if (view.dragging || view.awaiting) return
    if (on && !this.host.inputEnabled()) return
    if (view.hovered === on) return
    view.hovered = on
    killTweensOf(view.root)
    if (on) {
      view.root.zIndex = 1000
      const hs = this.gridScale * 1.22
      tween(view.root, { x: view.homeX - 12, y: view.homeY - 10, rotation: 0 }, { dur: 0.12, ease: cubicOut })
      tween(view.root.scale, { x: hs, y: hs }, { dur: 0.12, ease: backOut, owner: view.root })
    } else {
      this.relayout(false)
      tween(view.root, { x: view.homeX, y: view.homeY, rotation: view.homeRot }, { dur: 0.16, ease: cubicOut })
      tween(view.root.scale, { x: this.gridScale, y: this.gridScale }, { dur: 0.16, ease: cubicOut, owner: view.root })
    }
  }

  /** Сдача руки по карте (коллажный вход). */
  async dealIn(): Promise<void> {
    const startX = this.area.x + this.area.w + CARD_W
    const startY = this.area.y + this.area.h * 0.55
    for (const iid of this.order) {
      const view = this.views.get(iid)
      if (!view) continue
      killTweensOf(view.root)
      view.root.position.set(startX, startY)
      view.root.rotation = 0.5
      view.root.alpha = 1
    }
    for (const iid of this.order) {
      const view = this.views.get(iid)
      if (!view) continue
      tween(view.root, { x: view.homeX, y: view.homeY, rotation: view.homeRot }, {
        dur: 0.3, ease: backOut,
      })
      tween(view.root.scale, { x: this.gridScale, y: this.gridScale }, { dur: 0.3, owner: view.root })
      await wait(0.09)
    }
    await wait(0.3)
  }

  /** Рука «сдаётся обратно» (коллажный выход). */
  async dealOut(): Promise<void> {
    const outX = this.area.x + this.area.w + CARD_W * 1.5
    for (const iid of [...this.order].reverse()) {
      const view = this.views.get(iid)
      if (!view) continue
      killTweensOf(view.root)
      tween(view.root, { x: outX, rotation: 0.6, alpha: 0.9 }, { dur: 0.24, ease: cubicOut })
      await wait(0.06)
    }
    await wait(0.24)
  }

  cardViews(): CardView[] {
    return [...this.views.values()]
  }

  /** Глобальная позиция первой карты руки (для e2e). */
  debugFirstCard(): { iid: number; x: number; y: number } | null {
    const iid = this.order[0]
    if (iid === undefined) return null
    const view = this.views.get(iid)
    if (!view) return null
    const g = view.root.getGlobalPosition()
    return { iid, x: g.x, y: g.y }
  }

  destroy(): void {
    for (const v of this.views.values()) {
      killTweensOf(v.root)
      v.destroy()
    }
    this.views.clear()
    this.container.destroy({ children: true })
  }
}
