// M6 stage acceptance (SPEC L/M6 1–8; the M6 parts of T01, T05, T08, T10, T12).
export const name = 'stage'

const Q = '?test=1&seed=test&reset=1'

export async function run({ openApp, assert, step }) {
  // every step closes its own pages so earlier steps do not keep simulating in the background
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
  const store = (page, fn, arg) => page.evaluate(fn, arg)
  const reserveTop = page =>
    store(page, () => {
      const s = window.__navi.get()
      const c = s.deck.cards.find(x => x.songId || x.options?.length)
      const songId = c.songId || c.options[0]
      s.act(c.id, 'reserve', { songId, navi: true })
      return songId
    })

  // ---------------------------------------------------------------- T01 (M6 part): the floor and the lane at 3.2 s
  await stepC('T01 floor lights and the breathing NOW slot after 3.2 s', async () => {
    const { page, errors } = await open('phone', Q)
    await page.waitForTimeout(3200)
    const orb = id => page.locator(`[data-shell=phone] [data-testid=member-orb][data-member=${id}]`)
    assert.equal(await orb('minato').getAttribute('data-present'), '1')
    assert.equal(await orb('saki').getAttribute('data-present'), '1')
    assert.equal(await orb('jun').getAttribute('data-arriving'), '1')
    assert.equal(await orb('jun').getAttribute('data-state'), 'arriving')
    assert.equal(await orb('me').getAttribute('data-state'), 'empty', 'my ring waits for the first tap')
    assert.ok(await orb('minato').isVisible())
    assert.match(await orb('jun').textContent(), /向かってる/)
    const slot = page.locator('[data-shell=phone] [data-testid=lane-slot-empty]')
    assert.ok(await slot.isVisible(), 'lane-slot-empty visible')
    assert.match(await slot.textContent(), /最初の1曲が、この部屋の空気をつくる/)
    const word = page.locator('[data-testid=mood-word]').first()
    assert.equal(await word.getAttribute('data-word'), 'blank')
    // first tap pops the silver light into my ring
    await page.mouse.click(40, 300)
    await page.waitForTimeout(500)
    assert.equal(await orb('me').getAttribute('data-state'), 'lit')
    assert.ok((await page.evaluate(() => window.__navi.soundLog)).includes('orbPop'), 'orbPop played')
    noErrors(errors, 'T01 floor')
  })

  await stepC('B-2 timing: Minato lights before Saki, Jun’s ring and my ring, the lane arrives last', async () => {
    const { page } = await open('phone', Q)
    const first = await page.evaluate(async () => {
      const sel = {
        minato: '[data-shell=phone] [data-testid=member-orb][data-member=minato]',
        saki: '[data-shell=phone] [data-testid=member-orb][data-member=saki]',
        jun: '[data-shell=phone] [data-testid=member-orb][data-member=jun]',
        lane: '[data-shell=phone] [data-testid=stage-lane]',
      }
      const t0 = performance.now()
      const seen = {}
      while (performance.now() - t0 < 4000 && Object.keys(seen).length < 4) {
        for (const [k, s] of Object.entries(sel)) {
          const e = document.querySelector(s)
          if (!seen[k] && e && Number(getComputedStyle(e).opacity) > 0.5) seen[k] = Math.round(performance.now() - t0)
        }
        await new Promise(r => setTimeout(r, 30))
      }
      return seen
    })
    assert.ok(first.minato != null && first.saki != null && first.jun != null && first.lane != null, JSON.stringify(first))
    assert.ok(first.minato < first.saki, `Minato before Saki ${JSON.stringify(first)}`)
    assert.ok(first.saki <= first.jun, `Saki before Jun ${JSON.stringify(first)}`)
    assert.ok(first.jun < first.lane, `the lane comes last ${JSON.stringify(first)}`)
    assert.ok(first.lane - first.minato > 900, `lane ≈1.5 s after Minato ${JSON.stringify(first)}`)
  })

  await stepC('small 360×740: the lane, floor and mood word cause no horizontal scroll', async () => {
    const { page } = await open('small', Q + '&intro=0&script=1')
    await page.waitForTimeout(500)
    await store(page, () => {
      const a = window.__navi.api.getState()
      for (const [id, by] of [['gurenge', 'minato'], ['lemon', 'saki'], ['marigold', 'me'], ['dry-flower', 'saki'], ['que-sera', 'me']]) a.reserve(id, { by, source: by === 'me' ? 'search' : 'member' })
      a.startNext()
    })
    await page.waitForTimeout(700)
    const sw = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth))
    assert.ok(sw <= 360, `scrollWidth ${sw}`)
  })

  // ---------------------------------------------------------------- lane (M6-2, T05)
  await stepC('lane: reserve → #n chip with tags, my turn count, swallow; search sheet keeps it hittable', async () => {
    const { page, errors } = await open('phone', Q + '&intro=0&script=1')
    await page.waitForSelector('[data-testid=deck]')
    await page.waitForTimeout(400)
    await store(page, () => {
      const a = window.__navi.api.getState()
      a.reserve('gurenge', { by: 'minato', source: 'member' })
      a.startNext()
      a.reserve('lemon', { by: 'saki', source: 'member', tags: ['navi'] })
    })
    const songId = await reserveTop(page)
    const chip = page.locator(`[data-shell=phone] [data-testid=lane-item][data-song-id="${songId}"]`)
    await chip.waitFor({ state: 'attached', timeout: 1000 })
    assert.match((await chip.getAttribute('data-tags')) ?? '', /navi/)
    assert.equal(await chip.getAttribute('data-by'), 'me')
    await page.waitForFunction(s => { const e = document.querySelector(`[data-shell=phone] [data-testid=lane-item][data-song-id="${s}"]`); return e && Number(getComputedStyle(e).opacity) > 0.9 }, songId, { timeout: 2000 })
    assert.match(await chip.textContent(), /#2/)
    const now = page.locator('[data-shell=phone] [data-testid=lane-now]')
    assert.equal(await now.getAttribute('data-song-id'), 'gurenge')
    const turn = page.locator('[data-shell=phone] [data-testid=lane-my-turn]')
    assert.match(await turn.textContent(), /あなたの番まであと\s*2\s*曲/)
    // tiny anonymous dots on a chip whose song was asked
    await store(page, () => window.__navi.api.getState().askRoom('lemon', 'me'))
    await page.waitForTimeout(300)
    assert.ok(await page.locator('[data-shell=phone] [data-testid=lane-item][data-song-id=lemon] .sg-mdots').count(), 'mini know dots on the chip')
    // the search sheet rises under the lane; the lane centre still hits the lane
    await store(page, () => window.__navi.api.getState().openSheet('search'))
    await page.waitForTimeout(700)
    const lane = await page.locator('[data-shell=phone] [data-testid=stage-lane]').boundingBox()
    const hit = await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('[data-testid=stage-lane]'), [lane.x + lane.width / 2, lane.y + lane.height / 2])
    assert.ok(hit, 'elementFromPoint at the lane centre is inside the lane')
    noErrors(errors, 'lane')
  })

  await stepC('lane: drag preview draws Navi’s read on the flow line', async () => {
    const { page } = await open('phone', Q + '&intro=0&script=1')
    await page.waitForTimeout(400)
    await store(page, () => { const a = window.__navi.api.getState(); a.reserve('lemon', { by: 'saki', source: 'member' }); a.startNext() })
    await page.waitForTimeout(300)
    const label = page.locator('[data-shell=phone] .sg-flow__label')
    assert.ok(Number(await label.evaluate(e => getComputedStyle(e).opacity)) < 0.05, 'hidden at rest')
    await store(page, () => { window.__stageFx.drag = { dir: 'up', songId: 'gurenge', progress: 0.9 } })
    await page.waitForTimeout(200)
    assert.ok(Number(await label.evaluate(e => getComputedStyle(e).opacity)) > 0.8, 'visible while dragging up')
    assert.match(await label.getAttribute('data-trend'), /^(up|down|flat)$/)
    assert.match(await label.textContent(), /ナビの見立て/)
    await store(page, () => { window.__stageFx.drag = { dir: null, progress: 0 } })
    await page.waitForTimeout(150)
    assert.ok(Number(await label.evaluate(e => getComputedStyle(e).opacity)) < 0.05, 'hidden again')
  })

  await stepC('T08 (M6 part): a glass of light where the drink should arrive', async () => {
    const { page, errors } = await open('phone', Q + '&intro=0&script=1')
    await page.waitForTimeout(400)
    await store(page, () => { const a = window.__navi.api.getState(); a.reserve('gurenge', { by: 'minato', source: 'member' }); a.startNext(); a.reserve('lemon', { by: 'saki', source: 'member' }); a.reserve('idol', { by: 'minato', source: 'member' }); a.placeOrder('highball') })
    await page.waitForTimeout(1200)
    const glass = page.locator('[data-shell=phone] [data-testid=lane-glass]').first()
    assert.ok(await glass.isVisible(), 'lane-glass visible on discover')
    // the glass sits after NOW and #1 (arrives after two songs)
    const order = await page.evaluate(() => [...document.querySelectorAll('[data-shell=phone] [data-testid=stage-lane] [data-testid]')].map(e => e.dataset.testid).filter(t => /lane-(now|item|glass)/.test(t)))
    assert.deepEqual(order.slice(0, 3), ['lane-now', 'lane-item', 'lane-glass'])
    await page.click('[data-testid=dock-order]')
    await page.waitForTimeout(500)
    assert.ok(await page.locator('[data-shell=phone] [data-testid=lane-glass]').first().isVisible(), 'lane-glass visible on the compact lane')
    noErrors(errors, 'glass')
  })

  // ---------------------------------------------------------------- floor (M6-3, T10)
  await stepC('join (dashed → lit + thread), leave (fades away), positive bubbles, my voice colour', async () => {
    const { page, errors } = await open('phone', Q + '&intro=0&script=1')
    await page.waitForTimeout(400)
    const jun = page.locator('[data-shell=phone] [data-testid=member-orb][data-member=jun]')
    await page.evaluate(() => window.__navi.fire({ t: 'join', id: 'jun' }))
    await page.waitForTimeout(600)
    assert.equal(await jun.getAttribute('data-present'), '1')
    assert.equal(await jun.getAttribute('data-state'), 'lit')
    assert.ok(await page.locator('[data-shell=phone] .sg-thread--jun').count(), 'thread from Jun to the ball')
    await store(page, () => window.__navi.api.getState().pushBubble({ member: 'saki', text: { key: 'common.know' }, ttl: 4000 }))
    await page.waitForTimeout(300)
    assert.match(await page.locator('[data-shell=phone] .sg-bubble').first().textContent(), /知ってる/)
    await page.evaluate(() => window.__navi.fire({ t: 'leave', id: 'jun' }))
    await page.waitForTimeout(200)
    assert.equal(await jun.getAttribute('data-state'), 'leaving')
    await page.waitForTimeout(1500)
    assert.equal(await jun.count(), 0, 'Jun faded out')
    // my light takes my voice colour on the phone only
    await page.mouse.click(40, 300)
    await store(page, () => window.__navi.api.getState().setMemberVoice('me', 'emotional'))
    await page.waitForTimeout(300)
    const c = await page.locator('[data-shell=phone] [data-testid=member-orb][data-member=me] .sg-orb').evaluate(e => e.style.getPropertyValue('--c'))
    assert.equal(c.toUpperCase(), '#C77DFF')
    noErrors(errors, 'floor')
  })

  // ---------------------------------------------------------------- mood word, spotlight
  await stepC('mood word: gradient word from the store, tap opens the mixer; spotlight on my turn', async () => {
    const { page, errors } = await open('phone', Q + '&intro=0&script=1')
    await page.waitForTimeout(400)
    const word = page.locator('[data-shell=phone] [data-testid=mood-word]')
    assert.match(await word.textContent(), /まだ何色でもない/)
    await store(page, () => { const a = window.__navi.api; a.setState({ room: { ...a.getState().room, moodWord: 'peak' } }) })
    await page.waitForTimeout(700)
    assert.equal(await word.getAttribute('data-word'), 'peak')
    assert.match(await word.textContent(), /最高潮/)
    await word.click()
    await page.waitForSelector('[data-testid=sheet][data-sheet=mixer]', { timeout: 2000 })
    await store(page, () => window.__navi.api.getState().closeSheet())
    assert.equal(await page.locator('[data-testid=spotlight]').count(), 0)
    await store(page, () => { const a = window.__navi.api.getState(); a.reserve('marigold', { by: 'me', source: 'search' }); window.__navi.api.getState().startNext() })
    await page.waitForSelector('[data-testid=spotlight]', { timeout: 2000 })
    noErrors(errors, 'mood/spot')
  })

  // ---------------------------------------------------------------- sing tab (M6-4)
  await stepC('sing tab: play order, move and cancel my songs, finish with a demo score (self-best only)', async () => {
    const { page, errors } = await open('phone', Q + '&intro=0&script=1')
    await page.waitForTimeout(400)
    await store(page, () => {
      const a = window.__navi.api.getState()
      a.reserve('gurenge', { by: 'minato', source: 'member' })
      a.startNext()
      a.reserve('lemon', { by: 'saki', source: 'member' })
      a.reserve('marigold', { by: 'me', source: 'search' })
      a.reserve('que-sera', { by: 'me', source: 'search' })
    })
    await page.click('[data-testid=dock-sing]')
    await page.waitForSelector('[data-testid=stage-screen]')
    // roommates may add songs on their own while this runs: only look at the songs set up here
    const MINE = ['lemon', 'marigold', 'que-sera']
    const ids = () => page.$$eval('[data-testid=stage-queue-item]', (els, keep) => els.map(e => e.dataset.songId).filter(id => keep.includes(id)), MINE)
    assert.deepEqual(await ids(), ['lemon', 'marigold', 'que-sera'])
    assert.match(await page.locator('[data-testid=stage-queue-item][data-song-id=marigold]').textContent(), /#2/)
    assert.match(await page.locator('[data-testid=stage-my-turn]').textContent(), /あなたの番まであと\s*2\s*曲/)
    await page.locator('[data-testid=stage-queue-item][data-song-id=marigold] [data-testid=stage-move-up]').click()
    await page.waitForTimeout(300)
    assert.deepEqual(await ids(), ['marigold', 'lemon', 'que-sera'])
    const cancel = page.locator('[data-testid=stage-queue-item][data-song-id=que-sera] [data-testid=stage-cancel]')
    await cancel.click()
    assert.deepEqual(await ids(), ['marigold', 'lemon', 'que-sera'], 'first tap only arms the cancel')
    await cancel.click()
    await page.waitForTimeout(400)
    assert.deepEqual(await ids(), ['marigold', 'lemon'])
    // penlight while Minato sings: notes, no counters
    const nc = await page.locator('[data-testid=stage-now]').boundingBox()
    const before = await page.locator('[data-testid=stage-now]').textContent()
    for (let i = 0; i < 5; i++) await page.mouse.click(nc.x + 80 + i * 30, nc.y + 150)
    const log = await page.evaluate(() => window.__navi.soundLog)
    assert.ok(log.filter(x => x === 'penlight').length >= 5, 'a penlight note per tap')
    assert.ok((await page.locator('[data-testid=stage-now] .sg-pen').count()) > 0, 'rising lights')
    assert.equal(await page.locator('[data-testid=stage-now]').textContent(), before, 'no counter text appears')
    // my turn → finish (demo)
    await store(page, () => { const a = window.__navi.api.getState(); a.finishNow(); window.__navi.api.getState().startNext() })
    await page.waitForSelector('[data-testid=stage-finish]')
    await page.click('[data-testid=stage-finish]')
    await page.waitForSelector('[data-testid=stage-score]')
    const score = Number(await page.getAttribute('[data-testid=stage-score]', 'data-score'))
    assert.ok(score >= 78 && score <= 96, `demo score ${score}`)
    const scoreText = await page.locator('[data-testid=stage-score]').textContent()
    assert.match(scoreText, /今夜はじめての採点|自己ベスト/)
    assert.doesNotMatch(scoreText, /位|ランキング|平均/)
    // 退室する → confirm sheet
    await page.click('[data-testid=stage-exit]')
    await page.waitForSelector('[data-testid=sheet][data-sheet=exitConfirm]', { timeout: 2000 })
    noErrors(errors, 'sing')
  })

  // ---------------------------------------------------------------- standby (M6-5)
  await stepC('standby: huge count, specks gather one song before my turn with standbyChime', async () => {
    const { page, errors } = await open('phone', Q + '&intro=0&script=1')
    await page.waitForTimeout(400)
    await store(page, () => {
      const a = window.__navi.api.getState()
      a.reserve('gurenge', { by: 'minato', source: 'member' })
      a.startNext()
      a.reserve('lemon', { by: 'saki', source: 'member' })
      a.reserve('marigold', { by: 'me', source: 'search' })
      a.setOverlay('standby')
    })
    const sb = page.locator('[data-testid=standby]')
    await sb.waitFor()
    assert.equal(await sb.getAttribute('data-gather'), '0')
    assert.match(await page.locator('[data-testid=standby-turn]').textContent(), /2/)
    const box = await sb.boundingBox()
    await page.mouse.click(box.x + 60, box.y + box.height * 0.75)
    await page.mouse.click(box.x + 200, box.y + box.height * 0.7)
    assert.ok((await page.evaluate(() => window.__navi.soundLog)).includes('penlight'))
    await store(page, () => { const a = window.__navi.api.getState(); a.finishNow(); window.__navi.api.getState().startNext() })
    await page.waitForFunction(() => document.querySelector('[data-testid=standby]')?.dataset.gather === '1', null, { timeout: 2000 })
    await page.waitForTimeout(700)
    assert.ok((await page.evaluate(() => window.__navi.soundLog)).includes('standbyChime'), 'standbyChime played')
    await page.mouse.click(box.x + 100, box.y + box.height * 0.8)
    await page.waitForTimeout(500)
    assert.equal(await page.evaluate(() => window.__navi.get().ui.overlay), null, 'a tap brings me back once the light has gathered')
    noErrors(errors, 'standby')
  })

  // ---------------------------------------------------------------- shift card (M6-8)
  await stepC('shift card: wave, cause, two candidates (navi pick preselected), 次に挟む inserts after NOW', async () => {
    const { page, errors } = await open('phone', Q + '&intro=0&script=1')
    await page.waitForTimeout(400)
    await store(page, () => {
      const a = window.__navi.api.getState()
      for (const [id, by] of [['dry-flower', 'saki'], ['lemon', 'saki']]) {
        a.reserve(id, { by, source: 'member' })
        window.__navi.api.getState().startNext()
        window.__navi.api.getState().finishNow()
      }
      a.reserve('gurenge', { by: 'minato', source: 'member' })
      window.__navi.api.getState().startNext()
      a.reserve('idol', { by: 'minato', source: 'member' })
      const card = { id: 'shift-e2e', kind: 'shift', songId: 'que-sera', options: ['hanamizuki', 'que-sera'], reason: { source: 'yomu', text: { key: 'reason.shift' }, cause: { key: 'cause.mellow2' } }, trigger: { type: 'memberSongEnded', at: 0 }, rule: 'insert.shift.mellow2', dealtAt: Date.now() }
      window.__navi.api.getState().dealCards([card], 'top')
    })
    await page.waitForSelector('[data-testid=card-top][data-kind=shift]')
    // let the dealer settle (it may add its own shift card for the same mellow streak)
    await page.waitForFunction(
      () => {
        const s = window.__navi.get()
        const id = s.deck.cards[0]?.id
        if (window.__lastTop !== id) {
          window.__lastTop = id
          window.__lastTopAt = performance.now()
          return false
        }
        return s.deck.cards[0]?.kind === 'shift' && performance.now() - window.__lastTopAt > 900
      },
      null,
      { timeout: 10000, polling: 100 },
    )
    const top = page.locator('[data-testid=card-top][data-kind=shift]')
    assert.match(await top.locator('[data-testid=card-reason]').textContent(), /ので/, 'a cause line')
    assert.ok(await top.locator('.sg-shift__wave svg path').count() >= 2, 'heat wave drawn')
    assert.ok(await top.locator('.sg-shift__slot').count(), 'blinking next slot')
    const opts = top.locator('[data-testid=shift-option]')
    assert.equal(await opts.count(), 2)
    // whichever shift card is on top (ours or one the director dealt for the same mellow streak)
    const card = await page.evaluate(() => window.__navi.get().deck.cards[0])
    const opt = card.options?.length ? card.options : [card.songId]
    const naviPick = opt.includes(card.songId) ? card.songId : opt[0]
    const pressed = await opts.evaluateAll(els => els.filter(e => e.getAttribute('aria-pressed') === 'true').map(e => e.dataset.songId))
    assert.deepEqual(pressed, [naviPick], 'the navi pick is preselected')
    assert.ok(await top.locator('.sg-shift__fc').count(), 'dotted forecast peak')
    assert.match(await page.locator('[data-testid=btn-primary]').textContent(), /次に挟む/)
    // choose the other candidate, then slot it in
    const other = await opts.evaluateAll(els => els.find(e => e.getAttribute('aria-pressed') !== 'true').dataset.songId)
    await top.locator(`[data-testid=shift-option][data-song-id="${other}"]`).click()
    await page.waitForTimeout(200)
    await page.click('[data-testid=btn-primary]')
    await page.waitForTimeout(400)
    const st = await page.evaluate(() => ({ q: window.__navi.get().room.queue.map(x => [x.songId, x.tags.join(' ')]), p: window.__navi.get().room.prompt }))
    assert.deepEqual(st.q[0], [other, 'insert'], `inserted right after NOW: ${JSON.stringify(st.q)}`)
    assert.ok(!st.p || st.p.kind === 'shift', 'the room is asked to agree')
    noErrors(errors, 'shift')
  })

  // ---------------------------------------------------------------- room screen (M6-6, T05, T12)
  for (const [kind, w] of [['tablet', 1280], ['tablet', 1024]]) {
    await stepC(`room screen ${w}: lane left, board centre, sidebar right, nothing private, no 知らない`, async () => {
      const { page, errors } = await open(kind, Q + '&script=1')
      if (w !== 1280) await page.setViewportSize({ width: 1024, height: 768 })
      await page.waitForTimeout(3300)
      assert.equal(await page.getAttribute('[data-testid=app-root]', 'data-view'), 'room')
      await store(page, () => {
        const a = window.__navi.api.getState()
        a.reserve('gurenge', { by: 'minato', source: 'member', tags: ['navi'] })
        a.startNext()
        a.reserve('lemon', { by: 'saki', source: 'member' })
        a.reserve('marigold', { by: 'me', source: 'search', tags: ['visa'] })
        a.placeOrder('highball')
        a.askRoom('lemon', 'me')
      })
      await page.waitForTimeout(1500)
      const lane = await page.locator('[data-testid=stage-lane][data-orientation=vertical]').boundingBox()
      const board = await page.locator('[data-testid=room-board]').boundingBox()
      const side = await page.locator('[data-testid=room-sidebar]').boundingBox()
      const vw = page.viewportSize().width
      assert.ok(lane.x + lane.width <= vw * 0.3 + 1, `lane in the left 30% (${lane.x + lane.width})`)
      assert.ok(board.x > lane.x && board.x + board.width < side.x + 1, 'board between lane and sidebar')
      const nowFs = await page.locator('.sg-bnow__title').evaluate(e => parseFloat(getComputedStyle(e).fontSize))
      assert.ok(nowFs >= 40, `big NOW (${nowFs}px)`)
      assert.ok(await page.locator('[data-testid=room-ask]').isVisible(), 'ask circle shown to the room')
      assert.ok(await page.locator('[data-testid=room-orders]').isVisible(), 'order status counts')
      const privVisible = await page.$$eval('[data-private="1"]', els => els.filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden' }).length)
      assert.equal(privVisible, 0, 'no private element visible')
      const text = await page.evaluate(() => document.body.innerText)
      assert.ok(!text.includes('知らない'), 'never says 知らない')
      const sw = await page.evaluate(() => document.documentElement.scrollWidth)
      assert.ok(sw <= vw, `no horizontal scroll (${sw})`)
      // the join caption cycles through the five languages
      const a1 = await page.locator('.sg-join__txt').textContent()
      await page.waitForTimeout(3000)
      const a2 = await page.locator('.sg-join__txt').textContent()
      assert.notEqual(a1, a2, 'join caption changes language')
      noErrors(errors, `room ${w}`)
    })
  }

  await stepC('room: shift proposal lights, finale lanterns, the excuse bubble', async () => {
    const { page, errors } = await open('tablet', Q + '&intro=0&script=1')
    await page.waitForTimeout(500)
    await store(page, () => window.__navi.api.getState().setPrompt({ id: 'p1', kind: 'shift', songIds: ['que-sera'], agree: { minato: true }, at: Date.now() }))
    await page.waitForSelector('[data-testid=room-shift]')
    assert.equal(await page.locator('[data-testid=room-shift] .sg-prop__light.is-on').count(), 1)
    await store(page, () => window.__navi.api.getState().setPrompt({ id: 'p2', kind: 'finale', songIds: ['marigold', 'gurenge', 'zankoku'], votes: { minato: 'gurenge' }, at: Date.now() }))
    await page.waitForSelector('[data-testid=room-finale]')
    assert.equal(await page.locator('[data-testid=room-finale] .sg-lantern').count(), 3)
    await store(page, () => window.__navi.api.getState().setPrompt({ id: 'p3', kind: 'excuse', songIds: [], at: Date.now() }))
    await page.waitForSelector('[data-testid=room-excuse]')
    assert.match(await page.locator('[data-testid=room-excuse]').textContent(), /ナビの読み違い/)
    noErrors(errors, 'room prompts')
  })

  // ---------------------------------------------------------------- dual seam (M6-7, T12)
  await stepC('dual: a phone reserve sends a comet over the seam into the room lane', async () => {
    const { page, errors } = await open('dual', Q + '&view=dual&intro=0&script=1')
    await page.waitForSelector('[data-shell=phone] [data-testid=deck]')
    await page.waitForTimeout(600)
    const songId = await reserveTop(page)
    await page.waitForSelector('[data-testid=seam-comet]', { state: 'attached', timeout: 2000 })
    await page.waitForSelector(`[data-shell=room] [data-testid=lane-item][data-song-id="${songId}"]`, { state: 'attached', timeout: 2000 })
    await page.waitForFunction(s => { const e = document.querySelector(`[data-shell=room] [data-testid=lane-item][data-song-id="${s}"]`); return e && Number(getComputedStyle(e).opacity) > 0.9 }, songId, { timeout: 3000 })
    await page.waitForSelector('[data-testid=seam-comet]', { state: 'detached', timeout: 3000 })
    const sw = await page.evaluate(() => document.documentElement.scrollWidth)
    assert.ok(sw <= 1366, `no horizontal scroll (${sw})`)
    noErrors(errors, 'dual')
  })
}
