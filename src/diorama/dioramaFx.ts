import type * as THREE from 'three'
import { bus } from '../core/bus'

/**
 * Event-реакции диорамы (слушает шину, сам ничего не рендерит):
 * - взятие фигуры → свет «притухает» на 80 мс;
 * - удар по воротам → замок дрожит;
 * - bus 'shake' → микротряска камеры.
 */

export interface FxRefs {
  camera: THREE.Camera
  castle: THREE.Object3D | null
  /** Полноэкранная тёмная плоскость (материал с opacity). */
  dimMaterial: THREE.Material & { opacity: number }
}

export class DioramaFx {
  private dimT = 0
  private trembleT = 0
  private shakePower = 0
  private disposers: (() => void)[] = []
  private castleBaseX = 0

  constructor(private refs: FxRefs) {
    this.castleBaseX = refs.castle ? refs.castle.position.x : 0

    this.disposers.push(bus.on('engine', ({ events }) => {
      for (const ev of events) {
        if (ev.e === 'captured' || ev.e === 'destroyed') this.dimT = 0.08
        if (ev.e === 'bumped' || ev.e === 'curatorShift') this.trembleT = 0.4
        if (ev.e === 'battleEnded') this.dimT = 0.25
      }
    }))
    this.disposers.push(bus.on('shake', ({ power }) => {
      this.shakePower = Math.max(this.shakePower, power * 0.4)
    }))
  }

  /** Позиция замка сменилась при ресайзе — перезапомнить базу. */
  rebase(): void {
    this.castleBaseX = this.refs.castle ? this.refs.castle.position.x : 0
  }

  /** Возвращает смещение камеры {x,y} на этот кадр. */
  update(dt: number): { x: number; y: number } {
    // Притухание света.
    if (this.dimT > 0) {
      this.dimT -= dt
      this.refs.dimMaterial.opacity = this.dimT > 0 ? 0.38 : 0
    }

    // Дрожь замка.
    const castle = this.refs.castle
    if (castle) {
      if (this.trembleT > 0) {
        this.trembleT -= dt
        const k = Math.max(this.trembleT, 0) * 8
        castle.position.x = this.castleBaseX + (Math.random() * 2 - 1) * k
      } else if (castle.position.x !== this.castleBaseX) {
        castle.position.x = this.castleBaseX
      }
    }

    // Микротряска камеры (затухание).
    let sx = 0, sy = 0
    if (this.shakePower > 0.2) {
      sx = (Math.random() * 2 - 1) * this.shakePower
      sy = (Math.random() * 2 - 1) * this.shakePower
      this.shakePower *= Math.pow(0.0001, dt) // быстрое экспоненциальное затухание
    } else {
      this.shakePower = 0
    }
    return { x: sx, y: sy }
  }

  dispose(): void {
    for (const d of this.disposers) d()
    this.disposers.length = 0
  }
}
