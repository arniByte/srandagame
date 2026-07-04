import * as THREE from 'three'
import { bus } from '../core/bus'
import { viewport } from '../core/resize'
import { resolveQuality } from '../core/settings'
import { ticker, TICK } from '../core/ticker'
import { DioramaFx } from './dioramaFx'
import {
  StaticDiorama, paintCastle, paintFrontEdge, paintHills, paintSky, paintSun,
} from './dioramaStatic'

/**
 * Театральная диорама за доской: ортокамера + 6 текстурированных плоскостей
 * на разных Z (небо, солнце Малевича, два слоя холмов, замок, передний
 * рваный край). Текстуры рисуются на canvas2d прямо в коде.
 * Мягкий параллакс за мышью (±6px), реакции на события — в DioramaFx.
 */

interface Layer {
  mesh: THREE.Mesh
  depth: number // множитель параллакса, px на полный ход мыши
  baseX: number
  baseY: number
}

export interface DioramaHandle {
  dispose(): void
}

export class DioramaScene implements DioramaHandle {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera: THREE.OrthographicCamera
  private layers: Layer[] = []
  private castle: THREE.Object3D | null = null
  private dimMat: THREE.MeshBasicMaterial
  private fx: DioramaFx
  private mouse = { x: 0, y: 0 }
  private smooth = { x: 0, y: 0 }
  private disposers: (() => void)[] = []

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false })
    this.renderer.setClearColor(0x14120f, 1)
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 2000)
    this.camera.position.z = 1000

    // Полноэкранное «притухание света».
    this.dimMat = new THREE.MeshBasicMaterial({
      color: 0x000000, transparent: true, opacity: 0, depthTest: false, depthWrite: false,
    })
    const dim = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.dimMat)
    dim.renderOrder = 99
    dim.position.z = 500
    this.scene.add(dim)
    this.dimLayer = dim

    this.fx = new DioramaFx({ camera: this.camera, castle: null, dimMaterial: this.dimMat })

    this.resize(viewport.w, viewport.h, viewport.dpr)
    this.disposers.push(bus.on('resize', ({ w, h, dpr }) => this.resize(w, h, dpr)))

    const onMove = (e: PointerEvent): void => {
      this.mouse.x = (e.clientX / Math.max(window.innerWidth, 1)) * 2 - 1
      this.mouse.y = (e.clientY / Math.max(window.innerHeight, 1)) * 2 - 1
    }
    window.addEventListener('pointermove', onMove)
    this.disposers.push(() => window.removeEventListener('pointermove', onMove))

    this.disposers.push(ticker.add((dt) => this.update(dt), TICK.DIORAMA))
  }

  private dimLayer: THREE.Mesh

  private canvasTexture(cv: HTMLCanvasElement): THREE.CanvasTexture {
    const tex = new THREE.CanvasTexture(cv)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.minFilter = THREE.LinearFilter
    return tex
  }

  private addLayer(
    cv: HTMLCanvasElement, w: number, h: number,
    x: number, y: number, z: number, depth: number, order: number,
  ): THREE.Mesh {
    const mat = new THREE.MeshBasicMaterial({
      map: this.canvasTexture(cv), transparent: true, depthTest: false, depthWrite: false,
    })
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat)
    mesh.position.set(x, y, z)
    mesh.renderOrder = order
    this.scene.add(mesh)
    this.layers.push({ mesh, depth, baseX: x, baseY: y })
    return mesh
  }

  /** Полная пересборка слоёв под размер вьюпорта (ресайзы редки). */
  private rebuildLayers(w: number, h: number): void {
    for (const l of this.layers) {
      this.scene.remove(l.mesh)
      l.mesh.geometry.dispose()
      const m = l.mesh.material as THREE.MeshBasicMaterial
      m.map?.dispose()
      m.dispose()
    }
    this.layers.length = 0

    // Координаты: центр экрана (0,0), x вправо, y вверх.
    this.addLayer(paintSky(w, h), w + 24, h + 24, 0, 0, -900, 0, 0)
    const sun = Math.min(w, h) * 0.34
    this.addLayer(paintSun(sun), sun, sun, -w * 0.31, h * 0.24, -850, 1.5, 1)
    this.addLayer(paintHills(w * 1.15, h * 0.5, 0x2a2013, 41, 0.35), w * 1.15, h * 0.5, 0, -h * 0.17, -800, 2.5, 2)
    const cw = Math.min(w * 0.42, h * 0.62)
    this.castle = this.addLayer(paintCastle(cw, cw * 0.8), cw, cw * 0.8, w * 0.26, -h * 0.06, -750, 3.2, 3)
    this.addLayer(paintHills(w * 1.2, h * 0.45, 0x191510, 88, 0.3), w * 1.2, h * 0.45, 0, -h * 0.31, -700, 4.5, 4)
    this.addLayer(paintFrontEdge(w * 1.15, h * 0.24), w * 1.15, h * 0.24, 0, -h * 0.45, -650, 6, 5)

    this.dimLayer.scale.set(w * 1.4, h * 1.4, 1)
    this.fx.dispose()
    this.fx = new DioramaFx({ camera: this.camera, castle: this.castle, dimMaterial: this.dimMat })
  }

  private resize(w: number, h: number, dpr: number): void {
    this.renderer.setPixelRatio(Math.min(dpr, 2))
    this.renderer.setSize(w, h, false)
    this.camera.left = -w / 2
    this.camera.right = w / 2
    this.camera.top = h / 2
    this.camera.bottom = -h / 2
    this.camera.updateProjectionMatrix()
    this.rebuildLayers(w, h)
  }

  private update(dt: number): void {
    // Параллакс: плавное следование за мышью.
    const k = Math.min(dt * 6, 1)
    this.smooth.x += (this.mouse.x - this.smooth.x) * k
    this.smooth.y += (this.mouse.y - this.smooth.y) * k
    for (const l of this.layers) {
      l.mesh.position.x = l.baseX - this.smooth.x * l.depth
      l.mesh.position.y = l.baseY + this.smooth.y * l.depth * 0.6
    }
    if (this.castle) this.fx.rebase()

    const shake = this.fx.update(dt)
    this.camera.position.x = shake.x
    this.camera.position.y = shake.y

    this.renderer.render(this.scene, this.camera)
  }

  dispose(): void {
    for (const d of this.disposers) d()
    this.fx.dispose()
    for (const l of this.layers) {
      l.mesh.geometry.dispose()
      const m = l.mesh.material as THREE.MeshBasicMaterial
      m.map?.dispose()
      m.dispose()
    }
    this.dimLayer.geometry.dispose()
    this.dimMat.dispose()
    this.renderer.dispose()
  }
}

/** Монтирует диораму по тиру качества: low → статичный canvas2d-фон. */
export function mountDiorama(canvas: HTMLCanvasElement): DioramaHandle {
  if (resolveQuality() === 'low') return new StaticDiorama(canvas)
  try {
    return new DioramaScene(canvas)
  } catch {
    // WebGL недоступен — падаем на статику.
    return new StaticDiorama(canvas)
  }
}
