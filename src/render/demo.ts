import {
  apply, encounterDef, legalActions, legalMovesFor, legalTargetsFor,
  newBattle, rngInt, seedFromString, validate,
} from '../engine'
import type { Action, BattleState, EngineEvent } from '../engine/types'
import { STARTER_DECK, STARTER_ROSTER, loadContent } from '../content'
import { bus } from '../core/bus'
import { initResize } from '../core/resize'
import { probeQuality } from '../core/settings'
import { ticker, TICK } from '../core/ticker'
import { audio } from '../audio/audioManager'
import { assets } from '../assets/manifest'
import { mountDiorama, type DioramaHandle } from '../diorama/dioramaScene'
import { initStage, type Stage } from './stage'
import { BattleScene, type BattleSceneHost } from './battleScene'
import { collageIn } from './transitions'

/**
 * SMOKE-демо для интегратора: собирает бой a1-skirmish-pawns со стартовой
 * армией/колодой и играет за ОБЕ стороны случайными легальными действиями
 * по таймеру. Пользователь может вмешиваться на ходу игрока (клики/карты) —
 * валидность всё равно охраняет validate().
 *
 * Использование из main.ts:
 *   const demo = await mountBattleDemo({ root: document.getElementById('app')! })
 */

export interface DemoHostElements {
  root: HTMLElement
}

export interface DemoHandle {
  destroy(): void
}

function mkCanvas(z: number): HTMLCanvasElement {
  const cv = document.createElement('canvas')
  cv.style.position = 'absolute'
  cv.style.inset = '0'
  cv.style.width = '100%'
  cv.style.height = '100%'
  cv.style.zIndex = String(z)
  return cv
}

export async function mountBattleDemo(hostElements: DemoHostElements): Promise<DemoHandle> {
  loadContent()
  probeQuality()

  const root = hostElements.root
  if (!root.style.position) root.style.position = 'relative'
  root.style.overflow = 'hidden'
  const threeCanvas = mkCanvas(0)
  const pixiCanvas = mkCanvas(1)
  root.appendChild(threeCanvas)
  root.appendChild(pixiCanvas)

  initResize(root)
  ticker.start()
  audio.init()

  const diorama: DioramaHandle = mountDiorama(threeCanvas)
  const stage: Stage = await initStage(pixiCanvas)
  await assets.init()

  // --- Бой.
  let state: BattleState = newBattle({
    encounter: encounterDef('a1-skirmish-pawns'),
    roster: STARTER_ROSTER.map((r, i) => ({ rid: `demo-${i}`, type: r.type, traits: [] })),
    deck: STARTER_DECK.map(def => ({ def, upgraded: false })),
    relics: [],
    seed: 'demo-visual',
  })

  let animating = false
  let animChain: Promise<void> = Promise.resolve()

  const playEvents = (events: EngineEvent[]): void => {
    if (events.length === 0) return
    bus.emit('engine', { events }) // диорама и прочие слушатели
    animating = true
    animChain = animChain
      .then(() => scene.onEngineEvents(events))
      .then(() => { animating = false })
  }

  const host: BattleSceneHost = {
    getState: () => state,
    tryAction(action: Action): boolean {
      const v = validate(state, action)
      if (!v.ok) return false
      const res = apply(state, action)
      state = res.state
      playEvents(res.events)
      return true
    },
    inputEnabled: () => !animating && state.result === null,
    legalMovesFor: (id) => legalMovesFor(state, id),
    legalTargetsFor: (iid) => legalTargetsFor(state, iid),
  }

  const scene = new BattleScene(host)
  scene.mount(stage)
  scene.syncImmediate()
  await collageIn(scene)

  // --- Драйвер случайной игры (сидированный rng — повторяемое демо).
  const drng = seedFromString('demo-driver')
  let cooldown = 0.8
  let cardsThisPly = 0
  let lastPly = state.ply

  const pickAction = (): Action => {
    const acts = legalActions(state)
    const promotes = acts.filter(a => a.t === 'promote')
    if (promotes.length > 0) return promotes[rngInt(drng, promotes.length)] as Action

    const moves = acts.filter(a => a.t === 'move')
    const captures = moves.filter(a => {
      if (a.t !== 'move') return false
      const target = state.pieces.find(p => p.pos === a.to)
      return !!target && target.owner !== state.active
    })
    const cards = acts.filter(a => a.t === 'playCard')

    if (captures.length > 0 && rngInt(drng, 100) < 85) {
      return captures[rngInt(drng, captures.length)] as Action
    }
    if (moves.length > 0 && rngInt(drng, 100) < 72) {
      return moves[rngInt(drng, moves.length)] as Action
    }
    if (cards.length > 0 && cardsThisPly < 2 && rngInt(drng, 100) < 65) {
      return cards[rngInt(drng, cards.length)] as Action
    }
    return { t: 'endTurn' }
  }

  const offDriver = ticker.add((dt) => {
    if (animating || state.result !== null) return
    cooldown -= dt
    if (cooldown > 0) return
    cooldown = 0.55 + rngInt(drng, 40) / 100

    if (state.ply !== lastPly) {
      lastPly = state.ply
      cardsThisPly = 0
    }
    const action = pickAction()
    if (action.t === 'playCard') cardsThisPly++
    if (!host.tryAction(action)) host.tryAction({ t: 'endTurn' })
  }, TICK.GAME)

  return {
    destroy(): void {
      offDriver()
      scene.destroy()
      stage.destroy()
      diorama.dispose()
      pixiCanvas.remove()
      threeCanvas.remove()
    },
  }
}
