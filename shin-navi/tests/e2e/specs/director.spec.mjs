// M4 director-planner acceptance (SPEC M-1 T07, T16 and the dealer's part of T01 / T03 / T10).
export const name = 'director'

const Q = '?test=1&seed=test&reset=1'

export async function run({ openApp, assert, step }) {
  const noErrors = (errors, where) => assert.deepEqual(errors, [], `${where}: console/page errors\n${errors.join('\n')}`)
  const hand = page =>
    page.evaluate(() =>
      window.__navi.get().deck.cards.map(c => ({ id: c.id, kind: c.kind, variant: c.variant ?? null, songId: c.songId ?? null, rule: c.rule, reason: c.reason })),
    )

  await step('T01 (dealer): the opener is on top, ask and gap peek, the room was asked', async () => {
    const { page, errors, context } = await openApp('phone', Q)
    await page.waitForSelector('[data-testid=app-root]')
    await page.waitForTimeout(3200)
    const h = await hand(page)
    assert.ok(h.length >= 3, `hand has ${h.length} cards`)
    assert.equal(h[0].kind, 'song')
    assert.equal(h[0].variant, 'opener')
    assert.deepEqual(h.slice(1, 3).map(c => c.kind), ['ask', 'gap'])
    const asked = await page.evaluate(id => !!window.__navi.get().room.knowing[id], h[0].songId)
    assert.ok(asked, 'the opener was asked to the room during the intro')
    const top = page.locator('[data-testid=card-top][data-kind=song][data-variant=opener]')
    if (await page.locator('[data-testid=card-top]').count()) assert.ok(await top.count(), 'card-top shows the opener')
    const peeks = await page.$$eval('[data-testid=card-peek]', els => els.map(e => e.getAttribute('data-kind')))
    if (peeks.length) assert.deepEqual(peeks.slice(0, 2), ['ask', 'gap'])
    noErrors(errors, 'T01')
    await context.close()
  })

  await step('T16: ?locale=en deals the C-10 en row, the first card is a two-line visa', async () => {
    const { page, errors, context } = await openApp('phone', `${Q}&locale=en&intro=0`)
    await page.waitForSelector('[data-testid=app-root]')
    await page.waitForTimeout(900)
    const h = await hand(page)
    assert.deepEqual(
      h.slice(0, 3).map(c => [c.kind, c.variant, c.songId]),
      [
        ['song', 'visa', 'plastic-love'],
        ['song', 'visa', 'zankoku'],
        ['ask', null, 'mayonaka-no-door'],
      ],
    )
    assert.equal(h[0].reason.text.key, 'reason.visa')
    const top = page.locator('[data-testid=card-top]')
    if (await top.count()) {
      assert.equal(await top.getAttribute('data-kind'), 'song')
      assert.equal(await top.getAttribute('data-variant'), 'visa')
      const text = await top.textContent()
      assert.ok(text.includes('プラスティック・ラブ') && /Plastic Love/i.test(text), `two-line visa title: ${text}`)
    }
    noErrors(errors, 'T16')
    await context.close()
  })

  await step('T07: lens frames every visible anchor, 5-1…5-4 across three screens, split re-reads only on the right', async () => {
    const { page, errors, context } = await openApp('phone', `${Q}&intro=0`)
    await page.waitForSelector('[data-testid=brand-label]')
    await page.waitForTimeout(900)
    await page.keyboard.press('l')
    await page.waitForSelector('[data-testid=lens-overlay]')
    await page.waitForTimeout(900)
    const seen = new Set()
    const texts = async () => page.$$eval('[data-testid=lens-tag]', els => els.map(e => e.textContent || ''))
    const discover = await texts()
    assert.ok(discover.length >= 8, `discover shows ${discover.length} lens tags (≥8)`)
    discover.forEach(t => seen.add(t))
    // every visible data-anchor gets a frame and a label
    const visibleAnchors = await page.evaluate(() => {
      const out = new Set()
      document.querySelectorAll('[data-anchor]').forEach(el => {
        if (el.closest('[data-testid=lens-overlay]')) return
        const r = el.getBoundingClientRect()
        if (r.width < 8 || r.height < 8 || r.bottom <= 0 || r.top >= innerHeight) return
        if (el.checkVisibility && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
        if (hit && (el.contains(hit) || hit.contains(el) || hit.closest('[data-testid=lens-overlay]'))) out.add(el.getAttribute('data-anchor'))
      })
      return [...out]
    })
    const tagged = new Set(await page.$$eval('[data-testid=lens-tag]', els => els.map(e => e.getAttribute('data-anchor'))))
    for (const a of visibleAnchors) assert.ok(tagged.has(a), `anchor ${a} is framed`)
    // a label opens the detail panel with a measured value
    await page.locator('[data-testid=lens-tag][data-anchor^="card:"]').first().click()
    await page.waitForSelector('[data-testid=lens-detail]')
    const detail = await page.textContent('[data-testid=lens-detail]')
    assert.match(detail, /5-2/)
    assert.match(detail, /秒/, 'current value of time-to-first-reserve')
    await page.keyboard.press('Escape')
    for (const tab of ['order', 'record']) {
      await page.evaluate(t => window.__navi.api.getState().setTab(t), tab)
      await page.waitForTimeout(1100)
      ;(await texts()).forEach(t => seen.add(t))
    }
    const all = [...seen].join('\n')
    for (const p of ['5-1', '5-2', '5-3', '5-4']) assert.ok(all.includes(p), `${p} appears across the three screens`)
    assert.ok(!/\d+\s*%/.test(await page.textContent('[data-testid=lens-overlay]')), 'no percentages in the lens')
    await page.evaluate(() => window.__navi.api.getState().setTab('discover'))
    // the split
    await page.keyboard.press('s')
    await page.waitForSelector('[data-testid=split-dynamic]')
    await page.waitForSelector('[data-testid=split-static]')
    await page.waitForTimeout(500)
    const firstSong = () => page.$eval('[data-testid=split-dynamic] li', li => li.getAttribute('data-song-id'))
    const staticBefore = await page.textContent('[data-testid=split-static] ol')
    const dynBefore = await firstSong()
    await page.evaluate(() => window.__navi.fire({ t: 'join', id: 'jun' }))
    await page.waitForTimeout(900)
    const dynAfter = await firstSong()
    assert.notEqual(dynAfter, dynBefore, 'the first song on the right changes')
    assert.match(await page.textContent('[data-testid=split-dynamic]'), /ジュン/, 'the cause names Jun')
    assert.equal(await page.textContent('[data-testid=split-static] ol'), staticBefore, 'the static list does not change')
    const body = await page.textContent('body')
    for (const rival of ['DAM', 'Spotify', 'YouTube']) assert.ok(!body.includes(rival), `no ${rival} on screen`)
    noErrors(errors, 'T07')
    await page.reload()
    await page.waitForSelector('[data-testid=app-root]')
    await page.waitForTimeout(600)
    assert.equal(await page.locator('[data-testid=lens-overlay]').count(), 0, 'lens is off after reload')
    assert.equal(await page.locator('[data-testid=split-dynamic]').count(), 0, 'split is off after reload')
    await context.close()
  })

  await step('T10 (dealer): Jun joins → the whole hand is re-dealt, the new top is a visa card with the cause', async () => {
    const { page, errors, context } = await openApp('phone', `${Q}&intro=0`)
    await page.waitForSelector('[data-testid=app-root]')
    await page.waitForTimeout(900)
    const before = (await hand(page)).map(c => c.id)
    await page.evaluate(() => window.__navi.fire({ t: 'join', id: 'jun' }))
    await page.waitForTimeout(400)
    const h = await hand(page)
    assert.ok(h.every(c => !before.includes(c.id)), 'every card is new')
    assert.equal(h[0].kind, 'song')
    assert.equal(h[0].variant, 'visa')
    assert.deepEqual(h[0].reason.cause, { key: 'cause.joined', vars: { member: { member: 'jun' } } })
    const redeal = await page.evaluate(() => window.__navi.get().deck.redeal)
    assert.equal(redeal?.cause.key, 'cause.joined')
    await page.waitForTimeout(1300)
    if (await page.locator('[data-testid=card-reason]').count()) assert.match(await page.textContent('[data-testid=card-reason]'), /ジュン/)
    noErrors(errors, 'T10')
    await context.close()
  })

  await step('T03 (dealer): room events bring shift, voice, invite, coaster and finale on top of the discovery kinds', async () => {
    const { page, errors, context } = await openApp('phone', `${Q}&intro=0`)
    await page.waitForSelector('[data-testid=app-root]')
    await page.waitForTimeout(800)
    const kinds = new Set()
    const primaries = new Set()
    const note = async () => {
      const h = await hand(page)
      h.slice(0, 3).forEach(c => kinds.add(c.variant === 'visa' ? 'song/visa' : c.kind))
      if (await page.locator('[data-testid=btn-primary]').count()) primaries.add((await page.textContent('[data-testid=btn-primary]')).trim())
    }
    const act = (a, arg) => page.evaluate(([a, arg]) => { const s = window.__navi.get(); s.act(s.deck.cards[0].id, a, arg); if (window.__navi.get().ui.sheet) window.__navi.get().closeSheet(); if (window.__navi.get().ui.overlay) window.__navi.get().setOverlay(null) }, [a, arg])
    // round 1: reserve the opener → link; then walk the entrance order
    await note()
    await act('reserve', { navi: true })
    await page.waitForTimeout(200)
    await note()
    for (let i = 0; i < 6; i++) {
      await act('pass')
      await page.waitForTimeout(150)
      await note()
    }
    // roommates sing two mellow songs → shift
    await page.evaluate(() => {
      const s = window.__navi.api.getState()
      s.setScript(true)
      s.reserve('lemon', { by: 'saki' })
      s.reserve('dry-flower', { by: 'saki' })
    })
    for (let i = 0; i < 4; i++) await page.evaluate(() => { const s = window.__navi.api.getState(); if (s.room.now) s.finishNow(); s.startNext() })
    await page.waitForTimeout(200)
    await note()
    // Jun joins (visa), my song ends (voice), Saki's request, a toast cue and 15 minutes left
    await page.evaluate(() => window.__navi.fire({ t: 'join', id: 'jun' }))
    await page.waitForTimeout(200)
    await note()
    await page.evaluate(() => {
      window.__navi.api.getState().reserve('marigold', { by: 'me' })
      for (let i = 0; i < 12 && window.__navi.get().room.queue.length; i++) {
        const st = window.__navi.api.getState()
        if (st.room.now) st.finishNow()
        window.__navi.api.getState().startNext()
      }
      window.__navi.api.getState().finishNow()
    })
    await page.waitForTimeout(200)
    await note()
    await page.evaluate(() => window.__navi.api.getState().openInvite({ variant: 'request', from: 'saki', songId: 'marigold' }))
    await page.waitForTimeout(200)
    await note()
    await page.evaluate(() => window.__navi.fire({ t: 'coaster' }))
    await page.waitForTimeout(200)
    await note()
    await page.evaluate(() => window.__navi.api.getState().jumpToMinutesLeft(15))
    await page.waitForTimeout(400)
    await note()
    const want = ['song', 'ask', 'link', 'gap', 'import', 'invite', 'shift', 'voice', 'coaster', 'finale', 'song/visa']
    const missing = want.filter(k => !kinds.has(k))
    assert.deepEqual(missing, [], `kinds seen: ${[...kinds].join(', ')}`)
    const top = (await hand(page))[0]
    assert.equal(top.kind, 'finale', 'finale takes the top')
    assert.equal(top.reason.cause.key, 'cause.minutes15')
    assert.equal(await page.evaluate(() => window.__navi.get().room.prompt?.kind), 'finale', 'the room can vote')
    noErrors(errors, 'T03')
    await context.close()
  })

  await step('dual + room: lens and split render on the wide views without errors or horizontal scroll', async () => {
    for (const [kind, q] of [
      ['dual', `${Q}&view=dual&intro=0`],
      ['tablet', `${Q}&intro=0`],
      ['small', `${Q}&intro=0`],
    ]) {
      const { page, errors, context } = await openApp(kind, q)
      await page.waitForSelector('[data-testid=app-root]')
      await page.waitForTimeout(900)
      await page.keyboard.press('l')
      await page.keyboard.press('s')
      await page.waitForSelector('[data-testid=lens-tag]')
      await page.waitForSelector('[data-testid=split-dynamic]')
      await page.waitForTimeout(700)
      const vw = await page.evaluate(() => innerWidth)
      const sw = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth))
      assert.ok(sw <= vw, `${kind}: scrollWidth ${sw} ≤ ${vw}`)
      noErrors(errors, kind)
      await context.close()
    }
  })
}
