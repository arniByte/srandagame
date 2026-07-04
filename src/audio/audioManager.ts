import { settings } from '../core/settings'
import { renderSfx, type SfxKey } from './synthSfx'

export type { SfxKey }

/**
 * WebAudio-менеджер: разблокировка на первый жест пользователя,
 * шины master → music/sfx, лёгкий рандомный detune (±6%), чтобы
 * повторяющиеся звуки не звучали «пулемётом».
 */
class AudioManager {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private musicBus: GainNode | null = null
  private sfxBus: GainNode | null = null
  private buffers = new Map<SfxKey, AudioBuffer>()
  private pending: SfxKey[] = []
  private initDone = false

  /** Навешивает разблокировку на первый жест. Вызывать один раз на буте. */
  init(): void {
    if (this.initDone) return
    this.initDone = true
    const unlock = (): void => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
      this.unlock()
    }
    window.addEventListener('pointerdown', unlock)
    window.addEventListener('keydown', unlock)
  }

  private unlock(): void {
    if (this.ctx) return
    try {
      this.ctx = new AudioContext()
    } catch { return /* нет WebAudio — играем молча */ }
    const ctx = this.ctx
    this.master = ctx.createGain()
    this.master.connect(ctx.destination)
    this.musicBus = ctx.createGain()
    this.musicBus.connect(this.master)
    this.sfxBus = ctx.createGain()
    this.sfxBus.connect(this.master)
    this.applyVolumes()
    if (ctx.state === 'suspended') void ctx.resume()
    // Проигрываем то, что запросили до разблокировки (максимум один — без каши).
    const first = this.pending[0]
    this.pending.length = 0
    if (first) this.sfx(first)
  }

  /** Применить громкости из settings (после изменения в меню). */
  applyVolumes(): void {
    if (this.musicBus) this.musicBus.gain.value = settings.musicVol
    if (this.sfxBus) this.sfxBus.gain.value = settings.sfxVol
    if (this.master) this.master.gain.value = 1
  }

  /** Одноразовый звук с ±6% detune. */
  sfx(key: SfxKey, volume = 1): void {
    const ctx = this.ctx
    if (!ctx || !this.sfxBus) {
      if (this.pending.length < 4) this.pending.push(key)
      return
    }
    let buf = this.buffers.get(key)
    if (!buf) {
      buf = renderSfx(ctx, key)
      this.buffers.set(key, buf)
    }
    const src = ctx.createBufferSource()
    src.buffer = buf
    // Визуальный слой: Math.random здесь допустим.
    src.playbackRate.value = 1 + (Math.random() * 2 - 1) * 0.06
    const gain = ctx.createGain()
    gain.gain.value = volume
    src.connect(gain)
    gain.connect(this.sfxBus)
    src.start()
  }

  /** Музыки в M1 нет — API-заглушка под будущие треки. */
  music(_key: string | null): void {
    /* заглушка: сюда встанет кроссфейд лупов */
  }

  get unlocked(): boolean {
    return this.ctx !== null
  }
}

export const audio = new AudioManager()
