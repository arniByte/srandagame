/**
 * Палитра CHECKMATISSE: аппликации Матисса + супрематизм Малевича.
 * Единственный источник цветов для рендера/диорамы/плейсхолдеров.
 */
export const PAL = {
  vermilion: 0xd93829, // киноварь
  ink: 0x1d1d1b,       // чёрный
  ochre: 0xf2a20c,     // охра
  blue: 0x2e6cb5,      // синий
  green: 0x2c8c57,     // зелёный
  paper: 0xf5efe0,     // кремовая бумага
  bg: 0x14120f,        // тёмный фон
} as const

export type FactionKey = 'vermilion' | 'ink'

/** Цвета фракции: основной / вторичный / акцент. */
export interface FactionColors {
  primary: number
  secondary: number
  accent: number
}

export const FACTION: Record<FactionKey, FactionColors> = {
  vermilion: { primary: PAL.vermilion, secondary: PAL.ochre, accent: PAL.paper },
  ink: { primary: PAL.ink, secondary: PAL.blue, accent: PAL.paper },
}

export const factionOf = (owner: number): FactionKey => (owner === 0 ? 'vermilion' : 'ink')

/** number → css-строка '#rrggbb'. */
export const cssColor = (c: number): string => '#' + c.toString(16).padStart(6, '0')
