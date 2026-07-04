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
// Каллиграфия: кириллические рукописные шрифты (self-hosted).
import '@fontsource/amatic-sc/400.css'
import '@fontsource/amatic-sc/700.css'
import '@fontsource/amatic-sc/cyrillic-400.css'
import '@fontsource/amatic-sc/cyrillic-700.css'
import '@fontsource/neucha/400.css'
import '@fontsource/neucha/cyrillic-400.css'
import '@fontsource/caveat/700.css'
import '@fontsource/caveat/cyrillic-700.css'

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

  // Дожидаемся шрифтов ДО создания Pixi-текстов (иначе запекутся фолбэки).
  try {
    await Promise.race([
      Promise.all([
        document.fonts.load('700 30px "Amatic SC"'),
        document.fonts.load('16px Neucha'),
        document.fonts.load('700 17px Caveat'),
      ]),
      new Promise(r => setTimeout(r, 2500)),
    ])
  } catch { /* без шрифтов тоже живём */ }

  mountDiorama(dioramaCanvas)
  const stage = await initStage(gameCanvas)
  await assets.init()
  audio.init()

  // Бумажная текстура для DOM-панелей (если арт сгенерирован).
  if (assets.entry('ui.paper')) {
    document.documentElement.style.setProperty(
      '--paper-img', `url(${assets.entry('ui.paper')?.src})`)
  }

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
