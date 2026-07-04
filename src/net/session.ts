import type { Action, BattleState } from '../engine/types'
import { encodeState, hashState } from '../engine/serialize'
import { gzipDecode, gzipEncode } from './codec'
import { buildHash, PROTOCOL_V, type NetMsg } from './protocol'
import type { RoomTransport } from './transport'

/**
 * Lockstep-сессии поверх RoomTransport. Транспорт-агностичны — тестируются
 * на loopback-паре без сети.
 */

// ---------------------------------------------------------------------------
// Хост

export interface HostDelegate {
  getBattle(): BattleState | null
  getRunJson(): string
  getScreen(): string
  /** Гость предложил действие: проверить очередь/легальность и применить. */
  onGuestPropose(action: Action): Promise<boolean>
  /** Гость подключился/отвалился. */
  onGuestPresence(connected: boolean): void
}

export class HostSession {
  seq = 0
  guestConnected = false
  private offMsg: () => void

  constructor(
    private transport: RoomTransport,
    private delegate: HostDelegate,
    private hostName: string,
  ) {
    void this.hostName
    this.offMsg = transport.onMessage(msg => { void this.onMsg(msg) })
  }

  /** Вызывается контроллером после КАЖДОГО применённого боевого действия. */
  announce(action: Action, battle: BattleState): void {
    this.seq++
    this.transport.send({
      v: PROTOCOL_V, t: 'apply', seq: this.seq, action, hash: hashState(battle),
    })
  }

  /** Начало боя: полный снапшот стартового состояния. */
  async announceBattleStart(battle: BattleState): Promise<void> {
    this.seq++
    this.transport.send({
      v: PROTOCOL_V, t: 'battleStart', seq: this.seq,
      battleGz: await gzipEncode(encodeState(battle)),
    })
  }

  /** Синхронизация меты (карта/лавка/награда/экран). */
  async syncMeta(): Promise<void> {
    this.seq++
    this.transport.send({
      v: PROTOCOL_V, t: 'metaSync', seq: this.seq,
      runGz: await gzipEncode(this.delegate.getRunJson()),
      screen: this.delegate.getScreen(),
    })
  }

  private async onMsg(msg: NetMsg): Promise<void> {
    switch (msg.t) {
      case 'hello': {
        if (msg.build !== buildHash()) {
          this.transport.send({ v: PROTOCOL_V, t: 'deny', reason: 'buildMismatch' })
          return
        }
        this.guestConnected = true
        this.delegate.onGuestPresence(true)
        const battle = this.delegate.getBattle()
        this.transport.send({
          v: PROTOCOL_V, t: 'welcome', seq: this.seq,
          runGz: await gzipEncode(this.delegate.getRunJson()),
          battleGz: battle ? await gzipEncode(encodeState(battle)) : null,
          screen: this.delegate.getScreen(),
        })
        break
      }
      case 'propose': {
        const ok = await this.delegate.onGuestPropose(msg.action)
        if (!ok) {
          this.transport.send({ v: PROTOCOL_V, t: 'reject', pseq: msg.pseq, reason: 'invalid' })
        }
        break
      }
      case 'resyncReq': {
        const battle = this.delegate.getBattle()
        this.transport.send({
          v: PROTOCOL_V, t: 'snapshot', seq: this.seq,
          runGz: await gzipEncode(this.delegate.getRunJson()),
          battleGz: battle ? await gzipEncode(encodeState(battle)) : null,
          screen: this.delegate.getScreen(),
        })
        break
      }
      case 'bye': {
        this.guestConnected = false
        this.delegate.onGuestPresence(false)
        break
      }
      default:
        break
    }
  }

  close(): void {
    this.transport.send({ v: PROTOCOL_V, t: 'bye' })
    this.offMsg()
    this.transport.close()
  }
}

// ---------------------------------------------------------------------------
// Гость

export interface GuestDelegate {
  /**
   * Применить действие хоста локально (движок + анимации).
   * Вернуть локальный hashState; сессия сверит с хостовым.
   */
  applyRemote(action: Action): Promise<string>
  /** Полный снапшот (welcome/battleStart/snapshot/metaSync). */
  loadSnapshot(runJson: string | null, battleJson: string | null, screen: string): Promise<void>
  onDenied(reason: string): void
  onRejected(pseq: number, reason: string): void
  onDesync(): void
}

export class GuestSession {
  private nextPseq = 1
  private lastSeq = 0
  private queue: NetMsg[] = []
  private processing = false
  private offMsg: () => void

  constructor(
    private transport: RoomTransport,
    private delegate: GuestDelegate,
    name: string,
  ) {
    this.offMsg = transport.onMessage(msg => { void this.enqueue(msg) })
    transport.send({ v: PROTOCOL_V, t: 'hello', name, build: buildHash() })
  }

  /** Предложить действие хосту. Локально НЕ применяется. */
  propose(action: Action): number {
    const pseq = this.nextPseq++
    this.transport.send({ v: PROTOCOL_V, t: 'propose', pseq, action })
    return pseq
  }

  requestResync(): void {
    this.transport.send({ v: PROTOCOL_V, t: 'resyncReq', haveSeq: this.lastSeq })
  }

  private async enqueue(msg: NetMsg): Promise<void> {
    this.queue.push(msg)
    if (this.processing) return
    this.processing = true
    try {
      while (this.queue.length > 0) {
        const next = this.queue.shift() as NetMsg
        await this.process(next)
      }
    } finally {
      this.processing = false
    }
  }

  private async process(msg: NetMsg): Promise<void> {
    switch (msg.t) {
      case 'deny':
        this.delegate.onDenied(msg.reason)
        break

      case 'welcome':
      case 'snapshot': {
        this.lastSeq = msg.seq
        await this.delegate.loadSnapshot(
          await gzipDecode(msg.runGz),
          msg.battleGz ? await gzipDecode(msg.battleGz) : null,
          msg.screen,
        )
        break
      }

      case 'battleStart': {
        this.lastSeq = msg.seq
        await this.delegate.loadSnapshot(null, await gzipDecode(msg.battleGz), 'battle')
        break
      }

      case 'metaSync': {
        this.lastSeq = msg.seq
        await this.delegate.loadSnapshot(await gzipDecode(msg.runGz), null, msg.screen)
        break
      }

      case 'apply': {
        // Пропущенные сообщения → ресинк (упрощение: без буфера дырок).
        if (msg.seq !== this.lastSeq + 1) {
          this.delegate.onDesync()
          this.requestResync()
          return
        }
        this.lastSeq = msg.seq
        const localHash = await this.delegate.applyRemote(msg.action)
        if (localHash !== msg.hash) {
          this.delegate.onDesync()
          this.requestResync()
        }
        break
      }

      case 'reject':
        this.delegate.onRejected(msg.pseq, msg.reason)
        break

      case 'bye':
        break

      default:
        break
    }
  }

  close(): void {
    this.transport.send({ v: PROTOCOL_V, t: 'bye' })
    this.offMsg()
    this.transport.close()
  }
}
