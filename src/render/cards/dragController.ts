import { Container, Rectangle, type FederatedPointerEvent } from 'pixi.js'
import type { Action, BattleState, Sq } from '../../engine/types'
import { cardDef } from '../../engine'
import { ticker, TICK } from '../../core/ticker'
import { audio } from '../../audio/audioManager'
import { tween, killTweensOf } from '../anim/tween'
import { elasticOut } from '../anim/easings'
import type { Stage } from '../stage'
import type { CardView } from './cardView'

/**
 * Перетаскивание карты: pointer capture, критически-демпфированная пружина
 * с наклоном по скорости; над доской карта «призрачнеет» и подсвечиваются
 * легальные цели; отпускание мимо — упругий возврат с обиженным покачиванием.
 * Карты twoPieces: первая цель запоминается (метка), второй клик завершает.
 */

export interface DragHost {
  getState(): BattleState
  tryAction(action: Action): boolean
  inputEnabled(): boolean
  legalTargetsFor(iid: number): Sq[]
}

export interface DragBoardApi {
  /** Экранная точка → клетка (-1 мимо доски). */
  screenToSq(x: number, y: number): Sq
  showTargets(sqs: Sq[]): void
  clearTargets(): void
  markFirst(sq: Sq): void
}

const SPRING_K = 950
const SPRING_C = 2 * Math.sqrt(SPRING_K)

export class DragController {
  /** HandView просит перекладку, когда карта вернулась. */
  onCardHome: ((card: CardView) => void) | null = null

  private card: CardView | null = null
  private awaitingCard: CardView | null = null
  private firstTarget: Sq = -1
  private legal: Sq[] = []
  private pointer = { x: 0, y: 0 }
  private vel = { x: 0, y: 0 }
  private ghosted = false
  private offTick: () => void
  private handLayerRef: Container

  constructor(
    private host: DragHost,
    private stage: Stage,
    private board: DragBoardApi,
  ) {
    this.handLayerRef = stage.handLayer
    const st = stage.app.stage
    st.eventMode = 'static'
    st.hitArea = new Rectangle(-4096, -4096, 8192, 8192)
    st.on('pointermove', this.onMove, this)
    st.on('pointerup', this.onUp, this)
    st.on('pointerupoutside', this.onUp, this)
    st.on('rightdown', this.onCancelGesture, this)

    this.offTick = ticker.add((dt) => this.update(dt), TICK.TWEEN)
  }

  get active(): boolean {
    return this.card !== null || this.awaitingCard !== null
  }

  /** Начало перетаскивания (вызывает HandView по pointerdown). */
  begin(card: CardView, e: FederatedPointerEvent): void {
    if (!this.host.inputEnabled() || this.active) return
    const state = this.host.getState()
    if (!state.sides[0].hand.includes(card.iid)) return

    this.card = card
    card.dragging = true
    card.hovered = false
    killTweensOf(card.root)
    // Пересадка в dragLayer (координатные системы слоёв совпадают).
    this.stage.dragLayer.addChild(card.root)
    this.pointer.x = e.global.x
    this.pointer.y = e.global.y
    this.vel.x = 0
    this.vel.y = 0
    this.legal = this.host.legalTargetsFor(card.iid)
    audio.sfx('card')
  }

  private onMove(e: FederatedPointerEvent): void {
    this.pointer.x = e.global.x
    this.pointer.y = e.global.y
  }

  private update(dt: number): void {
    const card = this.card
    if (!card) return
    const r = card.root
    // Критически-демпфированная пружина к курсору.
    const step = Math.min(dt, 1 / 30)
    this.vel.x += (SPRING_K * (this.pointer.x - r.x) - SPRING_C * this.vel.x) * step
    this.vel.y += (SPRING_K * (this.pointer.y - r.y) - SPRING_C * this.vel.y) * step
    r.x += this.vel.x * step
    r.y += this.vel.y * step
    // Наклон по горизонтальной скорости.
    r.rotation = Math.max(-0.3, Math.min(0.3, this.vel.x * 0.00045))
    r.scale.set(1.06)

    const overSq = this.board.screenToSq(this.pointer.x, this.pointer.y)
    const over = overSq !== -1
    if (over !== this.ghosted) {
      this.ghosted = over
      card.setGhost(over)
      if (over) this.board.showTargets(this.legal)
      else this.board.clearTargets()
    }
  }

  private onUp(): void {
    const card = this.card
    if (!card) return
    this.card = null
    card.dragging = false
    this.board.clearTargets()
    this.ghosted = false

    const sq = this.board.screenToSq(this.pointer.x, this.pointer.y)
    const def = cardDef(card.defId)

    if (def.target.kind === 'none') {
      // Бесцелевая карта играется сбросом на доску.
      if (sq !== -1 && this.host.tryAction({ t: 'playCard', iid: card.iid, targets: [] })) return
      this.returnCard(card, sq !== -1)
      return
    }

    if (sq !== -1 && this.legal.includes(sq)) {
      if (def.target.kind === 'twoPieces') {
        // Первая цель запомнена — ждём второй клик по доске.
        this.awaitingCard = card
        this.firstTarget = sq
        card.awaiting = true
        card.setGhost(true)
        this.board.markFirst(sq)
        this.board.showTargets(this.legal.filter(s => s !== sq))
        return
      }
      if (this.host.tryAction({ t: 'playCard', iid: card.iid, targets: [sq] })) return
      this.returnCard(card, true)
      return
    }
    this.returnCard(card, sq !== -1)
  }

  /**
   * Клик по доске в режиме ожидания второй цели.
   * true = клик поглощён контроллером.
   */
  handleBoardClick(sq: Sq): boolean {
    const card = this.awaitingCard
    if (!card) return false
    if (sq === this.firstTarget) {
      this.cancelAwait()
      return true
    }
    if (this.legal.includes(sq) &&
        this.host.tryAction({ t: 'playCard', iid: card.iid, targets: [this.firstTarget, sq] })) {
      this.awaitingCard = null
      this.firstTarget = -1
      card.awaiting = false
      this.board.markFirst(-1)
      this.board.clearTargets()
      return true
    }
    this.cancelAwait()
    return true
  }

  private onCancelGesture(): void {
    if (this.awaitingCard) this.cancelAwait()
  }

  private cancelAwait(): void {
    const card = this.awaitingCard
    this.awaitingCard = null
    this.firstTarget = -1
    this.board.markFirst(-1)
    this.board.clearTargets()
    if (card) {
      card.awaiting = false
      this.returnCard(card, true)
    }
  }

  /** Упругий возврат в веер с «обиженным» покачиванием. */
  private returnCard(card: CardView, offended: boolean): void {
    card.setGhost(false)
    this.handLayerRef.addChild(card.root)
    if (offended) audio.sfx('error', 0.5)
    killTweensOf(card.root)
    tween(card.root, { x: card.homeX, y: card.homeY }, { dur: 0.34, ease: elasticOut })
    tween(card.root.scale, { x: 1, y: 1 }, { dur: 0.2, owner: card.root })
    // Покачивание: перелёт по повороту с упругим доводом.
    card.root.rotation = card.homeRot + (offended ? 0.35 : 0.12)
    tween(card.root, { rotation: card.homeRot }, {
      dur: offended ? 0.55 : 0.3, ease: elasticOut, owner: card.root,
      onDone: () => this.onCardHome?.(card),
    })
  }

  /** Принудительный сброс (конец боя, destroy сцены). */
  cancel(): void {
    if (this.card) {
      const c = this.card
      this.card = null
      c.dragging = false
      this.returnCard(c, false)
    }
    this.cancelAwait()
  }

  destroy(): void {
    this.offTick()
    const st = this.stage.app.stage
    st.off('pointermove', this.onMove, this)
    st.off('pointerup', this.onUp, this)
    st.off('pointerupoutside', this.onUp, this)
    st.off('rightdown', this.onCancelGesture, this)
  }
}
