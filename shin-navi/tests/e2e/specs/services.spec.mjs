// M10 services acceptance (SPEC L/M10 1–4, T08, and the M10 parts of T12/T14/G-1).
// Order tab (MO), toast coaster, bring-in card + sheet, the entrance and the travel journal.
export const name = 'services'

const Q = '?test=1&seed=test&reset=1'

export async function run({ openApp, assert, step }) {
  const opened = []
  const open = async (...a) => {
    const r = await openApp(...a)
    opened.push(r.context)
    return r
  }
  const stepC = (label, fn) =>
    step(label, async () => {
      try {
        await fn()
      } finally {
        while (opened.length) await opened.pop().close().catch(() => {})
      }
    })
  const noErrors = (errors, where) => assert.deepEqual(errors, [], `${where}: console/page errors\n${errors.join('\n')}`)
  const S = (page, fn, arg) => page.evaluate(fn, arg)
  const pins = page => S(page, () => window.__navi.get().col.pins.length)
  const orders = page => S(page, () => window.__navi.get().orders.list.length)
  /** Put a hand-made card on top of the deck (test shortcut; the director deals these in a real night). */
  const dealTop = (page, card) =>
    S(page, c => {
      const full = { id: `e2e-${c.kind}-${Math.random().toString(36).slice(2, 7)}`, trigger: { type: 'refill', at: 0 }, rule: 'e2e', dealtAt: Date.now(), ...c }
      window.__navi.api.getState().dealCards([full], 'top')
      return full.id
    }, card)
  const noHScroll = async (page, w, where) => {
    const sw = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth))
    assert.ok(sw <= w, `${where}: no horizontal scroll (scrollWidth ${sw} > ${w})`)
  }

  // ---------------------------------------------------------------- T08: MO on the order tab
  await stepC('T08: order → accepted ≤2 s; re-tap is a duplicate; "one more" adds; exit closes; no pins', async () => {
    const { page, errors } = await open('phone', `${Q}&intro=0`)
    await page.waitForSelector('[data-testid=dock-order]')
    await page.waitForTimeout(500)
    const pins0 = await pins(page)
    await page.click('[data-testid=dock-order]')
    const item = page.locator('[data-testid=order-item][data-menu=highball]')
    await item.waitFor({ state: 'visible' })
    // no prices anywhere on the menu (J-5)
    const text = await page.locator('[data-testid=order-screen]').innerText()
    assert.doesNotMatch(text, /[¥￥$€]\s?\d|\d+\s?円/, 'no prices on the menu')
    assert.match(text, /価格は店舗の表示に従います（デモ）/)

    await item.click()
    await page.locator('[data-testid=order-status][data-status=accepted]').first().waitFor({ state: 'attached', timeout: 2000 })
    assert.equal(await orders(page), 1)

    await item.click()
    await page.locator('[data-testid=order-dup-note]').waitFor({ state: 'visible' })
    assert.match(await page.locator('[data-testid=order-dup-note]').innerText(), /同じ注文は受付済み（\d\d:\d\d）/)
    assert.equal(await orders(page), 1, 'a re-tap does not add an order')
    assert.equal(await S(page, () => window.__navi.get().metrics.mo.dupBlocked), 1)

    await page.click('[data-testid=order-again]')
    await page.waitForTimeout(150)
    assert.equal(await orders(page), 2, '"one more" adds explicitly')
    assert.equal(await page.locator('[data-testid=order-item][data-menu=highball]').getAttribute('data-count'), '2')

    // the lane shows the glass of light two songs ahead (M6)
    await page.locator('[data-testid=lane-glass]').first().waitFor({ state: 'attached', timeout: 2500 })

    // exit through the presenter panel: the room closes ordering
    await page.keyboard.press('?')
    await page.locator('[data-testid=pp-exit]').waitFor({ state: 'visible' })
    await page.click('[data-testid=pp-exit]')
    await page.waitForFunction(() => window.__navi.get().session.phase !== 'live')
    await S(page, () => {
      const s = window.__navi.api.getState()
      if (s.ui.presenter) s.togglePresenter()
      s.setOverlay(null)
      s.setTab('order')
    })
    await page.locator('[data-testid=order-closed]').waitFor({ state: 'visible' })
    assert.match(await page.locator('[data-testid=order-closed]').innerText(), /注文は締め切りました/)
    const disabled = await page.$$eval('[data-testid=order-item]', els => els.map(e => e.disabled))
    assert.ok(disabled.length === 8 && disabled.every(Boolean), 'every tile is disabled after leaving')
    await page.locator('[data-testid=order-item][data-menu=cola]').click({ force: true })
    assert.equal(await orders(page), 2, 'no order after leaving')
    const statuses = await page.$$eval('[data-testid=order-status]', els => els.map(e => e.getAttribute('data-status')))
    assert.ok(statuses.every(s => s === 'closed' || s === 'delivered'), `open orders are closed (${statuses})`)
    assert.equal(await pins(page), pins0, 'ordering earns no pins')
    noErrors(errors, 'T08')
  })

  await stepC('order: "ひと休み" makes no order and slows the room for one song; water is free', async () => {
    const { page, errors } = await open('phone', `${Q}&intro=0`)
    await page.waitForSelector('[data-testid=dock-order]')
    await page.click('[data-testid=dock-order]')
    const rest = page.locator('[data-testid=order-item][data-menu=rest]')
    await rest.waitFor({ state: 'visible' })
    await rest.click()
    await page.waitForTimeout(200)
    assert.equal(await orders(page), 0, 'the breather orders nothing')
    assert.ok(await S(page, () => window.__navi.get().room.restUntil > window.__navi.get().session.simMs), 'room flows at half speed')
    assert.match(await page.locator('[data-testid=order-item][data-menu=water]').innerText(), /無料/)
    noErrors(errors, 'rest')
  })

  await stepC('order: 360×740 fits without horizontal scroll', async () => {
    const { page, errors } = await open('small', `${Q}&intro=0`)
    await page.waitForSelector('[data-testid=dock-order]')
    await page.click('[data-testid=dock-order]')
    await page.locator('[data-testid=order-item]').first().waitFor({ state: 'visible' })
    await page.click('[data-testid=order-item][data-menu=ginger]')
    await page.waitForTimeout(1200)
    await noHScroll(page, 360, 'order small')
    noErrors(errors, 'order small')
  })

  // ---------------------------------------------------------------- C-8 ⑨ toast coaster
  await stepC('coaster: one tap orders; same drink again shakes + note; "one more"; water/rest orders nothing', async () => {
    const { page, errors } = await open('phone', `${Q}&intro=0`)
    await page.waitForSelector('[data-testid=deck]')
    await page.waitForTimeout(400)
    await dealTop(page, { kind: 'coaster', reason: { source: 'yomu', text: { key: 'reason.coaster' }, cause: { key: 'cause.peak3' } } })
    await page.locator('[data-testid=card-top][data-kind=coaster]').waitFor({ state: 'visible' })
    const card = page.locator('[data-testid=card-top][data-kind=coaster]')
    assert.match(await card.innerText(), /ここらで乾杯する？/)
    assert.match(await card.innerText(), /今頼むと2曲後に届く目安（デモ）/)
    assert.equal(await card.locator('[data-testid=coaster-drink]').count(), 3)
    const first = card.locator('[data-testid=coaster-drink]').first()
    await first.click()
    await page.waitForFunction(() => window.__navi.get().orders.list[0]?.status === 'accepted', null, { timeout: 2000 })
    await first.click()
    await card.locator('[data-testid=coaster-dup-note]').waitFor({ state: 'visible' })
    assert.equal(await orders(page), 1)
    await card.locator('[data-testid=coaster-again]').click()
    await page.waitForTimeout(150)
    assert.equal(await orders(page), 2)
    // the toast marks tonight's wall of light (the next point carries the glass)
    const markers = await S(page, () => {
      const s = window.__navi.api.getState()
      s.addWallPoint({ t: 1, heat: 0.5, songId: 'marigold', by: 'minato', claps: 0, markers: [] })
      return window.__navi.get().col.nights.find(x => x.id === s.session.nightId).points.at(-1).markers
    })
    assert.ok(markers.includes('toast'), `toast marker on the wall (${markers})`)
    // the primary button orders the highlighted drink: a duplicate again, nothing added
    await page.click('[data-testid=btn-primary]')
    await page.waitForTimeout(150)
    assert.equal(await orders(page), 2)
    // "メニューを見る" opens the order tab
    await card.locator('[data-testid=coaster-menu]').click()
    await page.locator('[data-testid=order-screen]').waitFor({ state: 'visible' })
    await page.click('[data-testid=dock-discover]')
    await page.waitForTimeout(300)
    // "お水・ひと休み": no order, the card leaves, the director notes it
    await page.locator('[data-testid=card-top][data-kind=coaster] [data-testid=coaster-rest]').click()
    await page.waitForTimeout(400)
    assert.equal(await orders(page), 2)
    assert.equal(await S(page, () => window.__navi.get().deck.cards.some(c => c.kind === 'coaster')), false)
    noErrors(errors, 'coaster')
  })

  // ---------------------------------------------------------------- C-8 ⑧ bring-in
  await stepC('import card: silver candidates, nothing saved on its own, version pick + explicit save, show 10 s', async () => {
    const { page, errors } = await open('phone', `${Q}&intro=0`)
    await page.waitForSelector('[data-testid=deck]')
    await page.waitForTimeout(400)
    const ids = await S(page, () => window.__navi.get().col.imports.map(i => i.songId))
    assert.equal(ids.length, 5)
    await dealTop(page, { kind: 'import', songId: ids[0], options: ids, reason: { source: 'ren', text: { key: 'reason.import' } } })
    const card = page.locator('[data-testid=card-top][data-kind=import]')
    await card.waitFor({ state: 'visible' })
    assert.equal(await card.locator('[data-testid=import-candidate][data-status=candidate]').count(), 5)
    assert.ok((await card.locator('[data-private="1"]').count()) >= 1, 'personal (data-private)')
    await page.waitForTimeout(1500)
    assert.equal(await S(page, () => window.__navi.get().col.saved.length), 0, 'never saved automatically')
    // original is preselected
    assert.equal(await card.locator('[data-testid=import-version][aria-checked=true]').getAttribute('data-version'), 'original')
    await card.locator(`[data-testid=import-candidate][data-song-id="${ids[1]}"]`).click()
    const versions = await card.locator('[data-testid=import-version]').evaluateAll(els => els.map(e => e.getAttribute('data-version')))
    const pick = versions.includes('karaoke') ? 'karaoke' : versions[versions.length - 1]
    await card.locator(`[data-testid=import-version][data-version=${pick}]`).click()
    const flights = S(page, () => new Promise(res => {
      const seen = []
      const t0 = performance.now()
      const iv = setInterval(() => {
        const n = document.querySelectorAll('.fdisc').length
        if (n) seen.push(n)
        if (performance.now() - t0 > 600) {
          clearInterval(iv)
          res(seen.length ? Math.max(...seen) : 0)
        }
      }, 16)
    }))
    await page.click('[data-testid=btn-primary]')
    assert.equal(await flights, 1, 'exactly one disc flies to the ball')
    await page.waitForTimeout(300)
    const saved = await S(page, () => window.__navi.get().col.saved)
    assert.deepEqual(saved.map(x => [x.songId, x.version, x.from]), [[ids[1], pick, 'import']])
    const face = await S(page, id => window.__navi.get().col.faces[id], ids[1])
    assert.equal(face.state, 'sketch')
    assert.ok(face.marks.includes('stitch'))
    assert.equal(await card.locator(`[data-testid=import-candidate][data-song-id="${ids[1]}"]`).getAttribute('data-status'), 'saved')
    // show just one title to the room for ten seconds
    await card.locator('[data-testid=import-show]').click()
    const shown = await S(page, () => window.__navi.get().room.prompt)
    assert.equal(shown?.kind, 'show')
    await page.waitForTimeout(10_300)
    assert.equal(await S(page, () => window.__navi.get().room.prompt), null, 'the room display ends after 10 s')
    noErrors(errors, 'import card')
  })

  await stepC('import sheet: shelf of discs, version chips, explicit save; room screen shows none of it', async () => {
    const { page, errors } = await open('phone', `${Q}&intro=0`)
    await page.waitForSelector('[data-testid=deck]')
    await page.waitForTimeout(300)
    await S(page, () => window.__navi.api.getState().openSheet('import'))
    const sheet = page.locator('[data-testid=sheet][data-sheet=import]')
    await sheet.waitFor({ state: 'visible' })
    assert.equal(await sheet.getAttribute('data-private'), '1')
    assert.equal(await sheet.locator('[data-testid=import-candidate]').count(), 5)
    assert.match(await sheet.innerText(), /例：Apple Music・デモデータ/)
    await sheet.locator('[data-testid=import-save]').click()
    await page.waitForTimeout(300)
    assert.equal(await S(page, () => window.__navi.get().col.saved.length), 1)
    assert.equal(await sheet.locator('[data-testid=import-save]').isDisabled(), true)
    noErrors(errors, 'import sheet')

    const b = await open('tablet', `${Q}&intro=0`)
    await b.page.waitForSelector('[data-testid=room-board]')
    await b.page.waitForTimeout(400)
    const leaked = await b.page.$$eval('[data-testid=import-candidate], [data-testid=order-screen], [data-testid=entry-screen]', els => els.filter(e => e.getBoundingClientRect().width > 0).length)
    assert.equal(leaked, 0, 'no personal services UI on the room screen')
    noErrors(b.errors, 'room')
  })

  // ---------------------------------------------------------------- S0 entrance + travel journal
  await stepC('entrance: five languages switch in place, three ways in, guest walks into S1 with the full intro', async () => {
    const { page, errors } = await open('phone', `${Q}&entry=1`)
    await page.locator('[data-testid=entry-screen]').waitFor({ state: 'visible' })
    assert.equal(await page.locator('[data-testid=entry-lang]').count(), 5)
    for (const id of ['entry-guest', 'entry-continue', 'entry-voucher']) assert.equal(await page.locator(`[data-testid=${id}]`).count(), 1, id)
    assert.match(await page.locator('[data-testid=entry-screen]').innerText(), /模擬。実際の予約・決済にはつながりません/)
    await page.evaluate(() => (window.__marker = 1))
    await page.click('[data-testid=entry-lang][data-locale=ko]')
    await page.waitForFunction(() => document.documentElement.lang === 'ko')
    assert.match(await page.locator('[data-testid=entry-guest]').innerText(), /게스트로 입장/)
    assert.equal(await page.evaluate(() => window.__marker), 1, 'no reload')
    await page.click('[data-testid=entry-lang][data-locale=ja]')
    await page.waitForFunction(() => document.documentElement.lang === 'ja')
    const nightBefore = await S(page, () => window.__navi.get().session.nightId)
    await page.click('[data-testid=entry-guest]')
    await page.locator('[data-testid=entry-screen]').waitFor({ state: 'detached', timeout: 3000 })
    const st = await S(page, () => ({ overlay: window.__navi.get().ui.overlay, id: window.__navi.get().session.nightId, nights: window.__navi.get().col.nights.length, visit: window.__navi.get().session.visit }))
    assert.equal(st.overlay, null)
    assert.notEqual(st.id, nightBefore, 'a fresh night starts when you walk in')
    assert.equal(st.nights, 1, 'the placeholder night does not linger')
    assert.equal(st.visit, 1)
    assert.equal(await page.getAttribute('[data-testid=app-root]', 'data-intro'), 'full')
    await page.locator('[data-testid=card-top][data-kind=song][data-variant=opener]').waitFor({ state: 'visible', timeout: 4000 })
    noErrors(errors, 'entrance')
  })

  await stepC('travel journal: 5 steps, a passport stamp for each, marked as a mock; ends in S1', async () => {
    const { page, errors } = await open('phone', `${Q}&entry=1`)
    await page.locator('[data-testid=entry-voucher]').waitFor({ state: 'visible' })
    await page.click('[data-testid=entry-voucher]')
    const flow = page.locator('[data-testid=ota-flow]')
    await flow.waitFor({ state: 'visible' })
    const stamps = () => page.locator('[data-testid=ota-stamp][data-done="1"]').count()
    assert.equal(await stamps(), 0)
    for (let i = 1; i <= 5; i++) {
      await page.waitForFunction(n => document.querySelector('[data-testid=ota-flow]')?.getAttribute('data-step') === String(n), i, { timeout: 4000 })
      assert.match(await flow.innerText(), /模擬。実際の予約・決済にはつながりません/, `step ${i} says it is a mock`)
      if (i === 4) {
        // the front desk checks the voucher by itself, then stamps
        await page.waitForFunction(() => document.querySelectorAll('[data-testid=ota-stamp][data-done="1"]').length === 4, null, { timeout: 4000 })
        await page.waitForFunction(() => !document.querySelector('[data-testid=ota-next]')?.disabled)
      }
      await page.click('[data-testid=ota-next]')
      if (i !== 4) await page.waitForFunction(n => document.querySelectorAll('[data-testid=ota-stamp][data-done="1"]').length >= n, i, { timeout: 3000 })
    }
    assert.equal(await stamps(), 5)
    await page.locator('[data-testid=entry-screen]').waitFor({ state: 'detached', timeout: 5000 })
    assert.equal(await S(page, () => window.__navi.get().ui.overlay), null)
    assert.ok(await S(page, () => window.__navi.get().metrics.mo.placed === 0), 'no order or payment happened')
    await page.locator('[data-testid=card-top]').first().waitFor({ state: 'visible', timeout: 4000 })
    noErrors(errors, 'journal')
  })

  await stepC('entrance: 360×740 fits; presenter-opened entrance keeps the running night', async () => {
    const { page, errors } = await open('small', `${Q}&entry=1`)
    await page.locator('[data-testid=entry-screen]').waitFor({ state: 'visible' })
    await noHScroll(page, 360, 'entry small')
    const box = await page.locator('[data-testid=entry-voucher]').boundingBox()
    assert.ok(box && box.y + box.height <= 740, 'the three doors are on screen')
    await page.click('[data-testid=entry-voucher]')
    await page.locator('[data-testid=ota-flow]').waitFor({ state: 'visible' })
    await noHScroll(page, 360, 'journal small')
    noErrors(errors, 'entry small')

    const b = await open('phone', `${Q}&intro=0`)
    await b.page.waitForSelector('[data-testid=dock-order]')
    await b.page.click('[data-testid=dock-order]')
    await b.page.click('[data-testid=order-item][data-menu=water]')
    const id = await S(b.page, () => window.__navi.get().session.nightId)
    await S(b.page, () => window.__navi.api.getState().setOverlay('entry'))
    await b.page.locator('[data-testid=entry-guest]').waitFor({ state: 'visible' })
    await b.page.click('[data-testid=entry-guest]')
    await b.page.locator('[data-testid=entry-screen]').waitFor({ state: 'detached', timeout: 3000 })
    assert.equal(await S(b.page, () => window.__navi.get().session.nightId), id, 'mid-night: same night')
    assert.equal(await orders(b.page), 1)
    noErrors(b.errors, 'presenter entry')
  })
}
