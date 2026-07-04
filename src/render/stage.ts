import { Application, Container } from 'pixi.js'
import { bus } from '../core/bus'
import { viewport } from '../core/resize'
import { ticker, TICK } from '../core/ticker'
import { initPlaceholders } from '../assets/placeholders'

/**
 * Pixi Application v8 поверх диорамы (прозрачный фон). autoStart:false —
 * рендер строго из единого тикера (TICK.PIXI). Корневые контейнеры-слои
 * и экранная тряска (bus 'shake') живут здесь.
 */

export interface Stage {
  app: Application
  root: Container
  boardLayer: Container
  piecesLayer: Container
  fxLayer: Container
  handLayer: Container
  dragLayer: Container
  uiLayer: Container
  destroy(): void
}

export async function initStage(canvas: HTMLCanvasElement): Promise<Stage> {
  const app = new Application()
  await app.init({
    canvas,
    width: viewport.w,
    height: viewport.h,
    resolution: viewport.dpr,
    autoDensity: true,
    backgroundAlpha: 0,
    antialias: true,
    autoStart: false,
  })
  // Плейсхолдерам нужен рендерер для RenderTexture.
  initPlaceholders(app.renderer)

  const root = new Container()
  app.stage.addChild(root)

  const boardLayer = new Container()
  const piecesLayer = new Container()
  const fxLayer = new Container()
  const handLayer = new Container()
  const dragLayer = new Container()
  const uiLayer = new Container()
  // Порядок отрисовки: доска → фигуры → FX → HUD → рука → перетаскиваемая карта.
  root.addChild(boardLayer, piecesLayer, fxLayer, uiLayer, handLayer, dragLayer)
  // Фигуры сортируются по y (кто ниже — тот ближе).
  piecesLayer.sortableChildren = true

  // --- Экранная тряска: смещение корня с экспоненциальным затуханием.
  let shakePower = 0
  const offShake = bus.on('shake', ({ power }) => {
    shakePower = Math.max(shakePower, power)
  })

  const offResize = bus.on('resize', ({ w, h, dpr }) => {
    app.renderer.resolution = dpr
    app.renderer.resize(w, h)
  })

  const offTick = ticker.add((dt) => {
    if (shakePower > 0.3) {
      root.x = (Math.random() * 2 - 1) * shakePower
      root.y = (Math.random() * 2 - 1) * shakePower
      shakePower *= Math.pow(0.0005, dt)
    } else if (shakePower !== 0) {
      shakePower = 0
      root.x = 0
      root.y = 0
    }
    app.renderer.render(app.stage)
  }, TICK.PIXI)

  return {
    app, root, boardLayer, piecesLayer, fxLayer, handLayer, dragLayer, uiLayer,
    destroy(): void {
      offTick()
      offShake()
      offResize()
      app.destroy(false, { children: true, texture: false })
    },
  }
}
