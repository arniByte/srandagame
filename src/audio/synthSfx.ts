/**
 * Синтезированные SFX-плейсхолдеры: сэмплы считаются в JS в AudioBuffer.
 * Реальные записи заменят их через тот же audioManager без смены API.
 */

export type SfxKey =
  | 'move' | 'capture' | 'card' | 'cut' | 'glue'
  | 'win' | 'lose' | 'select' | 'error' | 'freeze' | 'promote'

function makeBuffer(ctx: BaseAudioContext, dur: number, fill: (t: number, sr: number) => number): AudioBuffer {
  const sr = ctx.sampleRate
  const n = Math.max(1, Math.floor(dur * sr))
  const buf = ctx.createBuffer(1, n, sr)
  const data = buf.getChannelData(0)
  for (let i = 0; i < n; i++) data[i] = fill(i / sr, sr)
  return buf
}

const noise = (): number => Math.random() * 2 - 1
const env = (t: number, decay: number): number => Math.exp(-t * decay)

/** Короткий деревянный тук: два расстроенных синуса + щелчок атаки. */
function sfxMove(ctx: BaseAudioContext): AudioBuffer {
  return makeBuffer(ctx, 0.12, t => {
    const a = Math.sin(2 * Math.PI * 196 * t) * 0.6
    const b = Math.sin(2 * Math.PI * 293.3 * t) * 0.35
    const click = t < 0.004 ? noise() * 0.5 : 0
    return (a + b) * env(t, 34) * 0.8 + click
  })
}

/** Взятие: фильтрованный шум + низкий удар. */
function sfxCapture(ctx: BaseAudioContext): AudioBuffer {
  let lp = 0
  return makeBuffer(ctx, 0.3, t => {
    lp += (noise() - lp) * 0.12 // one-pole lowpass
    const thump = Math.sin(2 * Math.PI * (72 - t * 60) * t) * env(t, 14) * 0.9
    return lp * env(t, 18) * 0.8 + thump
  })
}

/** Бумажный свист карты: шум с ринг-свипом. */
function sfxCard(ctx: BaseAudioContext): AudioBuffer {
  let hp = 0, prev = 0
  return makeBuffer(ctx, 0.2, t => {
    const n = noise()
    hp = n - prev + hp * 0.92 // one-pole highpass
    prev = n
    const sweep = Math.sin(2 * Math.PI * (400 + t * 3200) * t)
    const win = Math.sin(Math.PI * Math.min(t / 0.2, 1))
    return hp * (0.55 + 0.45 * sweep) * win * 0.55
  })
}

/** Ножницы: два щелчка. */
function sfxCut(ctx: BaseAudioContext): AudioBuffer {
  let prev = 0, hp = 0
  return makeBuffer(ctx, 0.16, t => {
    const n = noise()
    hp = n - prev + hp * 0.8
    prev = n
    const t2 = t - 0.08
    const c1 = t >= 0 && t < 0.02 ? env(t, 260) : 0
    const c2 = t2 >= 0 && t2 < 0.025 ? env(t2, 200) : 0
    return hp * (c1 * 0.9 + c2 * 1.1)
  })
}

/** Шлепок клея. */
function sfxGlue(ctx: BaseAudioContext): AudioBuffer {
  let lp = 0
  return makeBuffer(ctx, 0.18, t => {
    lp += (noise() - lp) * 0.25
    const thud = Math.sin(2 * Math.PI * 95 * t) * env(t, 26)
    return lp * env(t, 40) * 0.7 + thud * 0.8
  })
}

/** Мини-арпеджио: массив нот (Гц) с шагом step. */
function arpeggio(ctx: BaseAudioContext, notes: number[], step: number, noteDur: number, wobble = 0): AudioBuffer {
  const dur = step * notes.length + noteDur
  return makeBuffer(ctx, dur, t => {
    let out = 0
    for (let i = 0; i < notes.length; i++) {
      const lt = t - i * step
      if (lt < 0 || lt > noteDur) continue
      const f = (notes[i] ?? 440) * (1 + wobble * Math.sin(2 * Math.PI * 5 * lt))
      // Треугольная волна — мягче синуса, «игрушечный ксилофон».
      const ph = (f * lt) % 1
      const tri = 4 * Math.abs(ph - 0.5) - 1
      out += tri * env(lt, 9) * 0.32
    }
    return out
  })
}

function sfxSelect(ctx: BaseAudioContext): AudioBuffer {
  return makeBuffer(ctx, 0.05, t => Math.sin(2 * Math.PI * 880 * t) * env(t, 90) * 0.4)
}

function sfxError(ctx: BaseAudioContext): AudioBuffer {
  return makeBuffer(ctx, 0.14, t => {
    const sq = Math.sign(Math.sin(2 * Math.PI * 108 * t))
    return sq * env(t, 22) * 0.28
  })
}

/** Заморозка: стеклянный нисходящий глиссандо-звон. */
function sfxFreeze(ctx: BaseAudioContext): AudioBuffer {
  return makeBuffer(ctx, 0.3, t => {
    const f = 1350 - t * 1900
    return (Math.sin(2 * Math.PI * f * t) + Math.sin(2 * Math.PI * f * 1.5 * t) * 0.4) * env(t, 11) * 0.4
  })
}

/** Промоушен: восходящий глиссандо + искра. */
function sfxPromote(ctx: BaseAudioContext): AudioBuffer {
  return makeBuffer(ctx, 0.45, t => {
    const gliss = Math.sin(2 * Math.PI * (280 + t * 1400) * t) * env(t, 7)
    const spark = t > 0.18 ? Math.sin(2 * Math.PI * 1760 * t) * env(t - 0.18, 20) * 0.5 : 0
    return gliss * 0.5 + spark
  })
}

export function renderSfx(ctx: BaseAudioContext, key: SfxKey): AudioBuffer {
  switch (key) {
    case 'move': return sfxMove(ctx)
    case 'capture': return sfxCapture(ctx)
    case 'card': return sfxCard(ctx)
    case 'cut': return sfxCut(ctx)
    case 'glue': return sfxGlue(ctx)
    case 'win': return arpeggio(ctx, [523.25, 659.25, 783.99, 1046.5], 0.13, 0.5)
    case 'lose': return arpeggio(ctx, [440, 349.23, 293.66, 220], 0.17, 0.6, 0.012)
    case 'select': return sfxSelect(ctx)
    case 'error': return sfxError(ctx)
    case 'freeze': return sfxFreeze(ctx)
    case 'promote': return sfxPromote(ctx)
  }
}
