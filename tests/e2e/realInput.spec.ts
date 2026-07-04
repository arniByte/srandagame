import { expect, test } from '@playwright/test'

/**
 * Регрессия ввода НАСТОЯЩЕЙ мышью: клик по фигуре → ход; drag карты на поле.
 * Ловит перекрытия канваса DOM-оверлеями и глушение hit-testing в Pixi
 * (оба бага уже случались — см. CONTEXT.md).
 */

test('реальный клик двигает фигуру, drag разыгрывает карту', async ({ page }) => {
  await page.goto('/?test=1')
  await page.waitForFunction(() => Boolean(window.__cm))
  await page.evaluate(() => window.__cm.newRun('e2e-real-input'))
  await page.evaluate(() => window.__cm.selectNode(window.__cm.availableNodes()[0]!.id))
  await page.waitForFunction(() => window.__cm.screen === 'battle' && window.__cm.inputEnabled(),
    undefined, { timeout: 30000 })
  await page.waitForTimeout(1200)

  // Канвас не должен быть перекрыт DOM-элементами.
  const under = await page.evaluate(() => {
    const el = document.elementFromPoint(innerWidth * 0.3, innerHeight * 0.5)
    return el?.id ?? el?.tagName ?? ''
  })
  expect(under).toBe('game')

  // 1) Клик по своей фигуре, затем по клетке хода.
  const move = await page.evaluate(() => {
    const g = window.__cm
    for (const p of g.getState().pieces) {
      if (p.owner !== 0) continue
      const ms = g.legalMovesFor(p.id)
      if (ms.length > 0) {
        return { fromXY: g.debugTileXY(p.pos), toXY: g.debugTileXY(ms[0]!) }
      }
    }
    return null
  })
  expect(move).not.toBeNull()
  await page.mouse.click(move!.fromXY!.x, move!.fromXY!.y - 8)
  await page.waitForTimeout(300)
  await page.mouse.click(move!.toXY!.x, move!.toXY!.y)
  await page.waitForFunction(() => window.__cm.getState().movedThisTurn,
    undefined, { timeout: 8000 })

  // 2) Drag первой карты руки на её легальную цель (или центр доски).
  await page.evaluate(() => window.__cm.tryAction({ t: 'endTurn' }))
  await page.waitForFunction(() => window.__cm.inputEnabled(), undefined, { timeout: 30000 })
  const before = await page.evaluate(() =>
    JSON.stringify({ hand: window.__cm.getState().sides[0]!.hand.length, paint: window.__cm.getState().sides[0]!.paint }))
  const card = await page.evaluate(() => window.__cm.debugFirstCard())
  expect(card).not.toBeNull()
  const target = await page.evaluate(() => {
    const g = window.__cm
    const st = g.getState()
    const iid = st.sides[0]!.hand[0]!
    const ts = g.legalTargetsFor(iid)
    const sq = ts.length > 0 ? ts[0]! : (st.board.w >> 1) + (st.board.h >> 1) * 16
    return g.debugTileXY(sq)
  })
  await page.mouse.move(card!.x, card!.y, { steps: 4 })
  await page.mouse.down()
  await page.mouse.move(target!.x, target!.y, { steps: 14 })
  await page.waitForTimeout(250)
  await page.mouse.up()
  await page.waitForTimeout(1200)
  const after = await page.evaluate(() =>
    JSON.stringify({ hand: window.__cm.getState().sides[0]!.hand.length, paint: window.__cm.getState().sides[0]!.paint }))
  expect(after).not.toBe(before)
})
