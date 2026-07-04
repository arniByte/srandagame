import type { RunState } from './runState'
import { addGold, gainCard, gainRelic, removeCard, trainPiece, buyRecruit } from './runState'

/**
 * События карты. apply — чистые функции поверх редьюсеров runState.
 */
export interface RunEvent {
  id: string
  title: string
  text: string
  illus: string
  choices: {
    label: string
    /** Недоступный выбор скрывается. */
    condition?(run: RunState): boolean
    apply(run: RunState): RunState
  }[]
}

export const EVENTS: RunEvent[] = [
  {
    id: 'ev-collector', title: 'Одержимый коллекционер',
    text: 'Человек в чёрном пенсне листает вашу колоду: «Эта работа... примитив! Отдайте её мне — и я заплачу как за шедевр».',
    illus: 'event.collector',
    choices: [
      {
        label: 'Продать первую карту колоды (+45 золота)',
        condition: run => run.deck.length > 1,
        apply: run => addGold(removeCard(run, 0, 0), 45),
      },
      { label: 'Уйти молча', apply: run => run },
    ],
  },
  {
    id: 'ev-dove', title: 'Белый голубь',
    text: 'На рваном краю доски сидит бумажный голубь. Он голоден и смотрит на вас глазом-запятой.',
    illus: 'event.dove',
    choices: [
      {
        label: 'Накормить (−15 золота): голубь летит с вами',
        condition: run => run.gold >= 15,
        apply: run => buyRecruit(run, 'dove', 15, 'Голубь-попутчик'),
      },
      { label: 'Пройти мимо', apply: run => run },
    ],
  },
  {
    id: 'ev-blacksquare', title: 'Чёрный квадрат',
    text: 'В галерее пусто. Только квадрат. Он смотрит в вас. Что-то внутри него определённо есть.',
    illus: 'event.blacksquare',
    choices: [
      {
        label: 'Заглянуть за раму (+60 золота, но первая фигура ростера получает Оцепенение на старте следующего боя... шутка — просто +60)',
        apply: run => addGold(run, 60),
      },
      {
        label: 'Поклониться и получить «Палитру» в колоду',
        apply: run => gainCard(run, 'palette'),
      },
    ],
  },
  {
    id: 'ev-teacher', title: 'Старый мастер',
    text: '«Твоим фигурам не хватает выучки, — щурится старик с мастихином за ухом. — Давай-ка я покажу пару приёмов».',
    illus: 'event.teacher',
    choices: [
      {
        label: 'Обучить первую фигуру «Жажде краски»',
        condition: run => run.roster.length > 0,
        apply: run => trainPiece(run, (run.roster[0] as { rid: string }).rid, 'thirsty'),
      },
      {
        label: 'Попросить денег вместо уроков (+25 золота)',
        apply: run => addGold(run, 25),
      },
    ],
  },
  {
    id: 'ev-paintspill', title: 'Разлитая киноварь',
    text: 'Целая лужа драгоценной красной краски. Можно собрать в банки, но перепачкаешься по локоть.',
    illus: 'event.paintspill',
    choices: [
      { label: 'Собрать (+35 золота)', apply: run => addGold(run, 35) },
      {
        label: 'Нарисовать на стене голубя (получить карту «Вдохновение»)',
        apply: run => gainCard(run, 'inspiration'),
      },
    ],
  },
  {
    id: 'ev-knifegrinder', title: 'Точильщик ножниц',
    text: '«Ножницы тупые — коллаж кривой», — бормочет точильщик, разбрасывая искры-звёздочки.',
    illus: 'event.knifegrinder',
    choices: [
      {
        label: 'Наточить (−20 золота): карта «Ножницы» в колоду',
        condition: run => run.gold >= 20,
        apply: run => gainCard(addGold(run, -20), 'scissors'),
      },
      {
        label: 'Просто поболтать (реликвия «Мастихин», если её ещё нет)',
        condition: run => !run.relics.includes('paletteKnife'),
        apply: run => gainRelic(run, 'paletteKnife'),
      },
      { label: 'Уйти', apply: run => run },
    ],
  },
]

export function eventById(id: string): RunEvent | null {
  return EVENTS.find(e => e.id === id) ?? null
}
