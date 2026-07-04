import { useEffect, useReducer, useState } from 'preact/hooks'
import type { GameController } from '../game/controller'
import { cardDef, pieceType, relicDef, traitDef } from '../engine'
import type { MapNode } from '../meta/runState'
import { MAP_ROWS } from '../meta/mapGen'

/**
 * DOM-оверлей: меню, карта забега, лавка, события, привал, награды, финалы.
 * Бой рисует Pixi; здесь от боя — только тонкий HUD (золото, «Сдаться»).
 */

export function App({ game }: { game: GameController }) {
  const [, force] = useReducer((n: number) => n + 1, 0)
  useEffect(() => game.subscribe(() => force(0)), [game])

  switch (game.screen) {
    case 'menu': return <Menu game={game} />
    case 'map': return <MapScreen game={game} />
    case 'battle': return <BattleHud game={game} />
    case 'shop': return <Shop game={game} />
    case 'event': return <EventScreen game={game} />
    case 'rest': return <Rest game={game} />
    case 'reward': return <Reward game={game} />
    case 'gameover': return <End game={game} victory={false} />
    case 'victory': return <End game={game} victory={true} />
    case 'lobby': return <Lobby game={game} />
    default: return null
  }
}

/** Плашка гостя на мета-экранах: решает хост. */
function SpectatorBadge({ game }: { game: GameController }) {
  if (!game.isSpectatorMeta()) return null
  return (
    <div style="position:absolute;top:10px;left:50%;transform:translateX(-50%);background:#1d1d1b;color:#f5efe0;padding:6px 18px;font-size:14px;clip-path:polygon(2% 10%,98% 0,99% 88%,1% 98%)">
      Путь выбирает Художник-хост…
    </div>
  )
}

function Menu({ game }: { game: GameController }) {
  return (
    <div class="screen">
      <div class="paper" style="text-align:center">
        <h1 class="logo">
          <span class="c1">CHECK</span><span class="c2">MA</span><span class="c3">TISSE</span>
        </h1>
        <p class="tagline">рогалик-шахматы из бумаги, ножниц и масляной краски</p>
        <div class="row">
          <button class="btn red" onClick={() => game.newRun()}>Новый забег</button>
          {game.hasSave && (
            <button class="btn" onClick={() => game.continueRun()}>Продолжить</button>
          )}
          <button class="btn blue glow" disabled={!game.coopAvailable()}
            title={game.coopAvailable() ? '' : 'Не настроен Supabase (.env)'}
            onClick={() => game.openLobby()}>Кооп по сети</button>
          <button class="btn green" style="background:#2c8c57"
            onClick={() => game.startHotseat()}>Вдвоём за этим экраном</button>
        </div>
        <p class="small">
          Веди армию-аппликацию к замку. Ходи фигурами, играй карты за краску,
          режь доску ножницами. Погибшие не возвращаются.
        </p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

const NODE_GLYPH: Record<MapNode['kind'], string> = {
  battle: '⚔', elite: '♛', event: '✶', shop: '◆', rest: '✚', treasure: '✹', boss: '♚',
}
const NODE_NAME: Record<MapNode['kind'], string> = {
  battle: 'Бой', elite: 'Элита', event: 'Событие', shop: 'Лавка',
  rest: 'Привал', treasure: 'Сокровище', boss: 'БОСС',
}

function MapScreen({ game }: { game: GameController }) {
  const run = game.run
  // Старт внизу свитка — прокручиваем к нему при открытии.
  useEffect(() => {
    const el = document.querySelector('.map-wrap')
    if (el) el.scrollTop = el.scrollHeight
  }, [])
  if (!run) return null
  const avail = new Set(game.availableNodes().map(n => n.id))
  const W = 820
  const rowH = 92
  const H = MAP_ROWS * rowH + 40
  const x = (col: number) => 70 + col * ((W - 140) / 6)
  const y = (row: number) => H - 60 - row * rowH

  return (
    <div class="screen">
      <SpectatorBadge game={game} />
      <div class="map-wrap">
        <div style="display:flex;justify-content:space-between;padding:4px 12px;align-items:baseline">
          <h2>Путь к замку · акт {run.act}</h2>
          <div>
            <span class="gold-badge">◉ {run.gold}</span>
            <span style="opacity:.6;margin-left:12px">колода: {run.deck.length} · армия: {run.roster.length}</span>
            <button class="btn ghost" style="color:#1d1d1b;font-size:14px" onClick={() => game.toMenu()}>меню</button>
          </div>
        </div>
        <svg class="map-svg" viewBox={`0 0 ${W} ${H}`}>
          {run.map.map(n => n.edges.map(eid => {
            const to = run.map.find(m => m.id === eid)
            if (!to) return null
            return (
              <line
                key={n.id + eid}
                x1={x(n.col)} y1={y(n.row)} x2={x(to.col)} y2={y(to.row)}
                stroke="#1d1d1b" stroke-width="2" stroke-dasharray="6 5" opacity="0.4"
              />
            )
          }))}
          {run.map.map(n => {
            const cls = `map-node ${avail.has(n.id) ? 'available' : ''} ${n.visited ? 'visited' : ''}`
            const fill = n.kind === 'boss' ? '#d93829'
              : n.kind === 'elite' ? '#2e6cb5'
              : n.kind === 'treasure' ? '#f2a20c'
              : n.kind === 'rest' ? '#2c8c57'
              : '#f5efe0'
            const glyphFill = fill === '#f5efe0' ? '#1d1d1b' : '#f5efe0'
            return (
              <g key={n.id} class={cls} onClick={() => avail.has(n.id) && game.selectNode(n.id)}>
                <title>{NODE_NAME[n.kind]}</title>
                <circle cx={x(n.col)} cy={y(n.row)} r={n.kind === 'boss' ? 26 : 16}
                  fill={fill} stroke="#1d1d1b" stroke-width="2"
                  transform={`rotate(${(n.col * 7 + n.row * 13) % 9 - 4} ${x(n.col)} ${y(n.row)})`} />
                <text x={x(n.col)} y={y(n.row) + 6} text-anchor="middle"
                  font-size={n.kind === 'boss' ? 24 : 15} fill={glyphFill}
                  style="pointer-events:none">{NODE_GLYPH[n.kind]}</text>
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

function BattleHud({ game }: { game: GameController }) {
  const coop = game.mode === 'coop-host' || game.mode === 'coop-guest'
  const myTurn = game.inputEnabled()
  return (
    <div class="screen transparent">
      <div class="battle-hud plaque">
        {game.mode === 'hotseat' && game.battle?.active === 0 && (
          <span style="color:#f2a20c">Ходит Игрок {game.hotseatPlayer()}</span>
        )}
        {coop && (
          <span style={myTurn ? 'color:#f2a20c' : 'opacity:.75'}>
            {game.battle?.active === 0
              ? (myTurn ? '— ваш ход —' : 'ходит напарник…')
              : ''}
          </span>
        )}
        {game.coopNotice && <span>{game.coopNotice}</span>}
        <span class="gold">◉ {game.run?.gold ?? 0}</span>
        {game.mode !== 'coop-guest' && (
          <button class="btn ghost" style="font-size:14px;padding:4px 10px"
            onClick={() => game.concede()}>сдаться</button>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

function Lobby({ game }: { game: GameController }) {
  const [code, setCode] = useState('')
  return (
    <div class="screen">
      <div class="paper" style="text-align:center;max-width:480px">
        <h2>Кооп: общая армия</h2>
        <p class="small">
          Вы с другом делите одну армию и одну колоду: ходы по очереди —
          нечётные твои, чётные — друга. Против вас — ИИ.
        </p>

        {game.roomCode && game.mode === 'coop-host' ? (
          <>
            <p>Код комнаты — продиктуй другу:</p>
            <h1 class="logo" style="font-size:52px;letter-spacing:.25em">{game.roomCode}</h1>
            <p class="small">{game.lobbyStatus}</p>
            <button class="btn red" disabled={!game.guestPresent}
              onClick={() => game.startCoopRun()}>
              {game.guestPresent ? 'Начать забег' : 'Ждём друга…'}
            </button>
          </>
        ) : game.mode === 'coop-guest' ? (
          <p>{game.lobbyStatus}</p>
        ) : (
          <>
            <button class="btn red" onClick={() => void game.hostRoom()}>Создать комнату</button>
            <div class="row" style="margin-top:10px;align-items:center">
              <input
                value={code}
                onInput={e => setCode((e.target as HTMLInputElement).value)}
                placeholder="КОД КОМНАТЫ"
                style="font-family:inherit;font-size:20px;padding:10px;width:170px;text-transform:uppercase;border:2px solid #1d1d1b;background:#fff"
              />
              <button class="btn blue" onClick={() => void game.joinAsGuest(code)}>Войти</button>
            </div>
            {game.lobbyStatus && <p class="small">{game.lobbyStatus}</p>}
          </>
        )}
        <div style="margin-top:14px">
          <button class="btn ghost" onClick={() => game.toMenu()}>Назад</button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

function Shop({ game }: { game: GameController }) {
  const { run, shop } = game
  if (!run || !shop) return null
  return (
    <div class="screen">
      <SpectatorBadge game={game} />
      <div class="paper" style="text-align:center">
        <h2>Лавка старьёвщика</h2>
        <p class="small">«Краденое? Что вы. Найденное». <span class="gold-badge">◉ {run.gold}</span></p>
        <div class="row">
          {shop.cards.map((c, i) => {
            const def = cardDef(c.def)
            return (
              <div class="mini-card" key={c.def + i} onClick={() => game.shopBuyCard(i)}>
                <h4 class={`rarity-${def.rarity}`}>{def.name}</h4>
                <p>{def.desc}</p>
                <p><span class="cost">☂{def.cost}</span> · <span class="price">◉{c.price}</span></p>
              </div>
            )
          })}
        </div>
        <div class="row" style="margin-top:10px">
          {shop.relics.map((r, i) => {
            const def = relicDef(r.id)
            return (
              <div class="mini-card" key={r.id} onClick={() => game.shopBuyRelic(i)}>
                <h4>❖ {def.name}</h4>
                <p>{def.desc}</p>
                <p class="price">◉{r.price}</p>
              </div>
            )
          })}
          {shop.recruit && (
            <div class="mini-card" onClick={() => game.shopBuyRecruit()}>
              <h4>♞ {shop.recruit.name}</h4>
              <p>{pieceType(shop.recruit.type).name} вступит в армию</p>
              <p class="price">◉{shop.recruit.price}</p>
            </div>
          )}
        </div>
        {shop.removalPrice < 9999 && run.deck.length > 1 && (
          <details style="margin-top:10px">
            <summary>Удалить карту из колоды (◉{shop.removalPrice})</summary>
            <div class="deck-list" style="margin-top:8px">
              {run.deck.map((d, i) => (
                <button class="btn ghost" style="color:#1d1d1b;font-size:14px" key={i}
                  onClick={() => game.shopRemoveCard(i)}>
                  {cardDef(d.def).name}{d.upgraded ? '+' : ''}
                </button>
              ))}
            </div>
          </details>
        )}
        <div style="margin-top:14px">
          <button class="btn" onClick={() => game.leaveShop()}>Уйти</button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

function EventScreen({ game }: { game: GameController }) {
  const ev = game.event
  const run = game.run
  if (!ev || !run) return null
  return (
    <div class="screen">
      <SpectatorBadge game={game} />
      <div class="paper" style="max-width:560px;text-align:center">
        <img
          src={`/assets/events/${ev.id}.webp`}
          alt=""
          style="max-width:78%;max-height:200px;border:3px solid #1d1d1b;box-shadow:4px 5px 0 rgba(0,0,0,.3);transform:rotate(-1.2deg)"
          onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
        />
        <h2>{ev.title}</h2>
        <p style="text-align:left">{ev.text}</p>
        <div style="display:flex;flex-direction:column;gap:6px">
          {ev.choices.map((c, i) => {
            if (c.condition && !c.condition(run)) return null
            return <button class="btn blue" key={i} onClick={() => game.eventChoice(i)}>{c.label}</button>
          })}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

const TRAINABLE = ['thirsty', 'anchor'] as const

function Rest({ game }: { game: GameController }) {
  const run = game.run
  const [rid, setRid] = useState<string | null>(null)
  if (!run) return null
  return (
    <div class="screen">
      <SpectatorBadge game={game} />
      <div class="paper" style="text-align:center;max-width:560px">
        <h2>Привал у костра из рам</h2>
        <p class="small">Выбери одно: обучить фигуру или улучшить карту.</p>

        <h4>Обучить фигуру</h4>
        <div class="roster-row">
          {run.roster.map(r => (
            <div class={`roster-chip ${rid === r.rid ? 'sel' : ''}`} key={r.rid}
              onClick={() => setRid(r.rid)}>
              {pieceType(r.type).name} «{r.name}»
              {r.traits.length > 0 && <span style="opacity:.6"> · {r.traits.map(t => traitDef(t).name).join(', ')}</span>}
            </div>
          ))}
        </div>
        {rid && (
          <div class="row" style="margin-top:8px">
            {TRAINABLE.map(t => (
              <button class="btn green" style="background:#2c8c57" key={t}
                disabled={run.roster.find(r => r.rid === rid)?.traits.includes(t)}
                onClick={() => game.restTrain(rid, t)}>
                {traitDef(t).name}
              </button>
            ))}
          </div>
        )}

        <h4 style="margin-top:16px">…или улучшить карту (−1 к стоимости)</h4>
        <div class="deck-list">
          {run.deck.map((d, i) => (
            <button class="btn ghost" style="color:#1d1d1b;font-size:14px" key={i}
              disabled={d.upgraded}
              onClick={() => game.restUpgrade(i)}>
              {cardDef(d.def).name}{d.upgraded ? '+' : ''}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

function Reward({ game }: { game: GameController }) {
  const r = game.reward
  if (!r) return null
  return (
    <div class="screen">
      <SpectatorBadge game={game} />
      <div class="paper" style="text-align:center">
        <h2>Трофеи боя</h2>
        <p class="gold-badge">+◉ {r.gold}</p>
        {r.relic && <p>❖ Реликвия: <b>{relicDef(r.relic).name}</b> — {relicDef(r.relic).desc}</p>}
        <p class="small">Возьми одну карту в колоду:</p>
        <div class="row">
          {r.cardChoices.map(defId => {
            const def = cardDef(defId)
            return (
              <div class="mini-card" key={defId} onClick={() => game.pickRewardCard(defId)}>
                <h4 class={`rarity-${def.rarity}`}>{def.name}</h4>
                <p>{def.desc}</p>
                <p class="cost">☂{def.cost}</p>
              </div>
            )
          })}
        </div>
        <button class="btn ghost" onClick={() => game.pickRewardCard(null)}>Пропустить</button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

function End({ game, victory }: { game: GameController; victory: boolean }) {
  return (
    <div class="screen">
      <div class="paper" style="text-align:center">
        <h1 class="logo" style="font-size:44px">
          {victory
            ? <span class="c3">ЗАМОК ВЗЯТ</span>
            : <span class="c1">КОЛЛАЖ РАЗОРВАН</span>}
        </h1>
        <p class="tagline">
          {victory
            ? 'Куратор аплодирует стоя. Выставка ваша.'
            : game.lastOutcome?.reason === 'concede'
              ? 'Иногда отступить — тоже композиционное решение.'
              : 'Король-Художник пал. Бумага всё стерпит — начни новый лист.'}
        </p>
        <button class="btn red" onClick={() => game.newRun()}>Новый забег</button>
        <button class="btn" onClick={() => game.toMenu()}>В меню</button>
      </div>
    </div>
  )
}
