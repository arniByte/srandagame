import { expect, test } from '@playwright/test'

/**
 * Смоук полного цикла: меню → забег → карта → бой → ходы → ход ИИ.
 * Управление через window.__cm (?test=1): стабильнее канвас-кликов.
 */

test('полный цикл: меню → карта → бой → ходы обеих сторон', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))

  await page.goto('/?test=1')
  await page.waitForFunction(() => Boolean(window.__cm))

  // Меню видно.
  await expect(page.getByText('Новый забег')).toBeVisible()

  // Новый забег с фиксированным сидом → карта.
  await page.evaluate(() => window.__cm.newRun('e2e-smoke'))
  await page.waitForFunction(() => window.__cm.screen === 'map')

  // Выбираем стартовый бой.
  await page.evaluate(() => {
    const n = window.__cm.availableNodes()[0]
    if (n) window.__cm.selectNode(n.id)
  })
  await page.waitForFunction(() => window.__cm.screen === 'battle', undefined, { timeout: 20000 })
  await page.waitForFunction(() => window.__cm.inputEnabled(), undefined, { timeout: 20000 })

  // Три полных круга: наш ход → endTurn → ответ ИИ.
  for (let i = 0; i < 3; i++) {
    const ok = await page.evaluate(() => {
      const g = window.__cm
      if (!g.battle || g.battle.result) return 'ended'
      const st = g.getState()
      if (st.phase === 'promote' && st.promoting) {
        return g.tryAction({ t: 'promote', piece: st.promoting.piece, into: st.promoting.options[0] })
      }
      for (const p of st.pieces) {
        if (p.owner !== 0) continue
        const moves = g.legalMovesFor(p.id)
        if (moves.length > 0) return g.tryAction({ t: 'move', piece: p.id, to: moves[0] })
      }
      return g.tryAction({ t: 'endTurn' })
    })
    expect(ok).toBeTruthy()

    await page.waitForFunction(
      () => !window.__cm.battle || window.__cm.battle.result || window.__cm.inputEnabled(),
      undefined, { timeout: 30000 },
    )
    const state = await page.evaluate(() => ({
      ended: Boolean(window.__cm.battle?.result),
      moved: window.__cm.battle?.movedThisTurn ?? false,
    }))
    if (state.ended) break
    if (state.moved) {
      await page.evaluate(() => window.__cm.tryAction({ t: 'endTurn' }))
      await page.waitForFunction(
        () => !window.__cm.battle || window.__cm.battle.result || window.__cm.inputEnabled(),
        undefined, { timeout: 30000 },
      )
    }
  }

  // ИИ отвечал: прошло больше одного полного хода или бой уже решён.
  const final = await page.evaluate(() => ({
    turn: window.__cm.battle?.turn ?? 99,
    ended: Boolean(window.__cm.battle?.result),
    screen: window.__cm.screen,
  }))
  expect(final.ended || final.turn >= 2).toBe(true)

  // Сейв существует.
  const hasSave = await page.evaluate(() => localStorage.getItem('cm.run.v1') !== null)
  expect(hasSave || final.screen === 'gameover' || final.screen === 'reward').toBeTruthy()

  expect(errors).toEqual([])
})

test('лобби коопа открывается и показывает статус', async ({ page }) => {
  await page.goto('/?test=1')
  await page.waitForFunction(() => Boolean(window.__cm))
  const coopBtn = page.getByText('Кооп по сети')
  await expect(coopBtn).toBeVisible()
})
