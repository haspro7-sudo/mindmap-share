// M4 director-planner acceptance (SPEC M-1 T07, T16 and the dealer's part of T01 / T03 / T10),
// plus QA fix round 1: lens labels readable and apart (ROBUST#5), the record screen framed without
// scrolling (POLICY#2), the split clear of the presenter panel (DEMO#0), fair share (OWNER#2) and
// presenter-fired invites on top (DEMO#15).
export const name = 'director'

const Q = '?test=1&seed=test&reset=1'

/** Lens labels: none cut off, none over another, none over a status bar, all on screen. */
async function lensLayout(page) {
  return page.evaluate(() => {
    const vw = innerWidth
    const vh = innerHeight
    const tags = [...document.querySelectorAll('[data-testid=lens-tag]')].map(el => ({ el, r: el.getBoundingClientRect(), a: el.getAttribute('data-anchor') }))
    const status = [...document.querySelectorAll('header.status')].map(e => e.getBoundingClientRect()).filter(r => r.width > 4)
    const hit = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5
    const problems = []
    for (const t of tags) {
      if (t.r.left < 0 || t.r.right > vw + 0.5 || t.r.top < 0 || t.r.bottom > vh + 0.5) problems.push(`${t.a}: off screen`)
      for (const part of t.el.querySelectorAll('.lens-tag__head, .lens-tag__m')) if (part.scrollWidth > part.clientWidth + 1 || part.scrollHeight > part.clientHeight + 1) problems.push(`${t.a}: cut off (${part.textContent})`)
      if (t.el.scrollHeight > t.el.clientHeight + 1) problems.push(`${t.a}: taller than its box`)
      if (/…$/.test(t.el.textContent.trim())) problems.push(`${t.a}: ellipsis`)
      for (const s of status) if (hit(t.r, s)) problems.push(`${t.a}: over the status bar`)
    }
    for (let i = 0; i < tags.length; i++) for (let j = i + 1; j < tags.length; j++) if (hit(tags[i].r, tags[j].r)) problems.push(`${tags[i].a} × ${tags[j].a}`)
    // raw anchor ids never print on a frame that is not chosen
    const rawIds = [...document.querySelectorAll('.lens-frame:not(.is-active) .lens-frame__n')].filter(e => /[a-z]/.test(e.textContent)).map(e => e.textContent)
    return { count: tags.length, problems, rawIds }
  })
}

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
    const phoneLayout = await lensLayout(page)
    assert.deepEqual(phoneLayout.problems, [], `phone lens labels: ${phoneLayout.problems.join(' / ')}`)
    assert.deepEqual(phoneLayout.rawIds, [], 'no raw anchor ids on the frames')
    for (const tab of ['order', 'record']) {
      await page.click(`[data-testid=dock-${tab}]`)
      await page.waitForTimeout(1100)
      ;(await texts()).forEach(t => seen.add(t))
    }
    // QA POLICY#2: the record screen (taller than the viewport) is framed without scrolling
    const scrolled = await page.evaluate(() => {
      let n = 0
      for (let el = document.querySelector('[data-testid=record-screen]'); el; el = el.parentElement) n += el.scrollTop
      return n
    })
    assert.equal(scrolled, 0, 'the record screen was not scrolled')
    assert.ok(await page.locator('[data-testid=lens-tag][data-anchor=record]').count(), 'lens-tag[data-anchor=record] on the record screen without scrolling')
    assert.equal(await page.getAttribute('[data-testid=lens-legend] [data-policy="5-3"]', 'data-lit'), '1', '5-3 lights on the record screen')
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
    for (const brand of ['Spotify', 'YouTube']) assert.ok(!body.includes(brand), `no ${brand} on screen`)
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

  await step('dual 1366×768: the split stays clear of the presenter panel; lens labels readable and apart (QA DEMO#0, ROBUST#5)', async () => {
    for (const locale of ['ja', 'en']) {
      const { page, errors, context } = await openApp('dual', `?test=1&seed=demo&reset=1&intro=0&view=dual&script=1&locale=${locale}`)
      await page.waitForSelector('[data-testid=app-root]')
      await page.waitForTimeout(900)
      await page.keyboard.press('?')
      await page.waitForSelector('[data-testid=presenter-panel]')
      await page.keyboard.press('s')
      await page.waitForSelector('[data-testid=split-dynamic]')
      await page.waitForTimeout(500)
      await page.evaluate(() => window.__navi.fire({ t: 'join', id: 'jun' }))
      await page.waitForTimeout(1300)
      const geo = await page.evaluate(() => {
        const r = sel => document.querySelector(sel)?.getBoundingClientRect()
        const box = x => x && { l: x.left, t: x.top, r: x.right, b: x.bottom }
        return { pp: box(r('[data-testid=presenter-panel]')), dyn: box(r('[data-testid=split-dynamic]')), flash: box(r('[data-testid=split-flash]')), panel: box(r('[data-testid=split-view] .sv-panel')), centre: box(r('[data-shell=room] .rs-centre')), vw: innerWidth, vh: innerHeight }
      })
      const inter = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b
      for (const k of ['dyn', 'flash', 'panel']) {
        assert.ok(geo[k], `${locale}: ${k} rendered`)
        assert.ok(geo[k].l >= 0 && geo[k].r <= geo.vw && geo[k].t >= 0 && geo[k].b <= geo.vh, `${locale}: ${k} inside the viewport`)
        assert.ok(!inter(geo[k], geo.pp), `${locale}: ${k} ${JSON.stringify(geo[k])} clear of the presenter panel ${JSON.stringify(geo.pp)}`)
      }
      // hit-test: the flash is really on top where it is drawn
      const flashOnTop = await page.evaluate(() => {
        const f = document.querySelector('[data-testid=split-flash]')
        const r = f.getBoundingClientRect()
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
        return !!hit && f.contains(hit)
      })
      assert.ok(flashOnTop, `${locale}: the 更新 flash is visible (not covered)`)
      assert.match(await page.textContent('[data-testid=split-flash]'), locale === 'ja' ? /ジュン/ : /Jun/)
      // the split sits in the room's centre column (the ball area)
      if (geo.centre && geo.pp.l > geo.centre.r) assert.ok(geo.panel.l >= geo.centre.l - 1 && geo.panel.r <= geo.centre.r + 1, `${locale}: split inside the centre column`)
      // the lens at the demo's closing beat
      await page.keyboard.press('s')
      await page.keyboard.press('l')
      await page.waitForSelector('[data-testid=lens-tag]')
      await page.waitForTimeout(1600)
      const lay = await lensLayout(page)
      assert.ok(lay.count >= 9, `${locale}: ${lay.count} lens tags`)
      assert.deepEqual(lay.problems, [], `${locale}: ${lay.problems.join(' / ')}`)
      assert.deepEqual(lay.rawIds, [], `${locale}: raw frame ids`)
      await page.screenshot({ path: `${process.env.SHOT_DIR || '/tmp'}/director-dual-lens-${locale}.png` }).catch(() => {})
      noErrors(errors, `dual ${locale}`)
      await context.close()
    }
  })

  await step('fair share: once my share of the queue is full, a reservation brings no つながる card (QA OWNER#2)', async () => {
    const { page, errors, context } = await openApp('phone', `${Q}&intro=0`)
    await page.waitForSelector('[data-testid=app-root]')
    await page.waitForTimeout(800)
    // first reservation of the round: the link follows
    await page.evaluate(() => { const s = window.__navi.get(); s.act(s.deck.cards[0].id, 'reserve', { navi: true }) })
    await page.waitForTimeout(250)
    assert.equal((await hand(page))[0].rule, 'insert.link.afterReserve')
    await page.evaluate(() => { const s = window.__navi.get(); s.act(s.deck.cards[0].id, 'pass') })
    await page.evaluate(() => window.__navi.api.getState().reserve('marigold', { by: 'me' }))
    await page.waitForTimeout(250)
    assert.equal(await page.evaluate(() => { const s = window.__navi.get(); const mine = s.room.queue.filter(q => q.by === 'me').length + (s.room.now?.item.by === 'me' ? 1 : 0); return mine >= 2 }), true, 'two of mine pending')
    for (let i = 0; i < 4; i++) {
      await page.evaluate(() => { const s = window.__navi.get(); const top = s.deck.cards[0]; s.act(top.id, top.kind === 'song' ? 'reserve' : top.kind === 'breather' ? 'oneMore' : 'pass') })
      await page.waitForTimeout(200)
      const h = await hand(page)
      assert.ok(!h.some(c => c.rule === 'insert.link.afterReserve'), `no link after a reservation while over (${h.map(c => c.rule).join(', ')})`)
    }
    noErrors(errors, 'fair share')
    await context.close()
  })

  await step('presenter-fired invites land on top; Saki\'s request once per round (QA DEMO#15)', async () => {
    const { page, errors, context } = await openApp('phone', `${Q}&intro=0`)
    await page.waitForSelector('[data-testid=app-root]')
    await page.waitForTimeout(800)
    await page.evaluate(() => { const s = window.__navi.get(); s.act(s.deck.cards[0].id, 'keep'); const t = window.__navi.get(); t.act(t.deck.cards[0].id, 'keep') })
    await page.waitForTimeout(250)
    await page.evaluate(() => window.__navi.fire({ t: 'twin' }))
    await page.waitForTimeout(400)
    let h = await hand(page)
    assert.equal(h[0].kind, 'invite', `twin on top: ${h.map(c => c.kind).join(', ')}`)
    assert.equal(h[0].variant, 'twin')
    await page.evaluate(() => window.__navi.fire({ t: 'request' }))
    await page.waitForTimeout(400)
    h = await hand(page)
    assert.deepEqual([h[0].kind, h[0].variant], ['invite', 'request'], 'the request the presenter fired is on top')
    assert.equal(h[0].reason.cause?.key, 'cause.request')
    if (await page.locator('[data-testid=card-top]').count()) assert.equal(await page.getAttribute('[data-testid=card-top]', 'data-kind'), 'invite')
    // dismissed; a request the room sends in the same round is not offered again
    await page.evaluate(() => { const s = window.__navi.get(); s.act(s.deck.cards[0].id, 'decline') })
    await page.waitForTimeout(200)
    await page.evaluate(() => window.__navi.api.getState().openInvite({ variant: 'request', from: 'saki', songId: 'pretender' }))
    await page.waitForTimeout(300)
    h = await hand(page)
    assert.ok(!h.some(c => c.kind === 'invite' && c.variant === 'request'), 'no second request this round')
    noErrors(errors, 'invites')
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
