import { bus, type QualityTier } from './bus'

interface Settings {
  quality: QualityTier | 'auto'
  musicVol: number
  sfxVol: number
}

const KEY = 'cm.settings.v1'

const defaults: Settings = { quality: 'auto', musicVol: 0.7, sfxVol: 0.9 }

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { ...defaults, ...JSON.parse(raw) }
  } catch { /* повреждённый сейв настроек не должен ломать игру */ }
  return { ...defaults }
}

export const settings = load()

export function saveSettings(patch: Partial<Settings>): void {
  Object.assign(settings, patch)
  try { localStorage.setItem(KEY, JSON.stringify(settings)) } catch { /* quota */ }
  if (patch.quality) bus.emit('quality', { tier: resolveQuality() })
}

let probed: QualityTier = 'high'

/** Автоопределение тира по железу; вызывается один раз на буте. */
export function probeQuality(): QualityTier {
  const cores = navigator.hardwareConcurrency ?? 4
  const mem = (navigator as { deviceMemory?: number }).deviceMemory ?? 8
  if (cores <= 2 || mem <= 2) probed = 'low'
  else if (cores <= 4 || mem <= 4) probed = 'medium'
  else probed = 'high'
  return probed
}

export function resolveQuality(): QualityTier {
  return settings.quality === 'auto' ? probed : settings.quality
}
