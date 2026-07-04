import { loadContent } from './content'
import { ticker } from './core/ticker'
import { initResize } from './core/resize'
import { probeQuality } from './core/settings'

/**
 * Точка входа. Пока движок обрастает рендером, это минимальный бут:
 * контент + тикер + резайз. Слои подключаются по мере готовности модулей.
 */
loadContent()
probeQuality()

const app = document.getElementById('app') as HTMLElement
initResize(app)
ticker.start()

const boot = document.getElementById('boot')
if (boot) {
  setTimeout(() => { boot.style.opacity = '0' }, 400)
}
