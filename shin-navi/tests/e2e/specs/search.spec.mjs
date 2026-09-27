// M8 search-mixer acceptance (SPEC L/M8 1–5; the M8 parts of T05, T06 and T12).
// Search in any script from the real sheet, result contents, reserve / keep from a result,
// evidence vs hypothesis filters, the gap arrival, the air mixer and the language sheet.
export const name = 'search'

const Q = '?test=1&seed=test&reset=1&intro=0'
const RAW_KEY = /^[a-zA-Z]+\.[\w.]+$/

export async function run({ openApp, assert, step }) {
  const opened = []
  const open = async (...a) => {
    const r = await openApp(...a)
    opened.push(r.context)
    await r.page.waitForSelector(a[0] === 'tablet' ? '[data-testid=room-board]' : '[data-testid=search-bar]')
    await r.page.waitForTimeout(500)
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
  const get = (page, fn, arg) => page.evaluate(fn, arg)
  const sheetId = page => get(page, () => window.__navi.get().ui.sheet?.id ?? null)
  const openSearch = async page => {
    await page.click('[data-shell=phone] [data-testid=search-bar]')
    await page.locator('[data-testid=sheet][data-sheet=search]').waitFor({ state: 'visible' })
    await page.waitForTimeout(450)
  }
  const type = async (page, q) => {
    await page.locator('[data-testid=search-input]').fill(q)
    await page.waitForTimeout(160)
  }
  /** Result rows of the query itself (not the "often picked with" section). */
  const mainIds = page =>
    page.$$eval('[data-testid=search-result]', els => els.filter(e => !e.closest('[data-testid=search-co]')).map(e => e.getAttribute('data-song-id')))
  const noRawKeys = async (page, sel, where) => {
    const texts = await page.$$eval(`${sel} *`, els => els.filter(e => e.children.length === 0).map(e => (e.textContent || '').trim()).filter(Boolean))
    const raw = texts.filter(t => /^[a-zA-Z]+\.[\w.]+$/.test(t))
    assert.deepEqual(raw, [], `${where}: raw i18n keys ${raw.join(', ')}`)
  }

  // ---------------------------------------------------------------- the bar
  await stepC('search bar: always visible at y 108–148, tap and hero swipe-up open the sheet', async () => {
    const { page, errors } = await open('phone', Q)
    const bar = await page.locator('[data-shell=phone] [data-testid=search-bar]').boundingBox()
    assert.ok(bar, 'search bar present')
    assert.ok(bar.y >= 104 && bar.y + bar.height <= 152, `bar at y ${bar.y}–${bar.y + bar.height}`)
    assert.equal(await page.locator('[data-anchor=search]').count() > 0, true, 'data-anchor=search')
    await openSearch(page)
    assert.equal(await sheetId(page), 'search')
    await page.keyboard.press('Escape')
    await page.locator('[data-testid=sheet]').waitFor({ state: 'detached' })
    assert.equal(await sheetId(page), null)
    // swipe up on the hero background (left of the ball), staying inside the hero: a mouse has
    // no implicit capture, so the release must land on the hero as a finger's would
    const hero = await page.locator('[data-shell=phone] [data-testid=hero]').boundingBox()
    const x = hero.x + 24
    const y0 = hero.y + hero.height - 30
    await page.mouse.move(x, y0)
    await page.mouse.down()
    for (let i = 1; i <= 6; i++) await page.mouse.move(x, y0 - i * 18)
    await page.mouse.up()
    await page.waitForTimeout(400)
    assert.equal(await sheetId(page), 'search', 'swipe up on the hero background opens search')
    noErrors(errors, 'bar')
  })

  // ---------------------------------------------------------------- M8 #1 in the real sheet
  await stepC('M8#1 any script: 잔혹한 / zankoku / 残酷天使 / ざんこく → zankoku; 밤을 / yoru ni; Gurenge / 紅蓮; 米津', async () => {
    const { page, errors } = await open('phone', Q)
    await openSearch(page)
    // the sheet rises under the lane: the lane centre still hits the lane (T05)
    const lane = await page.locator('[data-shell=phone] [data-testid=stage-lane]').boundingBox()
    const sheet = await page.locator('[data-testid=sheet][data-sheet=search]').boundingBox()
    assert.ok(sheet.y >= lane.y + lane.height - 1, `sheet top ${sheet.y} below lane bottom ${lane.y + lane.height}`)
    const hit = await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('[data-testid=stage-lane]'), [lane.x + lane.width / 2, lane.y + lane.height / 2])
    assert.ok(hit, 'lane centre is hittable with the sheet open')
    for (const [q, id] of [
      ['잔혹한', 'zankoku'],
      ['zankoku', 'zankoku'],
      ['残酷天使', 'zankoku'],
      ['ざんこく', 'zankoku'],
      ['밤을', 'yoru-ni-kakeru'],
      ['yoru ni', 'yoru-ni-kakeru'],
      ['Gurenge', 'gurenge'],
      ['紅蓮', 'gurenge'],
    ]) {
      await type(page, q)
      const ids = await mainIds(page)
      assert.equal(ids[0], id, `"${q}" → ${ids.slice(0, 3).join(', ')}`)
    }
    // the top hit carries its title in every script, with the matched one lit
    await type(page, '잔혹한')
    const lit = page.locator('[data-testid=search-result] [data-testid=search-scripts] .sx-script.is-hit').first()
    assert.match(await lit.textContent(), /잔혹한 천사의 테제/)
    await type(page, '米津')
    const artists = await page.$$eval('[data-testid=search-result]', els =>
      els.filter(e => !e.closest('[data-testid=search-co]')).map(e => e.querySelector('.sx-row__artist')?.textContent ?? ''),
    )
    assert.ok(artists.length >= 3, `米津 finds several songs (${artists.length})`)
    for (const a of artists) assert.match(a, /米津玄師/)
    // a miss is logged, and it says how to search instead of going blank
    const before = await get(page, () => window.__navi.get().metrics.search)
    await type(page, 'zzqxv')
    assert.ok(await page.locator('[data-testid=search-none]').isVisible(), 'no-match state')
    await page.waitForTimeout(900)
    const after = await get(page, () => window.__navi.get().metrics.search)
    assert.ok(after.queries > before.queries, 'query logged')
    assert.equal(after.misses, before.misses + 1, 'miss logged')
    await noRawKeys(page, '[data-testid=sheet][data-sheet=search]', 'search sheet')
    noErrors(errors, 'any script')
  })

  // ---------------------------------------------------------------- M8 #2 result contents, reserve and keep
  await stepC('M8#2 results: titles, versions, language, not reservable note, reserve → lane + 予約済み #n, keep → sketch face', async () => {
    const { page, errors } = await open('phone', Q)
    await openSearch(page)
    await type(page, 'zankoku')
    const row = page.locator('[data-testid=search-result][data-song-id=zankoku]').first()
    const text = await row.textContent()
    assert.match(text, /残酷な天使のテーゼ/, 'original title')
    assert.match(text, /Zankoku na Tenshi no Teeze/, 'romaji')
    assert.match(text, /アニメ映像/, 'version chip')
    assert.match(text, /カラオケ版/, 'version chip')
    assert.match(text, /日本語/, 'language')
    // a song this shop cannot play yet: the button is disabled and says why
    await type(page, 'magnetic')
    const na = page.locator('[data-testid=search-result][data-song-id=magnetic]').first()
    assert.equal(await na.getAttribute('data-reservable'), '0')
    assert.ok(await na.locator('[data-testid=search-reserve]').isDisabled(), 'reserve disabled')
    assert.match(await na.textContent(), /配信準備中（デモ）/)
    // reserve: lane gets the song, the row turns into "予約済み #n"
    await type(page, 'マリーゴールド')
    const mg = page.locator('[data-testid=search-result][data-song-id=marigold]').first()
    const t0 = Date.now()
    await mg.locator('[data-testid=search-reserve]').click()
    await page.locator('[data-shell=phone] [data-testid=lane-item][data-song-id=marigold]').first().waitFor({ state: 'attached', timeout: 1000 })
    assert.ok(Date.now() - t0 < 1500, 'lane updated within a second')
    const badge = mg.locator('[data-testid=search-reserved-pos]')
    await badge.waitFor({ state: 'visible' })
    const shown = await get(page, () => {
      const s = window.__navi.get()
      const el = document.querySelector('[data-testid=search-result][data-song-id=marigold] [data-testid=search-reserved-pos]')
      return { text: (el?.textContent ?? '').replace(/\s+/g, ' ').trim(), pos: s.room.now?.item.songId === 'marigold' ? 0 : s.room.queue.findIndex(q => q.songId === 'marigold') + 1 }
    })
    assert.equal(shown.text, shown.pos === 0 ? '演奏中' : `予約済み #${shown.pos}`)
    const item = await get(page, () => window.__navi.get().room.queue.find(q => q.songId === 'marigold'))
    assert.equal(item.by, 'me')
    const m = await get(page, () => window.__navi.get().metrics.search)
    assert.equal(m.msToReserve.length, 1, 'search → reserve time logged')
    assert.equal(await get(page, () => window.__navi.get().col.faces.marigold?.state), 'neon', 'reserved face is neon')
    // keep another result: a sketch face on the ball
    await type(page, 'Lemon')
    const lemon = page.locator('[data-testid=search-result][data-song-id=lemon]').first()
    const sketch0 = Number(await page.getAttribute('[data-shell=phone] [data-testid=ball-canvas]', 'data-sketch'))
    await lemon.locator('[data-testid=search-keep]').click()
    await page.waitForTimeout(600)
    assert.equal(await get(page, () => window.__navi.get().col.faces.lemon?.state), 'sketch')
    assert.ok(await lemon.locator('[data-testid=search-keep]').isDisabled(), 'keep turns into "kept"')
    const sketch1 = Number(await page.getAttribute('[data-shell=phone] [data-testid=ball-canvas]', 'data-sketch'))
    assert.equal(sketch1, sketch0 + 1, 'ball data-sketch +1')
    noErrors(errors, 'results')
  })

  // ---------------------------------------------------------------- M8 #3 filters and the gap arrival
  await stepC('M8#3 filters: evidence solid, Navi’s read dotted; a gap card opens the sheet pre-filtered', async () => {
    const { page, errors } = await open('phone', Q)
    await openSearch(page)
    const ev = page.locator('[data-testid=filter-chip][data-kind=evidence]')
    const hy = page.locator('[data-testid=filter-chip][data-kind=hypothesis]')
    assert.ok((await ev.count()) >= 12 + 3, 'genre + tempo + decade + language chips')
    assert.ok((await hy.count()) >= 8, 'hypothesis chips')
    assert.match(await ev.first().getAttribute('class'), /chip--solid/)
    assert.match(await hy.first().getAttribute('class'), /chip--dotted/)
    for (const facet of ['genre', 'tempo', 'decade', 'lang']) assert.ok(await page.locator(`[data-testid=filter-chip][data-facet=${facet}]`).count(), `facet ${facet}`)
    assert.match(await page.locator('.sx-chips--hyp').textContent(), /ナビの見立て/)
    await page.click('[data-testid=filter-chip][data-facet=genre][data-value=アニメ]')
    await page.waitForTimeout(200)
    const genres = await page.$$eval('[data-testid=search-result]', els => els.map(e => e.getAttribute('data-genre')))
    assert.ok(genres.length > 3 && genres.every(g => g === 'アニメ'), 'genre filter holds')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
    // the real gap card: its primary action opens the area pre-filtered
    const area = await get(page, () => {
      const s = window.__navi.get()
      const c = s.deck.cards.find(x => x.kind === 'gap')
      if (!c) return null
      s.act(c.id, 'openArea')
      return c.area
    })
    assert.ok(area, 'a gap card is in the first hand')
    const [tempo, genre] = area.split(':')
    await page.locator('[data-testid=sheet][data-sheet=search]').waitFor({ state: 'visible' })
    await page.waitForTimeout(450)
    assert.equal(await page.getAttribute(`[data-testid=filter-chip][data-facet=tempo][data-value="${tempo}"]`, 'aria-pressed'), 'true')
    assert.equal(await page.getAttribute(`[data-testid=filter-chip][data-facet=genre][data-value="${genre}"]`, 'aria-pressed'), 'true')
    const rows = await page.$$eval('[data-testid=search-result]', els => els.map(e => [e.getAttribute('data-tempo'), e.getAttribute('data-genre')]))
    assert.ok(rows.length >= 3 && rows.every(([t, g]) => t === tempo && g === genre), 'only the area’s songs')
    const banner = page.locator('[data-testid=search-area]')
    assert.equal(await banner.getAttribute('data-lit'), '0')
    await page.locator('[data-testid=search-result] [data-testid=search-keep]').first().click()
    await page.waitForTimeout(300)
    assert.equal(await banner.getAttribute('data-lit'), '1', 'first light in the area')
    noErrors(errors, 'filters')
  })

  // ---------------------------------------------------------------- M8 #4 the air mixer
  await stepC('M8#4 mixer: companion prefilled, drag recolours the aurora and rings notes, release sets the mood and redeals', async () => {
    const { page, errors } = await open('phone', Q)
    await page.click('[data-testid=mixer-open]')
    await page.locator('[data-testid=sheet][data-sheet=mixer]').waitFor({ state: 'visible' })
    await page.waitForTimeout(500)
    const companion = await get(page, () => window.__navi.get().room.mood.companion)
    assert.equal(await page.getAttribute(`[data-testid=mixer-companion][data-companion=${companion}]`, 'aria-checked'), 'true', 'companion from the room')
    await page.click('[data-testid=mixer-companion][data-companion=date]')
    const firstCard = await get(page, () => window.__navi.get().deck.cards[0]?.id)
    const pad = await page.locator('[data-testid=mixer-pad]').boundingBox()
    const log0 = (await get(page, () => window.__navi.soundLog)).filter(n => n === 'penlight').length
    await page.mouse.move(pad.x + pad.width * 0.1, pad.y + pad.height * 0.5)
    await page.mouse.down()
    for (let i = 1; i <= 16; i++) {
      await page.mouse.move(pad.x + pad.width * (0.1 + 0.85 * (i / 16)), pad.y + pad.height * (0.5 + 0.42 * (i / 16)))
      await page.waitForTimeout(20)
    }
    await page.waitForTimeout(120)
    // live: the wall's aurora follows the finger before anything is committed (hype high, known → hot)
    assert.equal(await page.getAttribute('[data-shell=phone] .fx-bg', 'data-palette'), 'hot', 'aurora follows the drag')
    assert.equal(await get(page, () => window.__navi.get().room.mood.setBy), 'auto', 'nothing committed while dragging')
    const notes = (await get(page, () => window.__navi.soundLog)).filter(n => n === 'penlight').length - log0
    assert.ok(notes >= 3, `a note per crossed cell (${notes})`)
    assert.equal(await page.locator('[data-testid=mixer-near] .mx-callout__row[data-star]').count(), 3, 'nearest songs surface beside the puck')
    await page.mouse.up()
    await page.waitForTimeout(1600)
    const mood = await get(page, () => window.__navi.get().room.mood)
    assert.equal(mood.setBy, 'mixer')
    assert.equal(mood.companion, 'date')
    assert.ok(mood.hype > 0.8 && mood.fresh < 0.2, `mood ${JSON.stringify(mood)}`)
    assert.equal(await sheetId(page), null, 'the sheet closes on release')
    const deck = await get(page, () => {
      const s = window.__navi.get()
      return { first: s.deck.cards[0]?.id, cause: s.deck.redeal?.cause?.key ?? s.deck.cards[0]?.reason?.cause?.key ?? null }
    })
    assert.notEqual(deck.first, firstCard, 'the hand was dealt again')
    assert.equal(deck.cause, 'cause.mixed')
    noErrors(errors, 'mixer')
  })

  // ---------------------------------------------------------------- M8 #5 / T06 the language sheet
  await stepC('M8#5 / T06 language: switches in place (no reload, animations keep running), search works in Korean', async () => {
    const { page, errors } = await open('phone', Q)
    await page.evaluate(() => (window.__marker = 1))
    const card0 = await page.getAttribute('[data-shell=phone] [data-testid=card-top]', 'data-card-id')
    await page.click('[data-shell=phone] [data-testid=lang-button]')
    await page.locator('[data-testid=sheet][data-sheet=lang]').waitFor({ state: 'visible' })
    assert.equal(await page.locator('[data-testid=lang-chip]').count(), 5)
    await page.click('[data-testid=lang-chip][data-locale=ko]')
    await page.waitForTimeout(700)
    assert.equal(await page.getAttribute('html', 'lang'), 'ko')
    assert.equal(await page.evaluate(() => window.__marker), 1, 'no reload')
    assert.equal(await page.getAttribute('[data-shell=phone] [data-testid=card-top]', 'data-card-id'), card0, 'the top card stayed')
    assert.equal((await page.textContent('[data-testid=dock-discover]')).trim(), '찾기')
    assert.ok(await page.evaluate(() => document.getAnimations().some(a => a.playState === 'running')), 'animations keep running')
    const f0 = await page.evaluate(() => new Promise(r => requestAnimationFrame(t0 => requestAnimationFrame(t1 => r(t1 - t0)))))
    assert.ok(f0 > 0, 'frames keep coming')
    for (const sel of ['[data-testid=dock-discover]', '[data-shell=phone] [data-testid=btn-primary]']) {
      const t = ((await page.textContent(sel)) || '').trim()
      assert.ok(!RAW_KEY.test(t), `${sel}: ${t}`)
    }
    await openSearch(page)
    for (const q of ['잔혹한', 'zankoku', '残酷天使']) {
      await type(page, q)
      assert.equal((await mainIds(page))[0], 'zankoku', q)
    }
    const title = await page.locator('[data-testid=search-result][data-song-id=zankoku] .sx-row__title').first().textContent()
    assert.match(title, /잔혹한 천사의 테제/, 'main title in Korean (G-4)')
    assert.match(await page.locator('[data-testid=search-result][data-song-id=zankoku]').first().textContent(), /残酷な天使のテーゼ/, 'original stays visible')
    await noRawKeys(page, '[data-testid=sheet][data-sheet=search]', 'ko search sheet')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
    await page.click('[data-shell=phone] [data-testid=lang-button]')
    await page.click('[data-testid=lang-chip][data-locale=ja]')
    await page.waitForTimeout(600)
    assert.equal(await page.getAttribute('html', 'lang'), 'ja')
    assert.equal((await page.textContent('[data-testid=dock-discover]')).trim(), '探す')
    noErrors(errors, 'lang')
  })

  // ---------------------------------------------------------------- small phone and the room screen
  await stepC('360×740: search and mixer fit without horizontal scroll', async () => {
    const { page, errors } = await open('small', Q)
    await openSearch(page)
    await type(page, '米津')
    const sw = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth))
    assert.ok(sw <= 360, `scrollWidth ${sw}`)
    const res = await page.locator('[data-testid=search-result] [data-testid=search-reserve]').first().boundingBox()
    assert.ok(res && res.x + res.width <= 360, 'reserve button inside the screen')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
    await page.click('[data-testid=mixer-open]')
    await page.locator('[data-testid=mixer-pad]').waitFor({ state: 'visible' })
    await page.waitForTimeout(900) // let the sheet's spring settle
    const pad = await page.locator('[data-testid=mixer-pad]').boundingBox()
    assert.ok(pad.x >= 0 && pad.x + pad.width <= 360 && pad.y + pad.height <= 740, 'pad on screen')
    noErrors(errors, 'small')
  })

  await stepC('room screen (1280×800): search from the room tablet shows nothing personal and tags the reservation', async () => {
    const { page, errors } = await open('tablet', Q)
    assert.equal(await page.getAttribute('[data-testid=app-root]', 'data-view'), 'room')
    await page.evaluate(() => window.__navi.api.getState().openSheet('search'))
    await page.locator('[data-testid=sheet][data-sheet=search]').waitFor({ state: 'visible' })
    await page.waitForTimeout(450)
    await type(page, 'gurenge')
    assert.equal((await mainIds(page))[0], 'gurenge')
    assert.equal(await page.locator('[data-testid=sheet][data-sheet=search] [data-testid=search-keep]').count(), 0, 'no personal keep on the shared screen')
    const priv = await page.$$eval('[data-private="1"]', els => els.filter(e => e.getClientRects().length > 0).length)
    assert.equal(priv, 0, 'no data-private element is visible')
    await page.locator('[data-testid=search-result][data-song-id=gurenge] [data-testid=search-reserve]').first().click()
    await page.waitForTimeout(300)
    const item = await get(page, () => window.__navi.get().room.queue.find(q => q.songId === 'gurenge'))
    assert.ok(item && item.tags.includes('room'), 'room tag on a room reservation')
    const sw = await page.evaluate(() => document.documentElement.scrollWidth)
    assert.ok(sw <= 1280, `scrollWidth ${sw}`)
    noErrors(errors, 'room')
  })
}
