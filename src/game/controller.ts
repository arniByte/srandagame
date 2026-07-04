import type { Action, BattleState, EngineEvent, PieceTrait, Sq } from '../engine/types'
import {
  applyMut, decodeState, encounterDef, hashState, legalMovesFor, legalTargetsFor,
  newBattle, validate,
} from '../engine'
import { GuestSession, HostSession, type GuestDelegate, type HostDelegate } from '../net/session'
import { makeRoomCode, normalizeRoomCode } from '../net/protocol'
import { joinRoom, supabaseAvailable } from '../net/supabaseRoom'
import { loadContent } from '../content'
import { AiClient } from '../ai/client'
import type { MapNode, RunState } from '../meta/runState'
import {
  availableNodes, chooseNode, completeNode, finishBattle, gainCard, gainRelic,
  newRun, nodeById, removeCard, startBattle, appendBattleAction, trainPiece,
  upgradeCard, buyCard, buyRelic, buyRecruit, addGold,
} from '../meta/runState'
import { rollBattleReward, rollShop, type BattleReward, type ShopStock } from '../meta/rewards'
import { eventById, type RunEvent } from '../meta/events'
import { clearRun, loadRun, saveRun, loadProfile, saveProfile } from '../meta/save'
import { bus, type ScreenName } from '../core/bus'
import type { Stage } from '../render/stage'
import { BattleScene, type BattleSceneHost } from '../render/battleScene'
import { collageIn, collageOut } from '../render/transitions'
import { audio } from '../audio/audioManager'

/**
 * Контроллер игры: владеет RunState и BattleState, оркестрирует бой
 * (ввод игрока → движок → анимации → ход ИИ), управляет экранами.
 * UI (Preact) подписывается через subscribe() и дёргает публичные методы.
 */
export class GameController implements BattleSceneHost {
  screen: ScreenName = 'menu'
  run: RunState | null = null
  battle: BattleState | null = null
  reward: BattleReward | null = null
  shop: ShopStock | null = null
  event: RunEvent | null = null
  /** Исход последнего забега для экранов конца. */
  lastOutcome: { victory: boolean; reason: string } | null = null
  hasSave = false

  // --- Кооп.
  mode: 'solo' | 'coop-host' | 'coop-guest' = 'solo'
  roomCode: string | null = null
  lobbyStatus = ''
  guestPresent = false
  coopNotice = ''

  private netHost: HostSession | null = null
  private netGuest: GuestSession | null = null
  private pendingPropose = false
  private lastMetaSync = 0

  private ai = new AiClient()
  private scene: BattleScene | null = null
  private stage: Stage
  private busy = false
  private listeners = new Set<() => void>()

  constructor(stage: Stage) {
    loadContent()
    this.stage = stage
    this.hasSave = loadRun() !== null
  }

  // -------------------------------------------------------------------------
  // Подписка UI

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private notify(): void {
    for (const fn of [...this.listeners]) fn()
    this.syncMetaThrottled()
  }

  private setScreen(s: ScreenName): void {
    this.screen = s
    bus.emit('screen', { name: s })
    this.notify()
    // Хост зеркалит мета-экраны гостю (бой синхронизируется отдельно).
    if (this.mode === 'coop-host' && s !== 'battle') {
      void this.netHost?.syncMeta()
    }
  }

  /** Гость в коопе не принимает мета-решения — только смотрит. */
  isSpectatorMeta(): boolean {
    return this.mode === 'coop-guest'
  }

  private syncMetaThrottled(): void {
    if (this.mode !== 'coop-host' || this.screen === 'battle') return
    const now = Date.now()
    if (now - this.lastMetaSync < 150) return
    this.lastMetaSync = now
    void this.netHost?.syncMeta()
  }

  // -------------------------------------------------------------------------
  // Меню / забег

  newRun(seed?: string): void {
    const s = seed ?? `run-${Math.random().toString(36).slice(2, 10)}`
    this.run = newRun(s)
    saveRun(this.run)
    this.hasSave = true
    this.setScreen('map')
  }

  continueRun(): void {
    const run = loadRun()
    if (!run) return
    this.run = run
    if (run.inBattle) {
      // Мид-битва: восстановление реплеем лога.
      void this.resumeBattle()
    } else {
      this.setScreen('map')
    }
  }

  abandonRun(): void {
    clearRun()
    this.run = null
    this.hasSave = false
    this.setScreen('menu')
  }

  toMenu(): void {
    this.leaveCoop()
    this.setScreen('menu')
  }

  // -------------------------------------------------------------------------
  // Кооп: лобби и сессии

  coopAvailable(): boolean {
    return supabaseAvailable()
  }

  openLobby(): void {
    this.lobbyStatus = ''
    this.roomCode = null
    this.setScreen('lobby')
  }

  leaveCoop(): void {
    this.netHost?.close()
    this.netGuest?.close()
    this.netHost = null
    this.netGuest = null
    this.mode = 'solo'
    this.roomCode = null
    this.guestPresent = false
    this.pendingPropose = false
    this.coopNotice = ''
  }

  /** Создать комнату (мы — хост). */
  async hostRoom(): Promise<void> {
    if (!supabaseAvailable()) { this.lobbyStatus = 'Supabase не настроен (.env)'; this.notify(); return }
    this.lobbyStatus = 'Создаю комнату…'
    this.notify()
    try {
      const code = makeRoomCode()
      const transport = await joinRoom(code, { role: 'host', name: 'Художник' })
      this.netHost = new HostSession(transport, this.hostDelegate(), 'Художник')
      this.mode = 'coop-host'
      this.roomCode = code
      this.lobbyStatus = 'Комната создана. Жду друга…'
    } catch (e) {
      this.lobbyStatus = `Не удалось подключиться: ${(e as Error).message}`
    }
    this.notify()
  }

  /** Войти по коду (мы — гость). */
  async joinAsGuest(rawCode: string): Promise<void> {
    if (!supabaseAvailable()) { this.lobbyStatus = 'Supabase не настроен (.env)'; this.notify(); return }
    const code = normalizeRoomCode(rawCode)
    if (!code) { this.lobbyStatus = 'Код — 6 символов'; this.notify(); return }
    this.lobbyStatus = 'Подключаюсь…'
    this.notify()
    try {
      const transport = await joinRoom(code, { role: 'guest', name: 'Подмастерье' })
      this.netGuest = new GuestSession(transport, this.guestDelegate(), 'Подмастерье')
      this.mode = 'coop-guest'
      this.roomCode = code
      this.lobbyStatus = 'Подключено. Жду начала забега…'
    } catch (e) {
      this.lobbyStatus = `Не удалось подключиться: ${(e as Error).message}`
    }
    this.notify()
  }

  /** Хост запускает совместный забег из лобби. */
  startCoopRun(): void {
    if (this.mode !== 'coop-host') return
    this.newRun()
  }

  private hostDelegate(): HostDelegate {
    return {
      getBattle: () => this.battle,
      getRunJson: () => JSON.stringify(this.run),
      getScreen: () => this.screen,
      onGuestPropose: async (action: Action): Promise<boolean> => {
        if (this.mode !== 'coop-host' || !this.battle || this.busy) return false
        if (!this.isGuestTurn()) return false
        const v = validate(this.battle, action, 0)
        if (!v.ok) return false
        await this.applyAndAnimate(action)
        return true
      },
      onGuestPresence: (connected: boolean) => {
        this.guestPresent = connected
        if (connected && this.lobbyStatus) this.lobbyStatus = 'Друг в комнате!'
        this.notify()
      },
    }
  }

  private guestDelegate(): GuestDelegate {
    return {
      applyRemote: async (action: Action): Promise<string> => {
        if (!this.battle) return ''
        this.pendingPropose = false
        const events: EngineEvent[] = []
        applyMut(this.battle, action, events)
        bus.emit('engine', { events })
        if (this.scene) await this.scene.onEngineEvents(events)
        this.notify()
        return hashState(this.battle)
      },
      loadSnapshot: async (runJson, battleJson, screen): Promise<void> => {
        if (runJson) this.run = JSON.parse(runJson) as RunState
        if (battleJson) {
          this.battle = decodeState(battleJson)
          if (!this.scene) {
            this.scene = new BattleScene(this)
            this.scene.mount(this.stage)
            await collageIn(this.scene)
          } else {
            this.scene.syncImmediate()
          }
        }
        if (screen !== 'battle' && this.scene) {
          const scene = this.scene
          this.scene = null
          this.battle = null
          await collageOut(scene)
          scene.destroy()
        }
        this.setScreen(screen as ScreenName)
      },
      onDenied: (reason: string) => {
        this.lobbyStatus = reason === 'buildMismatch'
          ? 'Версии игры различаются — обновите страницу у обоих.'
          : `Вход отклонён: ${reason}`
        this.leaveCoop()
        this.setScreen('lobby')
      },
      onRejected: () => {
        this.pendingPropose = false
        audio.sfx('lose', 0.25)
        this.notify()
      },
      onDesync: () => {
        this.coopNotice = 'Пересинхронизация…'
        this.notify()
        setTimeout(() => { this.coopNotice = ''; this.notify() }, 1500)
      },
    }
  }

  /** Чей сейчас командный ход: чётные — хост, нечётные — гость. */
  private isGuestTurn(): boolean {
    return this.battle !== null && this.battle.turn % 2 === 0
  }

  private isMyTurn(): boolean {
    if (this.mode === 'solo') return true
    const guestTurn = this.isGuestTurn()
    return this.mode === 'coop-guest' ? guestTurn : !guestTurn
  }

  availableNodes(): MapNode[] {
    return this.run ? availableNodes(this.run) : []
  }

  /** Клик по узлу карты. */
  selectNode(nodeId: string): void {
    if (!this.run || this.isSpectatorMeta()) return
    const ok = availableNodes(this.run).some(n => n.id === nodeId)
    if (!ok) return
    this.run = chooseNode(this.run, nodeId)
    saveRun(this.run)
    const node = nodeById(this.run, nodeId) as MapNode

    switch (node.kind) {
      case 'battle':
      case 'elite':
      case 'boss':
        void this.enterBattle(node)
        break
      case 'shop': {
        const next = structuredClone(this.run)
        this.shop = rollShop(next)
        this.run = next
        saveRun(this.run)
        this.setScreen('shop')
        break
      }
      case 'event': {
        this.event = node.eventId ? eventById(node.eventId) : null
        if (!this.event) { this.completeAndBackToMap('skip'); return }
        this.setScreen('event')
        break
      }
      case 'rest':
        this.setScreen('rest')
        break
      case 'treasure': {
        // Сокровище: реликвия, если есть невзятая, иначе золото.
        const owned = new Set(this.run.relics)
        const relic = ['ochreBrush', 'paletteKnife'].find(r => !owned.has(r))
        this.run = relic ? gainRelic(this.run, relic) : addGold(this.run, 50)
        this.completeAndBackToMap(relic ? `relic:${relic}` : 'gold')
        break
      }
    }
  }

  private completeAndBackToMap(outcome: string): void {
    if (!this.run) return
    this.run = completeNode(this.run, outcome)
    saveRun(this.run)
    this.shop = null
    this.event = null
    this.setScreen('map')
  }

  // -------------------------------------------------------------------------
  // Лавка / событие / привал

  shopBuyCard(i: number): void {
    if (!this.run || !this.shop || this.isSpectatorMeta()) return
    const item = this.shop.cards[i]
    if (!item) return
    try {
      this.run = buyCard(this.run, item.def, item.price)
      this.shop.cards.splice(i, 1)
      saveRun(this.run)
      audio.sfx('glue', 0.8)
      this.notify()
    } catch { audio.sfx('lose', 0.4) }
  }

  shopBuyRelic(i: number): void {
    if (!this.run || !this.shop || this.isSpectatorMeta()) return
    const item = this.shop.relics[i]
    if (!item) return
    try {
      this.run = buyRelic(this.run, item.id, item.price)
      this.shop.relics.splice(i, 1)
      saveRun(this.run)
      audio.sfx('glue', 0.8)
      this.notify()
    } catch { audio.sfx('lose', 0.4) }
  }

  shopBuyRecruit(): void {
    if (!this.run || !this.shop?.recruit || this.isSpectatorMeta()) return
    const r = this.shop.recruit
    try {
      this.run = buyRecruit(this.run, r.type, r.price, r.name)
      this.shop.recruit = null
      saveRun(this.run)
      audio.sfx('win', 0.5)
      this.notify()
    } catch { audio.sfx('lose', 0.4) }
  }

  shopRemoveCard(index: number): void {
    if (!this.run || !this.shop || this.isSpectatorMeta()) return
    try {
      this.run = removeCard(this.run, index, this.shop.removalPrice)
      this.shop.removalPrice = 9999 // одно удаление за визит
      saveRun(this.run)
      audio.sfx('cut', 0.8)
      this.notify()
    } catch { audio.sfx('lose', 0.4) }
  }

  leaveShop(): void {
    if (this.isSpectatorMeta()) return
    this.completeAndBackToMap('shop')
  }

  eventChoice(i: number): void {
    if (!this.run || !this.event || this.isSpectatorMeta()) return
    const choice = this.event.choices[i]
    if (!choice) return
    if (choice.condition && !choice.condition(this.run)) return
    this.run = choice.apply(this.run)
    this.completeAndBackToMap(`event:${this.event.id}:${i}`)
  }

  restTrain(rid: string, traitId: string): void {
    if (!this.run || this.isSpectatorMeta()) return
    this.run = trainPiece(this.run, rid, traitId)
    this.completeAndBackToMap(`train:${rid}:${traitId}`)
  }

  restUpgrade(cardIndex: number): void {
    if (!this.run || this.isSpectatorMeta()) return
    try {
      this.run = upgradeCard(this.run, cardIndex)
      this.completeAndBackToMap(`upgrade:${cardIndex}`)
    } catch { /* уже улучшена */ }
  }

  // -------------------------------------------------------------------------
  // Награда после боя

  pickRewardCard(def: string | null): void {
    if (!this.run || !this.reward || this.isSpectatorMeta()) return
    if (def) this.run = gainCard(this.run, def)
    if (this.reward.relic) this.run = gainRelic(this.run, this.reward.relic)
    this.reward = null
    saveRun(this.run)

    // Босс повержен?
    const bossDone = this.run.map.some(n => n.kind === 'boss' && n.visited)
    if (bossDone) {
      const p = loadProfile()
      saveProfile({ runsWon: p.runsWon + 1, bestAct: Math.max(p.bestAct, this.run.act) })
      clearRun()
      this.hasSave = false
      this.setScreen('victory')
    } else {
      this.setScreen('map')
    }
  }

  // -------------------------------------------------------------------------
  // BattleSceneHost

  getState(): BattleState {
    return this.battle as BattleState
  }

  inputEnabled(): boolean {
    if (this.busy || this.battle?.active !== 0 || this.battle.result) return false
    if (!this.isMyTurn()) return false
    if (this.mode === 'coop-guest' && this.pendingPropose) return false
    return true
  }

  legalMovesFor(pieceId: number): Sq[] {
    return this.battle ? legalMovesFor(this.battle, pieceId) : []
  }

  legalTargetsFor(iid: number): Sq[] {
    return this.battle ? legalTargetsFor(this.battle, iid) : []
  }

  tryAction(action: Action): boolean {
    if (!this.battle || !this.inputEnabled()) return false
    const v = validate(this.battle, action, 0)
    if (!v.ok) {
      audio.sfx('lose', 0.25)
      return false
    }
    if (this.mode === 'coop-guest') {
      // Гость не применяет локально — предлагает хосту.
      this.pendingPropose = true
      this.netGuest?.propose(action)
      this.notify()
      return true
    }
    void this.applyAndAnimate(action)
    return true
  }

  /** Сдаться (кнопка в DOM-оверлее боя). */
  concede(): void {
    if (!this.battle || this.battle.result) return
    void this.applyAndAnimate({ t: 'concede' })
  }

  // -------------------------------------------------------------------------
  // Бой: жизненный цикл

  private rosterInputs(run: RunState): { rid: string; type: string; traits: string[] }[] {
    return run.roster.map(r => ({ rid: r.rid, type: r.type, traits: r.traits.slice() }))
  }

  private async enterBattle(node: MapNode): Promise<void> {
    if (!this.run || !node.encounterId) return
    this.run = startBattle(this.run, node.encounterId)
    saveRun(this.run)
    await this.mountBattle(node.encounterId, [])
  }

  private async resumeBattle(): Promise<void> {
    if (!this.run?.inBattle) return
    const { encounterId, log } = this.run.inBattle
    await this.mountBattle(encounterId, log)
  }

  private async mountBattle(encounterId: string, replayLog: Action[]): Promise<void> {
    const run = this.run as RunState
    const inB = run.inBattle
    if (!inB) return
    const enc = encounterDef(encounterId)
    this.battle = newBattle({
      encounter: enc,
      roster: this.rosterInputs(run),
      deck: run.deck.map(d => ({ ...d })),
      relics: run.relics.slice(),
      seed: inB.battleSeed,
    })
    // Мид-битва: тихий реплей лога.
    for (const a of replayLog) {
      applyMut(this.battle, a)
    }

    this.scene = new BattleScene(this)
    this.scene.mount(this.stage)
    this.setScreen('battle')
    audio.sfx('card', 0.6)
    if (this.mode === 'coop-host' && this.netHost) {
      await this.netHost.announceBattleStart(this.battle)
    }
    await collageIn(this.scene)

    // Если после реплея ход врага — продолжаем его.
    if (!this.battle.result && this.battle.active === 1) {
      await this.aiTurn()
    }
    if (this.battle.result) await this.onBattleEnded()
  }

  private async applyAndAnimate(action: Action): Promise<void> {
    if (!this.battle || !this.run) return
    this.busy = true
    this.notify()
    try {
      const events: EngineEvent[] = []
      applyMut(this.battle, action, events)
      this.netHost?.announce(action, this.battle)
      this.run = appendBattleAction(this.run, action)
      saveRun(this.run)
      bus.emit('engine', { events })
      if (this.scene) await this.scene.onEngineEvents(events)

      if (this.battle.result) {
        await this.onBattleEnded()
        return
      }
      if (this.battle.active === 1) {
        await this.aiTurn()
        if (this.battle.result) {
          await this.onBattleEnded()
          return
        }
      }
    } finally {
      this.busy = false
      this.notify()
    }
  }

  private async aiTurn(): Promise<void> {
    const battle = this.battle as BattleState
    const run = this.run as RunState
    const enc = run.inBattle ? encounterDef(run.inBattle.encounterId) : null
    const tier = enc?.aiTier ?? 'journeyman'

    let guard = 0
    while (this.battle && battle.active === 1 && !battle.result && guard++ < 40) {
      let action: Action
      try {
        action = await this.ai.requestMove(battle, tier, battle.ply)
      } catch {
        return // отменено (выход из боя)
      }
      const v = validate(battle, action, 1)
      if (!v.ok) action = { t: 'endTurn' }
      const events: EngineEvent[] = []
      applyMut(battle, action, events)
      this.netHost?.announce(action, battle)
      this.run = appendBattleAction(this.run as RunState, action)
      saveRun(this.run)
      bus.emit('engine', { events })
      if (this.scene) await this.scene.onEngineEvents(events)
    }
  }

  private async onBattleEnded(): Promise<void> {
    const battle = this.battle as BattleState
    const run = this.run as RunState
    const victory = battle.result?.winner === 0
    this.lastOutcome = { victory, reason: battle.result?.reason ?? '' }

    audio.sfx(victory ? 'win' : 'lose', 0.9)
    await new Promise(r => setTimeout(r, 900))
    if (this.scene) {
      await collageOut(this.scene)
      this.scene.destroy()
      this.scene = null
    }

    // Выжившие фигуры ростера: тип и ПОСТОЯННЫЕ черты синхронизируются.
    const survivors = battle.pieces
      .filter(p => p.owner === 0 && p.rosterId)
      .map(p => ({
        rid: p.rosterId as string,
        type: p.type,
        traits: p.traits.filter((t: PieceTrait) => t.turnsLeft === -1).map(t => t.id),
      }))

    if (victory) {
      const encId = run.inBattle?.encounterId ?? ''
      const next = structuredClone(run)
      const reward = rollBattleReward(next, encId)
      this.reward = reward
      this.run = finishBattle(next, survivors, true, reward.gold)
      saveRun(this.run)
      this.battle = null
      this.setScreen('reward')
    } else {
      const p = loadProfile()
      saveProfile({ runsLost: p.runsLost + 1 })
      clearRun()
      this.hasSave = false
      this.battle = null
      this.run = null
      this.setScreen('gameover')
    }
  }
}
