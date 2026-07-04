import { Container, Graphics, Sprite, Text } from 'pixi.js'
import type { Action, BattleState, EngineEvent, Piece, Sq } from '../engine/types'
import { sqY } from '../engine/types'
import { cardDef, pieceType, traitDef } from '../engine'
import { bus } from '../core/bus'
import { viewport } from '../core/resize'
import { assets } from '../assets/manifest'
import { PIECE_TEX } from '../assets/placeholders'
import { FACTION, PAL, cssColor, factionOf } from '../assets/palette'
import { audio } from '../audio/audioManager'
import { tween, wait } from './anim/tween'
import { SM_HZ } from './anim/stopmotion'
import { computeProjection, sqToXY, xyToSq, type Projection } from './board/projection'
import { BoardView } from './board/boardView'
import { PieceView } from './board/pieceView'
import { splatter } from './fx/splatter'
import { paperBurst } from './fx/paperFx'
import { HandView } from './cards/handView'
import { DragController } from './cards/dragController'
import type { Stage } from './stage'

/**
 * Сборка боевой сцены: доска + фигуры + рука + HUD + FX.
 * Сцена НЕ владеет состоянием — только читает его у хоста и просит
 * применить действия. onEngineEvents проигрывает анимации последовательно.
 */

export interface BattleSceneHost {
  getState(): BattleState
  /** Хост валидирует и применяет; true = действие принято. */
  tryAction(action: Action): boolean
  /** false во время хода ИИ/анимаций. */
  inputEnabled(): boolean
  legalMovesFor(pieceId: number): Sq[]
  legalTargetsFor(iid: number): Sq[]
}

const HUD_TOP = 10

export class BattleScene {
  private host: BattleSceneHost
  private stage: Stage | null = null
  private boardView = new BoardView()
  private pieceViews = new Map<number, PieceView>()
  private handView: HandView
  private drag: DragController | null = null
  private proj: Projection | null = null

  // HUD
  private hud = new Container()
  private turnText!: Text
  private objText!: Text
  private paintRow = new Container()
  private endBtn = new Container()
  private banner: Container | null = null
  private promoteOverlay: Container | null = null

  private selected = -1
  private selectedMoves: Sq[] = []
  private lastW = viewport.w
  private lastH = viewport.h
  private disposers: (() => void)[] = []

  constructor(host: BattleSceneHost) {
    this.host = host
    this.handView = new HandView(host)
  }

  // -------------------------------------------------------------------------
  // Монтаж и раскладка

  mount(stage: Stage): void {
    this.stage = stage
    stage.boardLayer.addChild(this.boardView.container)
    stage.handLayer.addChild(this.handView.container)
    stage.uiLayer.addChild(this.hud)
    this.buildHud()

    this.drag = new DragController(this.host, stage, {
      screenToSq: (x, y) => (this.proj ? xyToSq(this.proj, x, y) : -1),
      showTargets: (sqs) => this.boardView.showTargetHints(sqs),
      clearTargets: () => this.boardView.showTargetHints([]),
      markFirst: (sq) => this.boardView.markFirstTarget(sq),
    })
    this.handView.attachDrag(this.drag)

    this.boardView.onTileClick = (sq) => this.onBoardClick(sq)

    this.disposers.push(bus.on('resize', ({ w, h }) => this.layout(w, h)))
    this.disposers.push(bus.on('assetsSwapped', () => this.syncImmediate()))

    this.layout(viewport.w, viewport.h)
    this.syncImmediate()
  }

  layout(w: number, h: number): void {
    this.lastW = w
    this.lastH = h
    const handW = Math.min(360, Math.max(240, w * 0.28))
    const boardRect = { x: 14, y: 58, w: w - handW - 28, h: h - 84 }
    const state = this.host.getState()
    this.proj = computeProjection(state.board.w, state.board.h, boardRect)
    this.boardView.setProjection(this.proj, state)
    for (const view of this.pieceViews.values()) {
      const p = this.statePiece(view.id)
      if (p) {
        const { x, y } = this.footXY(p.pos)
        view.setPos(x, y, this.proj.cell)
      }
    }
    this.handView.setArea({ x: w - handW + 6, y: h - 296, w: handW - 16, h: 288 })
    this.layoutHud(w, h)
    if (this.promoteOverlay) this.rebuildPromoteOverlay()
  }

  /** Жёсткая пересинхронизация вида по состоянию (без анимаций). */
  syncImmediate(): void {
    const state = this.host.getState()
    if (!this.proj) this.layout(this.lastW, this.lastH)
    const proj = this.proj as Projection
    this.boardView.build(state, proj)
    this.boardView.clearHints()
    this.selected = -1
    this.selectedMoves = []

    for (const view of this.pieceViews.values()) view.destroy()
    this.pieceViews.clear()
    for (const p of state.pieces) this.addPieceView(p)

    this.handView.sync(state)
    this.handView.relayout(true)
    this.refreshHud()
    this.syncOverlaysFromState()
    if (state.curator && state.curator.nextAt - state.turn === 1) {
      this.boardView.telegraphRow(state.curator.row)
    }
  }

  // -------------------------------------------------------------------------
  // Вспомогательные

  private statePiece(id: number): Piece | null {
    for (const p of this.host.getState().pieces) if (p.id === id) return p
    return null
  }

  private footXY(sq: Sq): { x: number; y: number } {
    const p = this.proj as Projection
    const { x, y } = sqToXY(p, sq)
    return { x, y: y + p.cellH * 0.2 }
  }

  private addPieceView(p: Piece): PieceView {
    const view = new PieceView(p, this.proj?.cell ?? 64)
    const { x, y } = this.footXY(p.pos)
    view.setPos(x, y)
    this.stage?.piecesLayer.addChild(view.root)
    this.pieceViews.set(p.id, view)
    this.applyPieceOverlays(view, p)
    return view
  }

  private applyPieceOverlays(view: PieceView, p: Piece): void {
    const state = this.host.getState()
    let frozen = false
    for (const t of p.traits) if (traitDef(t.id).blocksMovement) frozen = true
    view.setFrozen(frozen)
    let badge: 'royal' | 'escort' | null = null
    if (pieceType(p.type).royal) badge = 'royal'
    if (state.objective.kind === 'escort' && state.objective.escortPieceId === p.id) badge = 'escort'
    view.setBadge(badge)
    view.updateHp(p.hp, p.maxHp)
  }

  // -------------------------------------------------------------------------
  // Ввод

  private onBoardClick(sq: Sq): void {
    if (this.drag?.handleBoardClick(sq)) return
    if (!this.host.inputEnabled()) return
    const state = this.host.getState()
    if (state.phase !== 'main' || state.active !== 0) return

    // Ход выбранной фигурой.
    if (this.selected !== -1 && this.selectedMoves.includes(sq)) {
      const action: Action = { t: 'move', piece: this.selected, to: sq }
      this.clearSelection()
      this.host.tryAction(action)
      return
    }

    // Выбор своей фигуры.
    const piece = state.pieces.find(p => p.pos === sq && p.owner === 0)
    if (piece) {
      this.selected = piece.id
      this.selectedMoves = this.host.legalMovesFor(piece.id)
      this.boardView.setSelected(sq)
      this.boardView.showMoveHints(this.selectedMoves)
      audio.sfx('select', 0.7)
      return
    }
    this.clearSelection()
  }

  private clearSelection(): void {
    this.selected = -1
    this.selectedMoves = []
    this.boardView.setSelected(-1)
    this.boardView.showMoveHints([])
  }

  // -------------------------------------------------------------------------
  // Проигрывание событий движка

  /** Последовательно проигрывает пакет событий; резолвится по завершении. */
  async onEngineEvents(events: EngineEvent[]): Promise<void> {
    this.clearSelection()
    for (const ev of events) {
      await this.playEvent(ev)
    }
    this.afterBatch()
  }

  private async playEvent(ev: EngineEvent): Promise<void> {
    const state = this.host.getState()
    switch (ev.e) {
      case 'turnStarted': {
        this.refreshHud()
        await wait(0.08)
        break
      }
      case 'moved': {
        const view = this.pieceViews.get(ev.piece)
        if (!view) break
        audio.sfx('move')
        const { x, y } = this.footXY(ev.to)
        await view.hopTo(x, y)
        break
      }
      case 'captured': {
        const view = this.pieceViews.get(ev.victim)
        audio.sfx('capture')
        bus.emit('shake', { power: 6 })
        if (view) {
          const f = FACTION[factionOf(ev.owner)]
          splatter(this.stage?.fxLayer ?? new Container(), view.x, view.y, [f.primary, f.secondary], ev.victim * 13 + 5)
          await view.die()
          view.destroy()
          this.pieceViews.delete(ev.victim)
        }
        break
      }
      case 'bumped': {
        const attacker = this.pieceViews.get(ev.attacker)
        bus.emit('shake', { power: 5 })
        audio.sfx('capture', 0.7)
        if (attacker) {
          const { x, y } = this.footXY(ev.at)
          const ox = attacker.x, oy = attacker.y
          // Выпад: два жёстких шага к цели и обратно.
          attacker.setPos(ox + (x - ox) * 0.35, oy + (y - oy) * 0.35)
          await wait(1 / SM_HZ)
          attacker.setPos(ox, oy)
          await wait(1 / SM_HZ)
        }
        break
      }
      case 'damaged': {
        const view = this.pieceViews.get(ev.piece)
        if (view) {
          view.updateHp(ev.hp, this.statePiece(ev.piece)?.maxHp ?? Math.max(ev.hp + ev.dmg, 1))
          await view.flashDamage()
        }
        break
      }
      case 'destroyed': {
        const view = this.pieceViews.get(ev.piece)
        audio.sfx('capture', 0.8)
        if (view) {
          const f = FACTION[factionOf(ev.owner)]
          splatter(this.stage?.fxLayer ?? new Container(), view.x, view.y, [f.primary, f.secondary], ev.piece * 13 + 9)
          paperBurst(this.stage?.fxLayer ?? new Container(), view.x, view.y - 12, [PAL.paper, f.primary], 8, ev.piece + 3)
          await view.die()
          view.destroy()
          this.pieceViews.delete(ev.piece)
        }
        break
      }
      case 'summoned': {
        audio.sfx('glue')
        const synthetic: Piece = {
          id: ev.piece, owner: ev.owner, type: ev.type, pos: ev.at,
          hp: -1, maxHp: -1, traits: [], moved: true, rosterId: null,
        }
        const real = this.statePiece(ev.piece)
        const view = this.addPieceView(real ?? synthetic)
        await view.appear()
        break
      }
      case 'cardPlayed': {
        audio.sfx('card')
        if (ev.side === 1) await this.announceEnemyCard(ev.def)
        else this.handView.sync(state)
        break
      }
      case 'cardDrawn': {
        // Рука пересинхронизируется в afterBatch (карты доезжают пачкой).
        break
      }
      case 'reshuffled': {
        audio.sfx('card', 0.5)
        break
      }
      case 'paint': {
        this.refreshHud()
        break
      }
      case 'tileCut': {
        audio.sfx('cut')
        const { x, y } = sqToXY(this.proj as Projection, ev.at)
        paperBurst(this.stage?.fxLayer ?? new Container(), x, y, [PAL.paper, 0xe6dcc3], 10, ev.at + 17)
        await this.boardView.animateCut(ev.at)
        break
      }
      case 'tileGlued': {
        audio.sfx('glue')
        await this.boardView.animateGlue(ev.at)
        break
      }
      case 'traitAdded': {
        const view = this.pieceViews.get(ev.piece)
        if (view && traitDef(ev.trait).blocksMovement) {
          audio.sfx('freeze')
          view.setFrozen(true)
          await wait(0.15)
        }
        break
      }
      case 'traitExpired': {
        const view = this.pieceViews.get(ev.piece)
        if (view && traitDef(ev.trait).blocksMovement) view.setFrozen(false)
        break
      }
      case 'pushed': {
        const view = this.pieceViews.get(ev.piece)
        if (view) {
          const { x, y } = this.footXY(ev.to)
          await view.slideTo(x, y)
        }
        break
      }
      case 'swapped': {
        const a = this.pieceViews.get(ev.a)
        const b = this.pieceViews.get(ev.b)
        if (a && b) {
          const pa = { x: a.x, y: a.y }
          const pb = { x: b.x, y: b.y }
          audio.sfx('move')
          await Promise.all([a.hopTo(pb.x, pb.y), b.hopTo(pa.x, pa.y)])
        }
        break
      }
      case 'promoteOffered': {
        audio.sfx('promote')
        break
      }
      case 'promoted': {
        const view = this.pieceViews.get(ev.piece)
        audio.sfx('promote')
        if (view) {
          paperBurst(this.stage?.fxLayer ?? new Container(), view.x, view.y - 20,
            [PAL.paper, PAL.ochre, PAL.vermilion], 12, ev.piece + 21)
          view.refreshType(ev.into)
          const p = this.statePiece(ev.piece)
          if (p) this.applyPieceOverlays(view, p)
          await wait(0.25)
        }
        break
      }
      case 'check': {
        const view = this.pieceViews.get(ev.royal)
        if (view && ev.side === 0) {
          audio.sfx('error', 0.4)
          await view.flashDamage()
        }
        break
      }
      case 'curatorWarn': {
        this.boardView.telegraphRow(ev.row)
        break
      }
      case 'curatorShift': {
        audio.sfx('card', 0.8)
        const jobs: Promise<void>[] = [this.boardView.animateCurator(ev.row, ev.dir, state)]
        for (const p of state.pieces) {
          if (sqY(p.pos) !== ev.row) continue
          const view = this.pieceViews.get(p.id)
          if (!view) continue
          const { x, y } = this.footXY(p.pos)
          jobs.push(view.slideTo(x, y))
        }
        await Promise.all(jobs)
        break
      }
      case 'battleEnded': {
        this.drag?.cancel()
        this.boardView.clearHints()
        audio.sfx(ev.winner === 0 ? 'win' : 'lose')
        this.showBanner(ev.winner === 0, ev.reason)
        await wait(0.4)
        break
      }
    }
  }

  /** Финализация после пакета: view = f(state). */
  private afterBatch(): void {
    const state = this.host.getState()
    // Фигуры: добираем недостающие, убираем лишние, поправляем позиции.
    const alive = new Set<number>()
    for (const p of state.pieces) {
      alive.add(p.id)
      let view = this.pieceViews.get(p.id)
      if (!view) view = this.addPieceView(p)
      const { x, y } = this.footXY(p.pos)
      if (Math.abs(view.x - x) > 0.5 || Math.abs(view.y - y) > 0.5) view.setPos(x, y)
      this.applyPieceOverlays(view, p)
    }
    for (const [id, view] of [...this.pieceViews]) {
      if (!alive.has(id)) {
        view.destroy()
        this.pieceViews.delete(id)
      }
    }
    this.boardView.syncTiles(state)
    this.handView.sync(state)
    this.refreshHud()
    this.syncOverlaysFromState()
  }

  // -------------------------------------------------------------------------
  // HUD

  private buildHud(): void {
    this.turnText = new Text({
      text: '',
      style: {
        fontFamily: 'Georgia, serif', fontSize: 17, fontWeight: 'bold',
        fill: cssColor(PAL.paper),
      },
    })
    this.turnText.position.set(16, HUD_TOP)

    this.objText = new Text({
      text: '',
      style: { fontFamily: 'Georgia, serif', fontSize: 13, fill: '#bfb7a4' },
    })
    this.objText.position.set(16, HUD_TOP + 24)

    const btnBg = new Graphics()
    btnBg.roundRect(0, 0, 148, 44, 8).fill(PAL.vermilion)
    btnBg.roundRect(3, 3, 142, 38, 6).stroke({ width: 1.5, color: PAL.paper, alpha: 0.5 })
    const btnText = new Text({
      text: 'Конец хода',
      style: {
        fontFamily: 'Georgia, serif', fontSize: 16, fontWeight: 'bold',
        fill: cssColor(PAL.paper),
      },
    })
    btnText.anchor.set(0.5)
    btnText.position.set(74, 22)
    this.endBtn.addChild(btnBg, btnText)
    this.endBtn.eventMode = 'static'
    this.endBtn.cursor = 'pointer'
    this.endBtn.on('pointertap', () => {
      const state = this.host.getState()
      if (!this.host.inputEnabled() || state.active !== 0 || state.phase !== 'main') return
      this.clearSelection()
      this.host.tryAction({ t: 'endTurn' })
    })

    this.hud.addChild(this.turnText, this.objText, this.paintRow, this.endBtn)
  }

  private layoutHud(w: number, h: number): void {
    this.paintRow.position.set(16, h - 44)
    this.endBtn.position.set(w - 172, h - 356)
    if (this.banner) this.banner.position.set(w / 2, h / 2)
  }

  private refreshHud(): void {
    const state = this.host.getState()
    const you = state.active === 0
    this.turnText.text = `Ход ${state.turn} · ${you ? 'вы рисуете' : 'ход куратора тьмы'}`
    this.turnText.style.fill = you ? cssColor(PAL.ochre) : cssColor(PAL.blue)
    this.objText.text = this.objectiveLabel(state)
    this.endBtn.alpha = you && state.phase === 'main' ? 1 : 0.45

    // Капли краски.
    this.paintRow.removeChildren().forEach(c => c.destroy())
    const side = state.sides[0]
    for (let i = 0; i < side.paintMax; i++) {
      const drop = new Sprite(assets.texture('ui.paintDrop'))
      drop.anchor.set(0.5)
      drop.position.set(i * 22 + 10, 0)
      if (i >= side.paint) {
        drop.alpha = 0.22
        drop.tint = 0x777069
      }
      this.paintRow.addChild(drop)
    }
    const label = new Text({
      text: `${side.paint}/${side.paintMax}`,
      style: { fontFamily: 'Georgia, serif', fontSize: 13, fill: '#bfb7a4' },
    })
    label.anchor.set(0, 0.5)
    label.position.set(side.paintMax * 22 + 8, 0)
    this.paintRow.addChild(label)
  }

  private objectiveLabel(state: BattleState): string {
    const o = state.objective
    switch (o.kind) {
      case 'regicide': return 'Цель: срубить вражеского короля'
      case 'siege': return 'Цель: разбить ворота замка'
      case 'survive': return `Цель: продержаться ${o.turnsRequired} ходов (сейчас ${state.turn})`
      case 'escort': return 'Цель: довести гонца (золотая метка) до дальнего ряда'
    }
  }

  /** Объявление карты врага: бумажный ярлык сверху. */
  private async announceEnemyCard(defId: string): Promise<void> {
    let name = defId
    try { name = cardDef(defId).name } catch { /* и так сойдёт */ }
    const chip = new Container()
    const t = new Text({
      text: `Противник: «${name}»`,
      style: {
        fontFamily: 'Georgia, serif', fontSize: 15, fontWeight: 'bold',
        fill: cssColor(PAL.ink),
      },
    })
    t.anchor.set(0.5)
    const g = new Graphics()
    g.roundRect(-t.width / 2 - 14, -16, t.width + 28, 32, 4).fill(PAL.paper)
    chip.addChild(g, t)
    chip.position.set(this.lastW / 2, 30)
    chip.alpha = 0
    this.hud.addChild(chip)
    tween(chip, { alpha: 1, y: 40 }, { dur: 0.15 })
    await wait(0.85)
    await tween(chip, { alpha: 0 }, { dur: 0.2 }).done
    chip.destroy({ children: true })
  }

  // -------------------------------------------------------------------------
  // Оверлеи: промоушен и баннер конца боя

  private syncOverlaysFromState(): void {
    const state = this.host.getState()
    const needPromote =
      state.phase === 'promote' && state.promoting !== null &&
      (this.statePiece(state.promoting.piece)?.owner ?? 1) === 0
    if (needPromote && !this.promoteOverlay) this.rebuildPromoteOverlay()
    if (!needPromote && this.promoteOverlay) {
      this.promoteOverlay.destroy({ children: true })
      this.promoteOverlay = null
    }
    if (state.phase === 'ended' && state.result && !this.banner) {
      this.showBanner(state.result.winner === 0, state.result.reason)
    }
  }

  private rebuildPromoteOverlay(): void {
    this.promoteOverlay?.destroy({ children: true })
    this.promoteOverlay = null
    const state = this.host.getState()
    if (state.phase !== 'promote' || !state.promoting) return
    const { piece, options } = state.promoting

    const overlay = new Container()
    const dim = new Graphics()
    dim.rect(0, 0, this.lastW, this.lastH).fill({ color: PAL.bg, alpha: 0.62 })
    dim.eventMode = 'static' // блокирует клики по доске
    overlay.addChild(dim)

    const title = new Text({
      text: 'Мазок дошёл до края — выберите мутацию',
      style: {
        fontFamily: 'Georgia, serif', fontSize: 22, fontWeight: 'bold',
        fill: cssColor(PAL.paper),
      },
    })
    title.anchor.set(0.5)
    title.position.set(this.lastW / 2, this.lastH / 2 - 170)
    overlay.addChild(title)

    const cardW = 168, cardH = 216
    options.forEach((into, i) => {
      const opt = new Container()
      const bg = new Graphics()
      bg.roundRect(-cardW / 2, -cardH / 2, cardW, cardH, 10).fill(PAL.paper)
      bg.roundRect(-cardW / 2 + 5, -cardH / 2 + 5, cardW - 10, cardH - 10, 8)
        .stroke({ width: 2, color: PAL.ochre })
      opt.addChild(bg)

      const sp = new Sprite(assets.texture(`piece.vermilion.${into}`))
      sp.anchor.set(PIECE_TEX.anchorX, PIECE_TEX.anchorY)
      sp.scale.set(1.0)
      sp.position.set(0, cardH / 2 - 74)
      opt.addChild(sp)

      let label = into
      try { label = pieceType(into).name } catch { /* имя не критично */ }
      const name = new Text({
        text: label,
        style: {
          fontFamily: 'Georgia, serif', fontSize: 16, fontWeight: 'bold',
          fill: cssColor(PAL.ink), align: 'center',
          wordWrap: true, wordWrapWidth: cardW - 18,
        },
      })
      name.anchor.set(0.5, 0)
      name.position.set(0, cardH / 2 - 62)
      opt.addChild(name)

      opt.position.set(this.lastW / 2 + (i - (options.length - 1) / 2) * (cardW + 26), this.lastH / 2 + 10)
      opt.eventMode = 'static'
      opt.cursor = 'pointer'
      opt.on('pointerover', () => opt.scale.set(1.06))
      opt.on('pointerout', () => opt.scale.set(1))
      opt.on('pointertap', () => {
        if (this.host.tryAction({ t: 'promote', piece, into })) {
          this.promoteOverlay?.destroy({ children: true })
          this.promoteOverlay = null
        }
      })
      overlay.addChild(opt)
    })

    this.promoteOverlay = overlay
    this.stage?.uiLayer.addChild(overlay)
  }

  private showBanner(win: boolean, reason: string): void {
    if (this.banner) return
    const banner = new Container()
    const g = new Graphics()
    g.rect(-this.lastW, -70, this.lastW * 2, 140).fill({ color: PAL.bg, alpha: 0.78 })
    banner.addChild(g)
    const t = new Text({
      text: win ? 'КАРТИНА ЗАВЕРШЕНА' : 'КОЛЛАЖ РАЗОРВАН',
      style: {
        fontFamily: 'Georgia, serif', fontSize: 42, fontWeight: 'bold',
        fill: win ? cssColor(PAL.ochre) : cssColor(PAL.vermilion),
        letterSpacing: 4,
      },
    })
    t.anchor.set(0.5)
    banner.addChild(t)
    const sub = new Text({
      text: win ? 'победа · ' + reason : 'поражение · ' + reason,
      style: { fontFamily: 'Georgia, serif', fontSize: 15, fill: '#bfb7a4' },
    })
    sub.anchor.set(0.5)
    sub.position.set(0, 38)
    banner.addChild(sub)
    banner.position.set(this.lastW / 2, this.lastH / 2)
    this.banner = banner
    this.stage?.uiLayer.addChild(banner)
  }

  // -------------------------------------------------------------------------
  // Для transitions.ts

  collageParts(): {
    tiles: Sprite[]
    pieces: Container[]
    hand: HandView
    hud: Container
  } {
    return {
      tiles: this.boardView.allTiles().map(t => t.sprite),
      pieces: [...this.pieceViews.values()].map(v => v.root),
      hand: this.handView,
      hud: this.hud,
    }
  }

  destroy(): void {
    for (const d of this.disposers) d()
    this.disposers.length = 0
    this.drag?.destroy()
    this.promoteOverlay?.destroy({ children: true })
    this.banner?.destroy({ children: true })
    for (const view of this.pieceViews.values()) view.destroy()
    this.pieceViews.clear()
    this.handView.destroy()
    this.boardView.destroy()
    this.hud.destroy({ children: true })
  }
}
