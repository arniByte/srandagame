import { rngInt } from '../engine/rng'
import { allCards, allRelics, encounterDef, pieceType } from '../engine/registry'
import type { RunState } from './runState'

/**
 * Награды и ассортимент лавки. Мутируют run.rng (вызывать на клоне
 * или через редьюсеры выше по стеку) — здесь принимаем RunState и
 * возвращаем данные, не меняя ничего кроме rng.
 */

const RARITY_WEIGHT: Record<string, number> = { common: 60, uncommon: 30, rare: 10 }

function pickCardDefs(run: RunState, n: number): string[] {
  const cards = allCards()
  const pool: { id: string; w: number }[] = cards.map(c => ({
    id: c.id, w: RARITY_WEIGHT[c.rarity] ?? 10,
  }))
  const out: string[] = []
  for (let i = 0; i < n && pool.length > 0; i++) {
    const total = pool.reduce((s, p) => s + p.w, 0)
    let roll = rngInt(run.rng, total)
    let idx = 0
    for (let k = 0; k < pool.length; k++) {
      roll -= (pool[k] as { w: number }).w
      if (roll < 0) { idx = k; break }
    }
    out.push((pool[idx] as { id: string }).id)
    pool.splice(idx, 1) // без дублей в одном предложении
  }
  return out
}

export interface BattleReward {
  gold: number
  cardChoices: string[]
  relic: string | null
}

/** Награда после победы в бою на текущем узле. */
export function rollBattleReward(run: RunState, encounterId: string): BattleReward {
  const enc = encounterDef(encounterId)
  const [lo, hi] = enc.gold
  const gold = lo + rngInt(run.rng, Math.max(1, hi - lo + 1))
  const cardChoices = pickCardDefs(run, 3)
  let relic: string | null = null
  if (enc.elite || enc.boss) {
    const owned = new Set(run.relics)
    const avail = allRelics().filter(r => !owned.has(r.id))
    if (avail.length > 0) relic = (avail[rngInt(run.rng, avail.length)] as { id: string }).id
  }
  return { gold, cardChoices, relic }
}

export interface ShopStock {
  cards: { def: string; price: number }[]
  relics: { id: string; price: number }[]
  recruit: { type: string; price: number; name: string } | null
  removalPrice: number
}

const CARD_PRICE: Record<string, [number, number]> = {
  common: [45, 55], uncommon: [60, 75], rare: [90, 110],
}

const RECRUITS: { type: string; price: number; name: string }[] = [
  { type: 'knight', price: 90, name: 'Наёмный конь' },
  { type: 'bishop', price: 95, name: 'Странствующий слон' },
  { type: 'rook', price: 140, name: 'Осадная башня' },
  { type: 'dove', price: 120, name: 'Почтовый голубь' },
]

export function rollShop(run: RunState): ShopStock {
  const cardDefs = pickCardDefs(run, 5)
  const cardsById = new Map(allCards().map(c => [c.id, c]))
  const cards = cardDefs.map(def => {
    const rarity = cardsById.get(def)?.rarity ?? 'common'
    const [lo, hi] = CARD_PRICE[rarity] ?? [50, 60]
    return { def, price: lo + rngInt(run.rng, hi - lo + 1) }
  })

  const owned = new Set(run.relics)
  const availRelics = allRelics().filter(r => !owned.has(r.id))
  const relics: { id: string; price: number }[] = []
  const nRelics = Math.min(availRelics.length, 1 + rngInt(run.rng, 2))
  const shuffled = availRelics.slice()
  for (let i = 0; i < nRelics; i++) {
    const k = rngInt(run.rng, shuffled.length)
    const r = shuffled.splice(k, 1)[0] as { id: string }
    relics.push({ id: r.id, price: 120 + rngInt(run.rng, 41) })
  }

  const rec = RECRUITS[rngInt(run.rng, RECRUITS.length)] as typeof RECRUITS[number]
  // Рекрут валиден, только если тип зарегистрирован (страховка).
  const recruit = pieceType(rec.type) ? rec : null

  return { cards, relics, recruit, removalPrice: 75 }
}
