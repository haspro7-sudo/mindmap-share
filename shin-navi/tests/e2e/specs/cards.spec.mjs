// M3 cards acceptance (SPEC L/M3 1-7; M-1 T01 card parts, T02, T03 frame/labels part, T10 redeal)
// + QA fix round 1: the bar always keeps its three buttons, the undo pill never covers the next
// card, reasons only on the 3rd pass, intro rise/beam timing, peek teasers, card-front contract,
// fair-share keep, visa stamp/title, link rows, label fit, script-mode arrow keys.
export const name = 'cards'

const Q = '?test=1&seed=test&reset=1'
const QI = `${Q}&intro=0`

/** Pointer flick from the card centre: 300 px in ~120 ms (SPEC M-0). */
async function flick(page, dir) {
  const b = await page.locator('[data-testid=card-top]').boundingBox()
  const x = b.x + b.width / 2
  const y = b.y + b.height / 2
  const [dx, dy] = dir === 'up' ? [0, -300] : dir === 'right' ? [300, 0] : [-300, 0]
  await page.mouse.move(x, y)
  await page.mouse.down()
  for (let i = 1; i <= 5; i++) {
    await page.mouse.move(x + (dx * i) / 5, y + (dy * i) / 5)
    await page.waitForTimeout(20)
  }
  await page.mouse.up()
}

const state = page => page.evaluate(() => {
  const s = window.__navi.get()
  return {
    queue: s.room.queue.map(q => ({ songId: q.songId, tags: q.tags, by: q.by })),
    now: s.room.now ? s.room.now.item.songId : null,
    faces: Object.fromEntries(Object.entries(s.col.faces).map(([k, f]) => [k, f.state])),
    top: s.deck.cards[0] ? { id: s.deck.cards[0].id, kind: s.deck.cards[0].kind, variant: s.deck.cards[0].variant ?? '', songId: s.deck.cards[0].songId } : null,
    cards: s.deck.cards.map(c => c.id),
    undo: s.deck.undo ? s.deck.undo.action : null,
    knowing: Object.keys(s.room.knowing),
  }
})

const mine = st => [...(st.now ? [{ songId: st.now }] : []), ...st.queue.filter(q => q.by === 'me')]

/** Area of the intersection of two DOM rects (selectors), 0 when either is missing. */
const overlap = (page, a, b) => page.evaluate(([a, b]) => {
  const r1 = document.querySelector(a)?.getBoundingClientRect()
  const r2 = document.querySelector(b)?.getBoundingClientRect()
  if (!r1 || !r2) return -1
  const w = Math.max(0, Math.min(r1.right, r2.right) - Math.max(r1.left, r2.left))
  const h = Math.max(0, Math.min(r1.bottom, r2.bottom) - Math.max(r1.top, r2.top))
  return Math.round(w * h)
}, [a, b])

/** Cards for tests that need a specific hand (the director keeps refilling behind them). */
const R = key => ({ source: 'yomu', text: { key } })
const card = (id, kind, extra = {}) => ({ id, kind, reason: R('reason.opener'), trigger: { type: 'enter', at: 0 }, rule: 'test.cards', dealtAt: 0, ...extra })
async function deal(page, cards) {
  await page.evaluate(cs => window.__navi.api.getState().dealCards(cs.map(c => ({ ...c, dealtAt: Date.now() })), 'replace'), cards)
  // wait until the previous top card has finished leaving and the new one has settled
  await page.waitForFunction(id => {
    const tops = document.querySelectorAll('[data-testid=card-top]')
    return tops.length === 1 && tops[0].getAttribute('data-card-id') === id
  }, cards[0].id, { timeout: 5000 })
  await page.waitForTimeout(350)
}

export async function run({ browser, url, openApp, assert, step }) {
  const noErrors = (errors, where) => assert.deepEqual(errors, [], `${where}: console/page errors\n${errors.join('\n')}`)

  await step('T01 cards: opener on top, ask + gap peeking, ghost hand at 3.2 s, one animated SongArt', async () => {
    const { page, errors, context } = await openApp('phone', Q)
    await page.waitForTimeout(3200)
    const top = page.locator('[data-testid=card-top]')
    assert.equal(await top.getAttribute('data-kind'), 'song')
    assert.equal(await top.getAttribute('data-variant'), 'opener')
    const box = await top.boundingBox()
    assert.ok(box && box.y >= 0 && box.y + box.height <= 844 && box.x >= 0 && box.x + box.width <= 390, `top card inside the viewport ${JSON.stringify(box)}`)
    const peeks = await page.locator('[data-testid=card-peek]').evaluateAll(els => els.map(e => e.getAttribute('data-kind')))
    assert.deepEqual(peeks, ['ask', 'gap'], `peeks ${peeks}`)
    const expected = await page.evaluate(() => window.__navi.get().deck.cards.slice(1, 3).map(c => c.kind))
    assert.deepEqual(peeks, expected, 'peeks are the real next two cards')
    assert.ok(await page.locator('[data-testid=ghost-hand]').isVisible(), 'ghost hand visible on the first visit')
    assert.equal(await page.locator('.song-art.is-animated').count(), 1, 'only the top card animates its art')
    assert.equal(await page.locator('[data-testid=deck]').getAttribute('data-private'), '1')
    noErrors(errors, 'T01')
    await context.close()
  })

  await step('T02 flicks: up reserves (navi tag) -> undo -> up again -> right keeps -> left passes', async () => {
    const { page, errors, context } = await openApp('phone', QI)
    await page.waitForSelector('[data-testid=card-top][data-variant=opener]')
    await page.waitForTimeout(500)
    const opener = (await state(page)).top.songId
    await flick(page, 'up')
    await page.waitForTimeout(300)
    let st = await state(page)
    const res = mine(st).find(q => q.songId === opener)
    assert.ok(res, `opener ${opener} reserved: ${JSON.stringify(st.queue)}`)
    const item = st.queue.find(q => q.songId === opener)
    if (item) assert.ok(item.tags.includes('navi'), `navi tag on the opener: ${item.tags}`)
    assert.equal(st.faces[opener], 'neon')
    await page.waitForSelector('[data-testid=undo-toast]')
    await page.waitForTimeout(250)
    assert.equal(await overlap(page, '[data-testid=undo-toast]', '[data-testid=card-top]'), 0, 'undo pill never covers the next card (reserve)')
    const pill = await page.locator('[data-testid=undo-toast]').boundingBox()
    assert.ok(pill.height <= 44, `undo pill is compact (${pill.height}px)`)
    await page.click('[data-testid=undo-button]')
    await page.waitForTimeout(400)
    st = await state(page)
    assert.equal(mine(st).length, 0, 'undo empties my reservations')
    assert.equal(st.faces[opener], undefined, 'undo removes the face')
    assert.equal(st.top.songId, opener, 'undo brings the card back on top')
    await page.waitForTimeout(500)
    await flick(page, 'up')
    await page.waitForTimeout(700)
    st = await state(page)
    assert.ok(mine(st).some(q => q.songId === opener), 'reserved again')
    // right on the next keepable card
    const before = Object.values(st.faces).filter(f => f === 'sketch').length
    let guard = 0
    while (!['song', 'ask', 'link', 'voice'].includes((await state(page)).top.kind) && guard++ < 4) {
      await page.click('[data-testid=btn-pass]')
      await page.waitForTimeout(600)
    }
    await flick(page, 'right')
    await page.waitForTimeout(700)
    st = await state(page)
    assert.equal(Object.values(st.faces).filter(f => f === 'sketch').length, before + 1, 'keep adds a sketch face')
    // left: faces unchanged
    const faces = Object.keys(st.faces).length
    const leftId = st.top.id
    await flick(page, 'left')
    await page.waitForTimeout(700)
    st = await state(page)
    assert.equal(Object.keys(st.faces).length, faces, 'pass leaves no face')
    assert.ok(!st.cards.includes(leftId), 'passed card left the pile')
    assert.ok(await page.locator('[data-testid=undo-toast]').isVisible(), 'undo toast after a pass')
    assert.equal(await overlap(page, '[data-testid=undo-toast]', '[data-testid=card-top]'), 0, 'undo pill never covers the next card (pass)')
    assert.equal(await page.locator('[data-testid=pass-reason]').count(), 0, 'a single pass stays weightless (no reason chips)')
    noErrors(errors, 'T02 flicks')
    await context.close()
  })

  await step('T02 buttons: the same results through the action bar', async () => {
    const { page, errors, context } = await openApp('phone', QI)
    await page.waitForSelector('[data-testid=card-top][data-variant=opener]')
    await page.waitForTimeout(400)
    const opener = (await state(page)).top.songId
    await page.click('[data-testid=btn-primary]')
    await page.waitForTimeout(400)
    let st = await state(page)
    assert.ok(mine(st).some(q => q.songId === opener), 'primary button reserves the opener')
    await page.click('[data-testid=undo-button]')
    await page.waitForTimeout(400)
    st = await state(page)
    assert.equal(mine(st).length, 0, 'undo button restores')
    await page.waitForTimeout(300)
    await page.click('[data-testid=btn-keep]')
    await page.waitForTimeout(500)
    st = await state(page)
    assert.equal(st.faces[opener], 'sketch', 'keep button makes a sketch face')
    const id = st.top.id
    await page.click('[data-testid=btn-pass]')
    await page.waitForTimeout(500)
    st = await state(page)
    assert.ok(!st.cards.includes(id), 'pass button removes the card')
    noErrors(errors, 'T02 buttons')
    await context.close()
  })

  await step('non-keepable cards: no keep button, a right flick wobbles back', async () => {
    const { page, errors, context } = await openApp('phone', QI)
    await page.waitForSelector('[data-testid=card-top]')
    await deal(page, [card('t-gap', 'gap', { area: 'slow:J-POP' }), card('t-song', 'song', { songId: 'lemon' }), card('t-ask', 'ask', { songId: 'gurenge' })])
    assert.equal(await page.locator('[data-testid=card-top]').getAttribute('data-kind'), 'gap')
    assert.equal(await page.locator('[data-testid=btn-keep]').count(), 0, 'no keep for gap')
    await flick(page, 'right')
    await page.waitForTimeout(700)
    const st = await state(page)
    assert.equal(st.top.id, 't-gap', 'gap card is still on top after a right flick')
    assert.equal(Object.keys(st.faces).length, 0)
    noErrors(errors, 'non-keepable')
    await context.close()
  })

  await step('flights: reserve lands in 280 ms with transform/opacity only; keep folds then flies', async () => {
    const { page, errors, context } = await openApp('phone', QI)
    await page.waitForSelector('[data-testid=card-top]')
    await page.waitForTimeout(400)
    const kind = (await state(page)).top.kind
    if (['song', 'ask', 'link', 'voice'].includes(kind)) {
      const k = await page.evaluate(() => new Promise(resolve => {
        const t0 = performance.now()
        let saw = false
        const durs = new Set()
        document.querySelector('[data-testid=btn-keep]').click()
        const id = setInterval(() => {
          const tok = document.querySelector('.ftok--keep')
          if (tok) {
            saw = true
            for (const a of tok.getAnimations()) durs.add(a.effect.getTiming().duration)
          } else if (saw) { clearInterval(id); resolve({ ms: performance.now() - t0, durs: [...durs] }) }
          if (performance.now() - t0 > 4000) { clearInterval(id); resolve({ ms: -1, durs: [...durs] }) }
        }, 10)
      }))
      assert.ok(k.durs.includes(180) && k.durs.includes(240), `keep = fold 180 ms + fly 240 ms: ${k.durs}`)
      assert.ok(k.ms >= 380, `keep flight lasted ${Math.round(k.ms)} ms`)
    }
    await deal(page, [card('t-fl', 'song', { songId: 'lemon' }), card('t-fl2', 'song', { songId: 'pretender' }), card('t-fl3', 'gap', { area: 'slow:J-POP' })])
    const r = await page.evaluate(() => new Promise(resolve => {
      const seen = []
      const collect = () => {
        for (const el of document.querySelectorAll('.ftok, .ftrail')) {
          for (const a of el.getAnimations()) {
            const props = new Set()
            for (const k of a.effect.getKeyframes()) for (const p of Object.keys(k)) if (!['offset', 'computedOffset', 'easing', 'composite'].includes(p)) props.add(p)
            seen.push([...props].join(','))
            if (el.classList.contains('ftok--reserve')) durations.add(a.effect.getTiming().duration)
          }
        }
      }
      const durations = new Set()
      const mo = new MutationObserver(collect)
      mo.observe(document.body, { childList: true, subtree: true })
      const t0 = performance.now()
      document.querySelector('[data-testid=btn-primary]').click()
      collect()
      const check = setInterval(() => {
        if (document.querySelector('.ftok--reserve')) return
        if (seen.length) { clearInterval(check); mo.disconnect(); resolve({ ms: performance.now() - t0, seen, durations: [...durations] }) }
        if (performance.now() - t0 > 3000) { clearInterval(check); mo.disconnect(); resolve({ ms: -1, seen }) }
      }, 10)
    }))
    assert.ok(r.seen.length > 0, 'a reserve token flew')
    assert.ok(r.seen.every(p => p.split(',').every(x => x === 'transform' || x === 'opacity')), `only transform/opacity animate: ${r.seen}`)
    assert.ok(r.durations.includes(280), `reserve flight is 280 ms: ${r.durations}`)
    assert.ok(r.ms > 0 && r.ms < 2500, `reserve token landed and cleared (${Math.round(r.ms)} ms)`)
    noErrors(errors, 'flights')
    await context.close()
  })

  await step('tap flips to the evidence side; long-press asks the room', async () => {
    const { page, errors, context } = await openApp('phone', QI)
    await page.waitForSelector('[data-testid=card-top]')
    await deal(page, [card('t-song2', 'song', { songId: 'lemon' }), card('t-ask2', 'ask', { songId: 'gurenge' }), card('t-gap2', 'gap', { area: 'slow:J-POP' })])
    const b = await page.locator('[data-testid=card-top]').boundingBox()
    await page.mouse.click(b.x + b.width / 2, b.y + 60)
    await page.waitForTimeout(600)
    assert.equal(await page.locator('[data-testid=card-top]').getAttribute('data-flipped'), '1')
    const back = await page.locator('.cback').textContent()
    assert.match(back, /なぜこの札？/)
    assert.match(back, /ナビの見立て（仮説）/)
    assert.doesNotMatch(back, /test\.cards/, 'the dealer rule id stays hidden while the lens is off (POLICY#3)')
    assert.equal(await page.locator('[data-testid=card-top] [data-testid=navi-toggle]').count(), 1, 'the navi toggle moved to the evidence side')
    await page.evaluate(() => window.__navi.api.getState().toggleLens())
    await page.waitForTimeout(200)
    assert.match(await page.locator('.cback').textContent(), /test\.cards/, 'the rule id shows with the planning lens on')
    await page.evaluate(() => window.__navi.api.getState().toggleLens())
    await page.waitForTimeout(200)
    await page.mouse.click(b.x + b.width / 2, b.y + 60)
    await page.waitForTimeout(500)
    assert.equal(await page.locator('[data-testid=card-top]').getAttribute('data-flipped'), '0')
    // long-press 650 ms without moving
    await page.mouse.move(b.x + b.width / 2, b.y + 70)
    await page.mouse.down()
    await page.waitForTimeout(650)
    await page.mouse.up()
    await page.waitForTimeout(300)
    const st = await state(page)
    assert.ok(st.knowing.includes('lemon'), 'long-press asked the room about the song')
    assert.equal(st.top.id, 't-song2', 'long-press does not remove the card')
    assert.equal(await page.locator('[data-testid=card-top]').getAttribute('data-flipped'), '0', 'long-press does not flip')
    noErrors(errors, 'flip/long')
    await context.close()
  })

  await step('ask body: ask the room, then the primary turns into Reserve after the count', async () => {
    const { page, errors, context } = await openApp('phone', `${QI}&speed=8`)
    await page.waitForSelector('[data-testid=card-top]')
    await deal(page, [card('t-ask3', 'ask', { songId: 'gurenge', reason: R('reason.ask') }), card('t-song3', 'song', { songId: 'lemon' }), card('t-gap3', 'gap', { area: 'slow:J-POP' })])
    const primary = page.locator('[data-testid=btn-primary]')
    assert.equal(await primary.getAttribute('data-action'), 'ask')
    assert.match(await primary.textContent(), /部屋に聞く/)
    await page.click('[data-testid=ask-know]')
    await primary.click()
    await page.waitForFunction(() => document.querySelector('[data-testid=btn-primary]')?.getAttribute('data-action') === 'reserve', null, { timeout: 8000 })
    assert.match(await primary.textContent(), /予約/)
    assert.ok(await page.locator('[data-testid=card-top] [data-testid=know-dots]').count(), 'dots on the medallion')
    await primary.click()
    await page.waitForTimeout(300)
    assert.ok(mine(await state(page)).some(q => q.songId === 'gurenge'), 'reserved after the reveal')
    noErrors(errors, 'ask')
    await context.close()
  })

  await step('link body: three mini cards, tap selects, primary reserves the choice and links', async () => {
    const { page, errors, context } = await openApp('phone', QI)
    await page.waitForSelector('[data-testid=card-top]')
    await deal(page, [card('t-link', 'link', { songId: 'marigold', options: ['kimi-rock', 'suiheisen', 'dry-flower'], reason: { source: 'tsunagu', text: { key: 'reason.co', vars: { song: { song: 'marigold' } } } } }), card('t-s4', 'song', { songId: 'lemon' }), card('t-g4', 'gap', { area: 'slow:J-POP' })])
    assert.equal(await page.locator('[data-testid=link-option]').count(), 3)
    assert.match(await page.locator('[data-testid=card-top]').textContent(), /一緒に選ばれている/)
    await page.click('[data-testid=link-option][data-song-id=dry-flower]')
    await page.waitForTimeout(200)
    assert.equal(await page.evaluate(() => window.__navi.get().deck.selection['t-link']), 'dry-flower')
    assert.match(await page.locator('[data-testid=btn-primary]').textContent(), /つないで予約/)
    await page.click('[data-testid=btn-primary]')
    await page.waitForTimeout(400)
    const r = await page.evaluate(() => ({ q: window.__navi.get().room.queue.map(q => q.songId), links: window.__navi.get().col.links.map(l => `${l.a}>${l.b}`) }))
    assert.ok(r.q.includes('dry-flower') || (await state(page)).now === 'dry-flower', `reserved the chosen song ${r.q}`)
    assert.ok(r.links.includes('marigold>dry-flower'), `link drawn ${r.links}`)
    noErrors(errors, 'link')
    await context.close()
  })

  await step('breather: no action bar, "put the phone down" is the biggest button', async () => {
    const { page, errors, context } = await openApp('phone', QI)
    await page.waitForSelector('[data-testid=card-top]')
    await deal(page, [card('t-br', 'breather', { reason: R('reason.breather') }), card('t-s5', 'song', { songId: 'lemon' }), card('t-g5', 'gap', { area: 'slow:J-POP' })])
    assert.equal(await page.locator('[data-testid=btn-primary]').count(), 0, 'action bar hidden for the breather')
    const down = await page.locator('[data-testid=breather-putdown]').boundingBox()
    const more = await page.locator('[data-testid=breather-onemore]').boundingBox()
    assert.ok(down.width * down.height >= more.width * more.height, 'put-down is the biggest button')
    assert.ok(more.height >= 48, `one-more is a full, comfortable button (${more.height})`)
    await page.click('[data-testid=breather-putdown]')
    await page.waitForTimeout(300)
    assert.equal(await page.evaluate(() => window.__navi.get().ui.overlay), 'standby')
    noErrors(errors, 'breather')
    await context.close()
  })

  await step('frames: every kind has its own outline; primary labels differ by kind (T03 part)', async () => {
    const { page, errors, context } = await openApp('phone', QI)
    await page.waitForSelector('[data-testid=card-top]')
    const kinds = [
      card('f1', 'song', { songId: 'lemon' }),
      card('f2', 'song', { variant: 'visa', songId: 'zankoku' }),
      card('f3', 'ask', { songId: 'gurenge' }),
      card('f4', 'shift', { options: ['lemon', 'que-sera'] }),
      card('f5', 'link', { songId: 'marigold', options: ['kimi-rock', 'suiheisen', 'dry-flower'] }),
      card('f6', 'voice'),
      card('f7', 'gap', { area: 'slow:J-POP' }),
      card('f8', 'invite', { variant: 'request', from: 'saki', songId: 'marigold' }),
      card('f9', 'import'),
      card('f10', 'coaster'),
      card('f11', 'finale', { options: ['marigold', 'gurenge', 'idol'] }),
      card('f12', 'breather'),
    ]
    const frames = new Map()
    const labels = new Set()
    for (let i = 0; i < kinds.length; i++) {
      await deal(page, [kinds[i], kinds[(i + 1) % kinds.length], kinds[(i + 2) % kinds.length]].map((c, k) => ({ ...c, id: `${c.id}-${i}-${k}` })))
      const info = await page.evaluate(() => {
        const cs = document.querySelector('[data-testid=card-top] .cs')
        const face = cs?.querySelector('.cs__face')
        return { frame: cs?.getAttribute('data-frame'), clip: face ? getComputedStyle(face).clipPath : '' }
      })
      frames.set(info.frame, info.clip)
      const p = page.locator('[data-testid=btn-primary]')
      if (await p.count()) labels.add((await p.textContent()).trim())
    }
    assert.equal(frames.size, 12, `12 frames: ${[...frames.keys()]}`)
    assert.equal(new Set(frames.values()).size, 12, 'each frame has a different outline')
    assert.ok(labels.size >= 5, `primary labels vary by kind: ${[...labels]}`)
    noErrors(errors, 'frames')
    await context.close()
  })

  await step('T10 redeal: deck[data-redealing=1] for >= 1000 ms, cause mentions Jun', async () => {
    const { page, errors, context } = await openApp('phone', `${QI}&speed=8`)
    await page.waitForSelector('[data-testid=card-top]')
    await page.waitForTimeout(800)
    await page.evaluate(() => {
      window.__rd = []
      const t0 = performance.now()
      const id = setInterval(() => {
        window.__rd.push([performance.now() - t0, document.querySelector('[data-testid=deck]')?.getAttribute('data-redealing')])
        if (performance.now() - t0 > 2400) clearInterval(id)
      }, 30)
      window.__navi.fire({ t: 'join', id: 'jun' })
    })
    await page.waitForTimeout(2600)
    const on = (await page.evaluate(() => window.__rd)).filter(r => r[1] === '1')
    assert.ok(on.length > 0, 'redealing observed')
    assert.ok(on[on.length - 1][0] - on[0][0] >= 1000, `redealing lasted ${Math.round(on[on.length - 1][0] - on[0][0])} ms`)
    assert.match(await page.locator('[data-testid=card-top] [data-testid=card-reason]').textContent(), /ジュン/)
    noErrors(errors, 'redeal')
    await context.close()
  })

  await step('small 360x740: the pile fits, no horizontal scroll', async () => {
    const { page, errors, context } = await openApp('small', QI)
    await page.waitForSelector('[data-testid=card-top]')
    await page.waitForTimeout(500)
    const b = await page.locator('[data-testid=card-top]').boundingBox()
    assert.ok(b.width <= 300 && b.x >= 0 && b.x + b.width <= 360, `card fits: ${JSON.stringify(b)}`)
    const sw = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth))
    assert.ok(sw <= 360, `scrollWidth ${sw}`)
    noErrors(errors, 'small')
    await context.close()
  })

  await step('intro (B-2): the opener rises at ~1.4 s with a beam from the ball; the bar waits for the lane', async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ja-JP' })
    await context.addInitScript(() => {
      try { localStorage.clear() } catch {}
      window.__probe = []
      let mount = null
      const t0 = performance.now()
      const opacityOf = el => {
        let op = 1
        for (let e = el; e && e !== document.body; e = e.parentElement) op *= Number(getComputedStyle(e).opacity)
        return op
      }
      const tick = () => {
        if (mount == null && document.querySelector('[data-testid=app-root]')) mount = performance.now()
        if (mount != null) {
          const c = document.querySelector('[data-testid=card-top]')
          const beam = document.querySelector('[data-testid=intro-beam]')
          const bar = document.querySelector('[data-testid=btn-primary]')
          window.__probe.push({ t: performance.now() - mount, op: c ? opacityOf(c) : null, beam: beam ? Number(getComputedStyle(beam).opacity) : 0, bar: bar ? opacityOf(bar) : null })
        }
        if (performance.now() - t0 < 4200) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto(new URL('?test=1&seed=test&reset=1', url).href)
    await page.waitForTimeout(4000)
    const pr = await page.evaluate(() => window.__probe)
    const at = t => pr.find(r => r.t >= t)
    assert.ok(at(1000) && (at(1000).op ?? 0) < 0.1, `card still hidden at 1.0 s: ${JSON.stringify(at(1000))}`)
    assert.ok(at(2100) && at(2100).op > 0.9, `card risen by ~2.0 s: ${JSON.stringify(at(2100))}`)
    const beamOn = pr.filter(r => r.beam > 0.3).map(r => r.t)
    assert.ok(beamOn.length && beamOn[0] > 1000 && beamOn[0] < 1600, `beam falls at ~1.2-1.4 s (first bright frame ${Math.round(beamOn[0] ?? -1)} ms)`)
    const bar = at(1800)
    assert.ok(!bar || bar.bar == null || bar.bar < 0.1, `action bar still dark before the lane beat: ${JSON.stringify(bar)}`)
    assert.ok(at(3300) && at(3300).bar > 0.9, `action bar faded in with the lane: ${JSON.stringify(at(3300))}`)
    assert.deepEqual(errors, [])
    await context.close()
  })

  await step('peeks (C-5): real silhouettes with localised teasers >= 12 px, lifted enough to read', async () => {
    const { page, errors, context } = await openApp('phone', QI)
    await page.waitForSelector('[data-testid=card-top]')
    await deal(page, [card('p1', 'song', { songId: 'lemon' }), card('p2', 'ask', { songId: 'gurenge' }), card('p3', 'gap', { area: 'slow:J-POP' })])
    const info = await page.evaluate(() => {
      const top = document.querySelector('[data-testid=card-top]').getBoundingClientRect()
      return [...document.querySelectorAll('[data-testid=card-peek]')].map(p => {
        const tag = p.querySelector('.peek-edge [data-testid=peek-teaser]')
        const r = p.getBoundingClientRect()
        const text = tag?.textContent ?? ''
        const fs = tag ? parseFloat(getComputedStyle(tag).fontSize) : 0
        const sc = r.width / p.offsetWidth
        return { lift: Math.round(top.top - r.top), text, px: +(fs * sc).toFixed(1), shown: p.getAttribute('data-teaser') }
      })
    })
    assert.equal(info.length, 2)
    assert.ok(info[0].lift >= 28, `first peek lifts ~30 px (${info[0].lift})`)
    assert.ok(info[1].lift > info[0].lift + 16, `second peek stands higher (${info[1].lift})`)
    assert.equal(info[0].text, '知ってる？', `ask teaser: ${info[0].text}`)
    assert.ok(!/[A-Z]{3,}/.test(info[0].text + info[1].text), `no English kind codes: ${info.map(i => i.text)}`)
    assert.ok(info[0].px >= 12, `teaser renders at >= 12 px (${info[0].px})`)
    const label = await page.locator('[data-testid=card-top] .cs__label').textContent()
    assert.equal(label.trim(), '今の1曲', `one localised kind label: ${label}`)
    noErrors(errors, 'peeks')
    await context.close()
  })

  await step('card fronts: no evidence chips / fine print on the front, fine print on the back', async () => {
    const { page, errors, context } = await openApp('phone', QI)
    await page.waitForSelector('[data-testid=card-top]')
    await deal(page, [card('cf1', 'ask', { songId: 'gurenge' }), card('cf2', 'link', { songId: 'marigold', options: ['kimi-rock', 'suiheisen', 'dry-flower'] }), card('cf3', 'song', { songId: 'lemon' })])
    const front = await page.locator('[data-testid=card-top] .cs__side--front').textContent()
    assert.doesNotMatch(front, /答えた人の分だけ/, 'ask fine print left the front')
    const b = await page.locator('[data-testid=card-top]').boundingBox()
    await page.mouse.click(b.x + b.width / 2, b.y + 40)
    await page.waitForTimeout(600)
    assert.match(await page.locator('[data-testid=card-fine]').textContent(), /答えた人の分だけ数えます/, 'ask fine print on the back')
    await page.click('[data-testid=btn-pass]')
    await page.waitForTimeout(600)
    const linkFront = await page.locator('[data-testid=card-top] .cs__side--front').textContent()
    assert.doesNotMatch(linkFront, /タグのおすすめとは別枠/, 'link fine print left the front')
    // ROBUST#10: the "just reserved" row never sits under the tiles or the diamond
    for (const sel of ['[data-testid=link-option][data-song-id=kimi-rock]', '[data-testid=link-option][data-song-id=suiheisen]', '[data-testid=link-option][data-song-id=dry-flower]', '.link__center']) {
      assert.equal(await overlap(page, '[data-testid=link-from]', sel), 0, `link-from clear of ${sel}`)
    }
    await page.click('[data-testid=btn-pass]')
    await page.waitForTimeout(600)
    assert.equal(await page.locator('[data-testid=card-top] .cs__side--front .chip').count(), 0, 'no evidence chips on the song front')
    assert.equal(await page.locator('[data-testid=card-top] .cs__side--front [data-testid=navi-toggle]').count(), 0, 'navi toggle only on the opener front')
    const small = await page.evaluate(() => [...document.querySelectorAll('[data-testid=card-top] .cs__side--front *')].filter(e => e.childElementCount === 0 && e.textContent.trim() && getComputedStyle(e).visibility !== 'hidden' && parseFloat(getComputedStyle(e).fontSize) < 12).map(e => `${e.textContent.trim()}:${getComputedStyle(e).fontSize}`))
    assert.deepEqual(small, [], 'minimum front font 12 px')
    noErrors(errors, 'fronts')
    await context.close()
  })

  await step('pass reasons only on the 3rd pass in a row; the breather dismisses the pill', async () => {
    const { page, errors, context } = await openApp('phone', QI)
    await page.waitForSelector('[data-testid=card-top]')
    await deal(page, [card('r1', 'song', { songId: 'lemon' }), card('r2', 'song', { songId: 'pretender' }), card('r3', 'song', { songId: 'marigold' }), card('r4', 'song', { songId: 'gurenge' }), card('r5', 'breather'), card('r6', 'song', { songId: 'idol' })])
    for (let i = 1; i <= 3; i++) {
      await page.click('[data-testid=btn-pass]')
      await page.waitForTimeout(450)
      const chips = await page.locator('[data-testid=pass-reason]').count()
      if (i < 3) assert.equal(chips, 0, `no reason chips after pass ${i}`)
      else assert.equal(chips, 3, 'reason chips on the 3rd pass in a row')
      assert.equal(await overlap(page, '[data-testid=undo-toast]', '[data-testid=card-top]'), 0, `pill clear of the card after pass ${i}`)
      await page.waitForTimeout(300)
    }
    await page.click('[data-testid=pass-reason][data-reason=mood]')
    await page.waitForTimeout(150)
    assert.equal(await page.evaluate(() => window.__navi.get().col.passReasons.mood), 1, 'the optional reason is recorded')
    await page.click('[data-testid=btn-pass]')
    await page.waitForTimeout(500)
    assert.equal(await page.locator('[data-testid=card-top]').getAttribute('data-kind'), 'breather')
    assert.equal(await page.locator('[data-testid=undo-toast]').count(), 0, 'nothing sits over the breather')
    noErrors(errors, 'reasons')
    await context.close()
  })

  await step('my own turn: the bar keeps pass / primary / keep (btn-finish lives in the lane)', async () => {
    const { page, errors, context } = await openApp('phone', `${QI}&speed=8`)
    await page.waitForSelector('[data-testid=card-top][data-variant=opener]')
    await page.waitForTimeout(400)
    await page.click('[data-testid=btn-primary]')
    await page.waitForFunction(() => window.__navi.get().room.now?.item.by === 'me', null, { timeout: 8000 })
    await page.waitForTimeout(500)
    assert.equal(await page.locator('.abar [data-testid=btn-finish]').count(), 0, 'no finish button in the action bar')
    assert.ok(await page.locator('[data-testid=btn-pass]').isVisible(), 'pass stays')
    assert.ok(await page.locator('[data-testid=btn-primary]').isVisible(), 'primary stays')
    const kind = await page.locator('[data-testid=card-top]').getAttribute('data-kind')
    if (['song', 'ask', 'link', 'voice'].includes(kind)) assert.ok(await page.locator('[data-testid=btn-keep]').isVisible(), 'keep stays')
    noErrors(errors, 'my turn')
    await context.close()
  })

  await step('fair share (handshake 5): over budget the primary keeps the song on the ball', async () => {
    const { page, errors, context } = await openApp('phone', QI)
    await page.waitForSelector('[data-testid=card-top]')
    await page.evaluate(() => {
      const s = window.__navi.api.getState()
      for (const id of ['kanden', 'koi', 'suiheisen']) s.reserve(id, { by: 'me', source: 'search' })
    })
    await deal(page, [card('fs1', 'song', { songId: 'lemon' }), card('fs2', 'link', { songId: 'marigold', options: ['kimi-rock', 'dry-flower', 'idol'] }), card('fs3', 'gap', { area: 'slow:J-POP' })])
    const over = await page.evaluate(() => {
      const s = window.__navi.get()
      const pending = s.room.queue.filter(q => q.by === 'me').length + (s.room.now?.item.by === 'me' ? 1 : 0)
      return pending
    })
    assert.ok(over >= 3, `my pending songs ${over}`)
    const p = page.locator('[data-testid=btn-primary]')
    assert.equal(await p.getAttribute('data-action'), 'keep')
    assert.match(await p.textContent(), /ボールにキープ/)
    assert.match(await page.locator('[data-testid=budget-note]').textContent(), /出番待ち/)
    const q0 = await page.evaluate(() => window.__navi.get().room.queue.length)
    await p.click()
    await page.waitForTimeout(600)
    const st = await state(page)
    assert.equal(st.faces.lemon, 'sketch', 'kept as a sketch face')
    assert.equal(st.queue.length, q0, 'no new reservation')
    assert.equal(await page.locator('[data-testid=btn-primary]').getAttribute('data-action'), 'keep', 'link primary is keep too')
    noErrors(errors, 'fair share')
    await context.close()
  })

  await step('script mode: -> on a focused card never throws it (DEMO#2)', async () => {
    const { page, errors, context } = await openApp('phone', `${QI}&script=1`)
    await page.waitForSelector('[data-testid=card-top]')
    await deal(page, [card('k1', 'song', { songId: 'lemon' }), card('k2', 'song', { songId: 'pretender' }), card('k3', 'gap', { area: 'slow:J-POP' })])
    await page.focus('[data-testid=card-top] .deck__drag')
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(500)
    assert.equal((await state(page)).faces.lemon, undefined, 'ArrowRight did not keep the card')
    noErrors(errors, 'script keys')
    await context.close()
  })

  await step('visa stamp never covers the title, 5 locales at 390 and 360 (ROBUST#4, DEMO#12)', async () => {
    for (const kind of ['phone', 'small']) {
      for (const loc of ['ja', 'en', 'zhHant', 'zhHans', 'ko']) {
        const { page, errors, context } = await openApp(kind, `${QI}&locale=${loc}`)
        await page.waitForSelector('[data-testid=card-top]')
        for (const songId of ['plastic-love', 'zankoku']) {
          const cid = `v-${kind}-${loc}-${songId}`
          const to = loc === 'ja' ? 'ko' : loc
          await deal(page, [card(cid, 'song', { variant: 'visa', songId, reason: { source: 'hou', text: { key: 'reason.visa', vars: { locale: { locale: to } } } } }), card(`${cid}-2`, 'song', { songId: 'lemon' }), card(`${cid}-3`, 'gap', { area: 'slow:J-POP' })])
          assert.equal(await overlap(page, '[data-testid=visa-stamp]', '[data-testid=visa-title] .vtitle__lines'), 0, `${kind} ${loc} ${songId}: stamp clear of the title`)
          if (loc === 'ja' && songId === 'zankoku') assert.match(await page.locator('[data-testid=visa-title]').textContent(), /잔혹한 천사의 테제/, 'ja viewer sees the title in the language it crosses into')
        }
        noErrors(errors, `visa ${kind} ${loc}`)
        await context.close()
      }
    }
  })

  await step('action-bar labels fit at 360 in en and ko (ROBUST#12)', async () => {
    for (const loc of ['en', 'ko']) {
      const { page, errors, context } = await openApp('small', `${QI}&locale=${loc}`)
      await page.waitForSelector('[data-testid=card-top]')
      const hand = [card('l1', 'coaster'), card('l2', 'invite', { variant: 'request', from: 'saki', songId: 'marigold' }), card('l3', 'import'), card('l4', 'voice'), card('l5', 'song', { songId: 'lemon' })]
      for (let i = 0; i < hand.length; i++) {
        await deal(page, [hand[i], hand[(i + 1) % hand.length], hand[(i + 2) % hand.length]].map((c, k) => ({ ...c, id: `${c.id}-${loc}-${i}-${k}` })))
        const cut = await page.evaluate(() => [...document.querySelectorAll('.abar .abar__label')].filter(e => e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1).map(e => e.textContent))
        assert.deepEqual(cut, [], `${loc} ${hand[i].kind}: truncated labels ${cut}`)
      }
      noErrors(errors, `labels ${loc}`)
      await context.close()
    }
  })

  await step('ghost hand hides off the discover tab', async () => {
    const { page, errors, context } = await openApp('phone', Q)
    await page.waitForSelector('[data-testid=ghost-hand]', { timeout: 6000 })
    await page.click('[data-testid=dock-record]')
    await page.waitForTimeout(500)
    assert.equal(await page.locator('[data-testid=ghost-hand]').count(), 0, 'no ghost hand over the record tab')
    noErrors(errors, 'ghost')
    await context.close()
  })
}
