import * as THREE from 'three'
import { bus, type BiomeName } from '../core/bus'
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

// Сгенерённый арт диорамы (public/assets/bg). Кэш переживает ресайзы.
const texCache = new Map<string, THREE.Texture | null>()
const loader = new THREE.TextureLoader()

/** Пробует подменить canvas-текстуру слоя сгенерённой; тихо молчит, если нет файла. */
function tryArt(url: string, apply: (tex: THREE.Texture) => void): void {
  if (texCache.has(url)) {
    const t = texCache.get(url)
    if (t) apply(t)
    return
  }
  loader.load(
    url,
    tex => {
      tex.colorSpace = THREE.SRGBColorSpace
      tex.minFilter = THREE.LinearFilter
      texCache.set(url, tex)
      apply(tex)
    },
    undefined,
    () => texCache.set(url, null),
  )
}

interface SwapOpts {
  /** Сохранить аспект картинки при заданной ширине. */
  keepAspectW?: number
  /** Прижать нижний край плоскости к этому экранному Y. */
  anchorBottomY?: number
  /** Приглушение яркости (0..1), чтобы фон не спорил с доской. */
  mute?: number
}

function swapMap(mesh: THREE.Mesh, tex: THREE.Texture, opts: SwapOpts = {}): void {
  const m = mesh.material as THREE.MeshBasicMaterial
  m.map = tex
  m.needsUpdate = true
  if (opts.mute !== undefined) m.color.setScalar(opts.mute)
  const geo = mesh.geometry as THREE.PlaneGeometry
  const gw = geo.parameters.width, gh = geo.parameters.height
  if (opts.keepAspectW && tex.image) {
    const img = tex.image as { width: number; height: number }
    const wantH = opts.keepAspectW * (img.height / img.width)
    mesh.scale.set(opts.keepAspectW / gw, wantH / gh, 1)
  }
  if (opts.anchorBottomY !== undefined) {
    mesh.position.y = opts.anchorBottomY + (gh * mesh.scale.y) / 2
  }
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

    this.disposers.push(bus.on('biome', ({ name }) => this.setBiome(name)))
    this.disposers.push(ticker.add((dt) => this.update(dt), TICK.DIORAMA))
  }

  /** Небо и настроение по типу локации: закат / ночь (элита) / багровое (босс). */
  private setBiome(name: BiomeName): void {
    if (name === this.biome) return
    this.biome = name
    this.applyBiome()
  }

  private applyBiome(): void {
    const sky = this.skyMesh
    if (sky) {
      const url = this.biome === 'dusk' ? '/assets/bg/sky.webp' : `/assets/bg/sky-${this.biome}.webp`
      tryArt(url, t => swapMap(sky, t, { mute: this.biome === 'night' ? 0.9 : 0.82 }))
    }
    if (this.baseDimMat) {
      this.baseDimMat.opacity = this.biome === 'night' ? 0.44 : this.biome === 'blood' ? 0.3 : 0.34
    }
    for (const c of this.clouds) {
      const m = c.mesh.material as THREE.MeshBasicMaterial
      m.opacity = this.biome === 'night' ? 0.35 : 0.7
    }
  }

  private dimLayer: THREE.Mesh
  private biome: BiomeName = 'dusk'
  private skyMesh: THREE.Mesh | null = null
  private baseDimMat: THREE.MeshBasicMaterial | null = null
  private clouds: { mesh: THREE.Mesh; speed: number }[] = []
  private skyT = 0
  private dove: THREE.Mesh | null = null
  private doveT = 0
  private doveNext = 7
  private doveDir = 1
  private viewW = 1280
  private viewH = 720

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
    const sky = this.addLayer(paintSky(w, h), w + 24, h + 24, 0, 0, -900, 0, 0)
    this.skyMesh = sky
    const sun = Math.min(w, h) * 0.34
    const sunMesh = this.addLayer(paintSun(sun), sun, sun, -w * 0.31, h * 0.24, -850, 1.5, 1)
    // Солнце уже нарисовано в сгенерённом небе — кодовое прячем.
    tryArt('/assets/bg/sky.webp', t => { swapMap(sky, t, { mute: 0.82 }); sunMesh.visible = false })

    // Дрейфующие бумажные облака (если арт сгенерирован).
    this.clouds = []
    for (const [i, urlName] of ['cloud-1', 'cloud-2'].entries()) {
      const cw2 = w * (0.22 + i * 0.09)
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(cw2, cw2 * 0.4),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthTest: false, depthWrite: false }),
      )
      mesh.renderOrder = 1
      mesh.position.set(-w / 2 + i * w * 0.6, h * (0.3 - i * 0.13), -860)
      this.scene.add(mesh)
      this.layers.push({ mesh, depth: 1 + i * 0.7, baseX: mesh.position.x, baseY: mesh.position.y })
      const entry = { mesh, speed: (6 + i * 4) }
      this.clouds.push(entry)
      tryArt(`/assets/bg/${urlName}.webp`, t => {
        const m = mesh.material as THREE.MeshBasicMaterial
        m.map = t
        m.opacity = 0.7
        m.needsUpdate = true
      })
    }
    const hillsFar = this.addLayer(paintHills(w * 1.18, h * 0.36, 0x2a2013, 41, 0.35), w * 1.18, h * 0.36, 0, -h * 0.27, -800, 2.5, 2)
    tryArt('/assets/bg/hills-far.webp', t => swapMap(hillsFar, t, { mute: 0.68 }))
    const cw = Math.min(w * 0.42, h * 0.62)
    const castleMesh = this.addLayer(paintCastle(cw, cw * 0.8), cw, cw * 0.8, w * 0.26, -h * 0.06, -750, 3.2, 3)
    this.castle = castleMesh
    tryArt('/assets/bg/castle.webp', t =>
      swapMap(castleMesh, t, { keepAspectW: cw, anchorBottomY: -h * 0.30, mute: 0.9 }))
    const hillsNear = this.addLayer(paintHills(w * 1.3, h * 0.32, 0x191510, 88, 0.3), w * 1.3, h * 0.32, 0, -h * 0.38, -700, 4.5, 4)
    tryArt('/assets/bg/hills-near.webp', t => swapMap(hillsNear, t, { mute: 0.55 }))
    this.addLayer(paintFrontEdge(w * 1.15, h * 0.24), w * 1.15, h * 0.24, 0, -h * 0.45, -650, 6, 5)

    // Постоянное лёгкое затемнение фона: доска и фигуры должны солировать.
    const baseDimMat = new THREE.MeshBasicMaterial({
      color: 0x14120f, transparent: true, opacity: 0.34, depthTest: false, depthWrite: false,
    })
    this.baseDimMat = baseDimMat
    const baseDim = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.5, h * 1.5), baseDimMat)
    baseDim.renderOrder = 49
    baseDim.position.z = 400
    this.scene.add(baseDim)
    this.layers.push({ mesh: baseDim, depth: 0, baseX: 0, baseY: 0 })
    // Биом мог смениться до пересборки слоёв.
    this.applyBiome()

    // Голубь-путешественник: изредка пересекает небо.
    this.setupDove(w, h)

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

  private setupDove(w: number, h: number): void {
    this.viewW = w
    this.viewH = h
    if (this.dove) return
    tryArt('/assets/pieces/vermilion_dove.webp', tex => {
      const size = 46
      const img = tex.image as { width: number; height: number }
      const mat = new THREE.MeshBasicMaterial({
        map: tex, transparent: true, depthTest: false, depthWrite: false, opacity: 0.92,
      })
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(size, size * (img.height / img.width)), mat)
      mesh.renderOrder = 2
      mesh.position.set(-w, h * 0.3, -840)
      mesh.visible = false
      this.scene.add(mesh)
      this.dove = mesh
    })
  }

  /** Полёт голубя: степпед-взмахи (стоп-моушен), редкие пролёты. */
  private updateDove(dt: number): void {
    const dove = this.dove
    if (!dove) return
    this.doveT += dt
    if (!dove.visible) {
      if (this.doveT >= this.doveNext) {
        // Новый пролёт.
        this.doveDir = Math.random() < 0.5 ? 1 : -1
        dove.position.x = -this.doveDir * (this.viewW / 2 + 60)
        dove.position.y = this.viewH * (0.16 + Math.random() * 0.2)
        dove.scale.x = this.doveDir >= 0 ? 1 : -1
        dove.visible = true
      }
      return
    }
    dove.position.x += this.doveDir * dt * this.viewW * 0.055
    // Взмахи 6 шагов/с: жёсткое переключение «крылья вверх/вниз».
    const flap = Math.floor(this.doveT * 6) % 2
    dove.scale.y = flap === 0 ? 1 : 0.82
    dove.position.y += Math.sin(this.doveT * 1.7) * dt * 6
    if (Math.abs(dove.position.x) > this.viewW / 2 + 80) {
      dove.visible = false
      this.doveT = 0
      this.doveNext = 12 + Math.random() * 16
    }
  }

  private update(dt: number): void {
    this.updateDove(dt)
    this.skyT += dt

    // Небо медленно «дышит», облака дрейфуют с заворотом.
    if (this.skyMesh) {
      const p = 1 + Math.sin(this.skyT * 0.14) * 0.012
      this.skyMesh.scale.set(p, p, 1)
    }
    for (const c of this.clouds) {
      c.mesh.position.x += c.speed * dt
      const layer = this.layers.find(l => l.mesh === c.mesh)
      if (layer) layer.baseX += c.speed * dt
      if (layer && layer.baseX > this.viewW / 2 + c.mesh.scale.x * 300 + 300) {
        layer.baseX = -this.viewW / 2 - 300
      }
      c.mesh.position.y += Math.sin(this.skyT * 0.4 + c.speed) * dt * 2
    }

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
