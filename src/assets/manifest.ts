import { Assets, Texture } from 'pixi.js'
import { bus } from '../core/bus'
import { placeholderTexture } from './placeholders'

/**
 * Библиотека ассетов. Источник истины — /assets/manifest.json
 * (его может НЕ быть или он может быть пуст — тогда всё рисуют
 * кодовые плейсхолдеры). reload() — горячая подмена арта.
 *
 * Ключи: piece.{vermilion|ink}.{type}, tile.{light|dark},
 * card.frame.{rarity}, card.illus.{cardId}, ui.*.
 */

export interface ManifestEntry {
  src: string
  /** Нормированный якорь [x, y] (по умолчанию — свой у каждого класса спрайтов). */
  pivot?: [number, number]
  /** Масштаб в мире относительно плейсхолдерного дизайн-бокса. */
  worldScale?: number
}

type Manifest = Record<string, ManifestEntry>

const MANIFEST_URL = '/assets/manifest.json'

class AssetLibrary {
  private manifest: Manifest = {}
  private loaded = new Map<string, Texture>()
  private rev = 0

  /** Грузит манифест и все его текстуры. Отсутствие манифеста — норма. */
  async init(): Promise<void> {
    await this.fetchAndLoad()
  }

  /** Текстура по ключу: из манифеста, иначе кодовый плейсхолдер. */
  texture(key: string): Texture {
    return this.loaded.get(key) ?? placeholderTexture(key)
  }

  /** Метаданные записи (pivot/worldScale), если арт из манифеста. */
  entry(key: string): ManifestEntry | undefined {
    return this.loaded.has(key) ? this.manifest[key] : undefined
  }

  /** Горячая подмена: перечитать манифест, дозагрузить, оповестить сцены. */
  async reload(): Promise<void> {
    const keys = await this.fetchAndLoad()
    bus.emit('assetsSwapped', { keys })
  }

  private async fetchAndLoad(): Promise<string[]> {
    this.rev++
    let next: Manifest = {}
    try {
      const res = await fetch(`${MANIFEST_URL}?v=${this.rev}`)
      if (res.ok) {
        const json: unknown = await res.json()
        if (json && typeof json === 'object') next = json as Manifest
      }
    } catch { /* нет манифеста — работаем на плейсхолдерах */ }

    this.manifest = next
    const keys: string[] = []
    for (const [key, entry] of Object.entries(next)) {
      if (!entry?.src) continue
      try {
        const alias = `${key}@${this.rev}`
        const tex = await Assets.load<Texture>({ alias, src: entry.src })
        // Мипмапы: спрайты сильно уменьшаются — без них края «звенят».
        tex.source.autoGenerateMipmaps = true
        tex.source.update()
        this.loaded.set(key, tex)
        keys.push(key)
      } catch { /* битый ассет не должен ломать бой — остаётся плейсхолдер */ }
    }
    return keys
  }
}

export const assets = new AssetLibrary()
