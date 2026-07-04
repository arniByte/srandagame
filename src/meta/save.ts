import type { RunState } from './runState'

/**
 * Сейвы в localStorage. Аккуратно: в тестах/воркерах localStorage может
 * отсутствовать — все функции тихо деградируют.
 */

const RUN_KEY = 'cm.run.v1'
const PROFILE_KEY = 'cm.profile.v1'

export interface Profile {
  runsWon: number
  runsLost: number
  bestAct: number
}

const hasStorage = (): boolean => {
  try { return typeof localStorage !== 'undefined' } catch { return false }
}

export function saveRun(run: RunState): void {
  if (!hasStorage()) return
  try { localStorage.setItem(RUN_KEY, JSON.stringify(run)) } catch { /* quota */ }
}

export function loadRun(): RunState | null {
  if (!hasStorage()) return null
  try {
    const raw = localStorage.getItem(RUN_KEY)
    if (!raw) return null
    const run = JSON.parse(raw) as RunState
    if (run.v !== 1) return null
    return run
  } catch {
    return null
  }
}

export function clearRun(): void {
  if (!hasStorage()) return
  try { localStorage.removeItem(RUN_KEY) } catch { /* ignore */ }
}

export function loadProfile(): Profile {
  if (!hasStorage()) return { runsWon: 0, runsLost: 0, bestAct: 0 }
  try {
    const raw = localStorage.getItem(PROFILE_KEY)
    if (raw) return { runsWon: 0, runsLost: 0, bestAct: 0, ...JSON.parse(raw) }
  } catch { /* ignore */ }
  return { runsWon: 0, runsLost: 0, bestAct: 0 }
}

export function saveProfile(patch: Partial<Profile>): Profile {
  const cur = { ...loadProfile(), ...patch }
  if (hasStorage()) {
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(cur)) } catch { /* quota */ }
  }
  return cur
}
