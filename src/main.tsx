import { render } from 'preact'
import { loadContent } from './content'
import { ticker } from './core/ticker'
import { initResize } from './core/resize'
import { probeQuality } from './core/settings'
import { assets } from './assets/manifest'
import { audio } from './audio/audioManager'
import { initStage } from './render/stage'
import { mountDiorama } from './diorama/dioramaScene'
import { GameController } from './game/controller'
import { App } from './ui/App'
import './ui/styles.css'

/**
 * Бут: контент → рендеры (диорама + Pixi) → контроллер → Preact-оверлей.
 */
async function boot(): Promise<void> {
  loadContent()
  probeQuality()

  const app = document.getElementById('app') as HTMLElement
  initResize(app)

  const dioramaCanvas = document.getElementById('diorama') as HTMLCanvasElement
  const gameCanvas = document.getElementById('game') as HTMLCanvasElement
  const uiRoot = document.getElementById('ui') as HTMLElement

  mountDiorama(dioramaCanvas)
  const stage = await initStage(gameCanvas)
  await assets.init()
  audio.init()

  const game = new GameController(stage)

  // Тест-хуки для Playwright: ?test=1 ускоряет анимации и открывает движок.
  const params = new URLSearchParams(location.search)
  if (params.get('test') === '1') {
    ticker.speed = 4
    const w = window as unknown as Record<string, unknown>
    w.__cm = game
  }

  render(<App game={game} />, uiRoot)
  ticker.start()

  const bootEl = document.getElementById('boot')
  if (bootEl) {
    bootEl.style.opacity = '0'
    setTimeout(() => bootEl.remove(), 600)
  }
}

void boot()
