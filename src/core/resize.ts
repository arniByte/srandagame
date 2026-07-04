import { bus } from './bus'

export interface Viewport { w: number; h: number; dpr: number }

export const viewport: Viewport = { w: 1280, h: 720, dpr: 1 }

/** Единый ResizeObserver: считает логический вьюпорт и оповещает оба рендерера. */
export function initResize(root: HTMLElement): void {
  const apply = () => {
    const r = root.getBoundingClientRect()
    viewport.w = Math.max(1, Math.round(r.width))
    viewport.h = Math.max(1, Math.round(r.height))
    viewport.dpr = Math.min(window.devicePixelRatio || 1, 2)
    bus.emit('resize', { ...viewport })
  }
  new ResizeObserver(apply).observe(root)
  apply()
}
