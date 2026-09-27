// M3 cards acceptance (SPEC L/M3 1-7; M-1 T01 card parts, T02, T03 frame/labels part, T10 redeal).
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

export async function run({ openApp, assert, step }) {
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
    assert.match(back, /test\.cards/, 'the rule is shown')
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
}
