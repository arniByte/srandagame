/**
 * Обработка сгенерённого арта: скачивание, обрезка по альфа-границам (фигуры),
 * нормализация размера, конверсия в webp через headless Chromium.
 *
 * Использование: node scripts/process-assets.mjs <спецификация.json>
 * Спецификация: [{ key, url, kind: 'piece'|'card', out }]
 * Пишет файлы в public/assets/** и печатает JSON-фрагменты манифеста в stdout.
 */
import { chromium } from 'playwright-core'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { execFileSync } from 'node:child_process'

const specPath = process.argv[2]
if (!specPath) throw new Error('usage: node process-assets.mjs <spec.json>')
const spec = JSON.parse(readFileSync(specPath, 'utf8'))

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const page = await browser.newPage()
// Пустая страница с доступом к canvas; картинки грузим через fetch → blob.
await page.goto('about:blank')

const manifest = {}

for (const item of spec) {
  const { key, url, kind, out } = item
  // curl уважает HTTPS_PROXY и системный CA (node fetch — нет).
  const buf = execFileSync('curl', ['-sS', '--fail', url], { maxBuffer: 64 * 1024 * 1024 })
  const b64 = buf.toString('base64')

  const result = await page.evaluate(async ({ b64, kind, crop }) => {
    const resp = await fetch('data:image/png;base64,' + b64)
    const blob = await resp.blob()
    const bmp = await createImageBitmap(blob)
    const W = bmp.width, H = bmp.height

    const cv = new OffscreenCanvas(W, H)
    const ctx = cv.getContext('2d')
    ctx.drawImage(bmp, 0, 0)

    let sx = 0, sy = 0, sw = W, sh = H
    if (crop) {
      sx = Math.round(W * crop[0]); sy = Math.round(H * crop[1])
      sw = Math.round(W * (crop[2] - crop[0])); sh = Math.round(H * (crop[3] - crop[1]))
    }

    if (kind === 'piece' || kind === 'strip') {
      // Скан альфы: рамка объекта.
      const data = ctx.getImageData(0, 0, W, H).data
      let minX = W, minY = H, maxX = 0, maxY = 0
      for (let y = 0; y < H; y += 2) {
        for (let x = 0; x < W; x += 2) {
          if ((data[(y * W + x) * 4 + 3] ?? 0) > 16) {
            if (x < minX) minX = x
            if (x > maxX) maxX = x
            if (y < minY) minY = y
            if (y > maxY) maxY = y
          }
        }
      }
      if (maxX <= minX || maxY <= minY) { minX = 0; minY = 0; maxX = W - 1; maxY = H - 1 }
      const pad = Math.round(Math.max(maxX - minX, maxY - minY) * 0.04)
      sx = Math.max(0, minX - pad)
      sy = Math.max(0, minY - pad)
      sw = Math.min(W - sx, maxX + pad - sx + 1)
      sh = Math.min(H - sy, maxY + pad - sy + 1)
    }

    // Целевой размер: piece — h512; card/frame — w320; wide — w1600; strip — w1400 (с кропом).
    let tw, th
    if (kind === 'piece') {
      th = 512
      tw = Math.round(sw * (th / sh))
    } else if (kind === 'wide') {
      tw = 1600
      th = Math.round(sh * (tw / sw))
    } else if (kind === 'strip') {
      tw = 1400
      th = Math.round(sh * (tw / sw))
    } else if (kind === 'event') {
      tw = 640
      th = Math.round(sh * (tw / sw))
    } else {
      tw = 320
      th = Math.round(sh * (tw / sw))
    }

    const outCv = new OffscreenCanvas(tw, th)
    const octx = outCv.getContext('2d')
    octx.imageSmoothingQuality = 'high'
    octx.drawImage(bmp, sx, sy, sw, sh, 0, 0, tw, th)

    const outBlob = await outCv.convertToBlob({ type: 'image/webp', quality: 0.88 })
    const fr = new FileReader()
    const outB64 = await new Promise(res => {
      fr.onload = () => res(fr.result.split(',')[1])
      fr.readAsDataURL(outBlob)
    })
    return { outB64, tw, th }
  }, { b64, kind, crop: item.crop ?? null })

  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, Buffer.from(result.outB64, 'base64'))

  const src = out.replace(/^public/, '')
  if (kind === 'piece') {
    // Дизайн-бокс плейсхолдера: h=144, якорь у «ступней» (0.5, 0.95).
    manifest[key] = { src, pivot: [0.5, 0.97], worldScale: +(144 / result.th).toFixed(5) }
  } else {
    manifest[key] = { src }
  }
  console.error(`ok ${key} ${result.tw}x${result.th} ← ${out}`)
}

await browser.close()
console.log(JSON.stringify(manifest, null, 2))
