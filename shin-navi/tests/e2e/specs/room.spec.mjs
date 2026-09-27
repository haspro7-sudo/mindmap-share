// M5 room-sim acceptance (SPEC L/M5; the M5 parts of B-2, T03, T10, T13; E-6, E-7, E-13, E-14).
export const name = 'room'

const Q = '?test=1&seed=test&reset=1'
const PP_IDS = [
  'next', 'script', 'speed-1', 'speed-4', 'speed-8', 'join', 'leave', 'advance', 'myturn', 'finish', 'hundred', 'request', 'twin',
  'coaster', 'min15', 'exit', 'nextvisit', 'seed', 'view-auto', 'view-phone', 'view-room', 'view-dual', 'lang', 'lens', 'split',
  'noduck', 'entry', 'reset', 'metrics-reset', 'close', 'collapse',
]

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
  const fire = (page, cmd) => page.evaluate(c => window.__navi.fire(c), cmd)
  const topKind = page => S(page, () => window.__navi.get().deck.cards[0]?.kind ?? null)
  /** Bring the first card matching kind/variant to the top of the hand (test shortcut). */
  const toTop = (page, kind, variant) =>
    S(page, ([k, v]) => {
      const api = window.__navi.api
      api.setState(s => {
        const i = s.deck.cards.findIndex(c => c.kind === k && (!v || c.variant === v))
        if (i < 0) return {}
        const cards = s.deck.cards.slice()
        const [c] = cards.splice(i, 1)
        return { deck: { ...s.deck, cards: [c, ...cards], primary: null } }
      })
      return window.__navi.get().deck.cards[0]?.kind === k
    }, [kind, variant])
  const waitFor = async (page, fn, arg, ms = 4000) => {
    const t0 = Date.now()
    while (Date.now() - t0 < ms) {
      if (await page.evaluate(fn, arg)) return true
      await page.waitForTimeout(80)
    }
    return false
  }

  // ---------------------------------------------------------------- B-2: the room answers the opener during the entrance
  await stepC('B-2: two dots of the opener light by ~2.3 s, in arrival order', async () => {
    const { page, errors } = await open('phone', Q)
    await page.waitForTimeout(2350)
    const knows = await page.locator('[data-testid=card-top] [data-testid=know-dots]').first().getAttribute('data-knows')
    assert.equal(knows, '2', `two roommates know the opener at 2.35 s (got ${knows})`)
    const order = await S(page, () => {
      const t = Object.values(window.__navi.get().room.knowing)[0]
      return Object.entries(t.answers).sort((a, b) => a[1].at - b[1].at).map(([m]) => m)
    })
    assert.deepEqual(order, ['minato', 'saki'])
    noErrors(errors, 'B-2')
    // in English the first card is a visa card (C-10); the friends still light its dots on cue
    const en = await open('phone', `${Q}&locale=en`)
    await en.page.waitForTimeout(2400)
    const top = await S(en.page, () => window.__navi.get().deck.cards[0])
    assert.equal(top.variant, 'visa')
    const k = await en.page.locator('[data-testid=card-top] [data-testid=know-dots]').first().getAttribute('data-knows')
    assert.equal(k, '2', `two dots on the first visa card at 2.4 s (got ${k})`)
    noErrors(en.errors, 'B-2 en')
  })

  // ---------------------------------------------------------------- E-14: the presenter panel
  await stepC('E-14: "?" and a triple tap on the brand open the panel with every control and the HUD', async () => {
    const { page, errors } = await open('phone', `${Q}&intro=0`)
    await page.waitForSelector('[data-testid=card-top]')
    assert.equal(await page.locator('[data-testid=presenter-panel]').count(), 0, 'hidden by default')
    await page.keyboard.press('?')
    const panel = page.locator('[data-testid=presenter-panel]')
    await panel.waitFor({ state: 'visible' })
    for (const id of PP_IDS) assert.equal(await page.locator(`[data-testid=pp-${id}]`).count(), 1, `pp-${id}`)
    for (let i = 0; i < 11; i++) assert.ok(await page.locator('[data-testid^=pp-step-]').nth(i).count())
    assert.ok(await page.locator('[data-testid=pp-hud-ttfr]').isVisible(), 'metrics HUD')
    const box = await panel.boundingBox()
    assert.ok(box.x >= 0 && box.x + box.width <= 390, 'panel fits the phone width')
    await page.click('[data-testid=pp-close]')
    await panel.waitFor({ state: 'detached' })
    const brand = page.locator('[data-testid=brand-label]').first()
    await brand.click()
    await brand.click()
    await brand.click()
    await panel.waitFor({ state: 'visible' })
    // speed and script go through presenter/cmd
    await page.click('[data-testid=pp-speed-8]')
    assert.equal(await S(page, () => window.__navi.get().session.speed), 8)
    await page.click('[data-testid=pp-script]')
    assert.equal(await S(page, () => window.__navi.get().session.script), true)
    const sw = await page.evaluate(() => document.documentElement.scrollWidth)
    assert.ok(sw <= 390, `no horizontal scroll (${sw})`)
    noErrors(errors, 'E-14 phone')
  })

  await stepC('E-14: panel on the room screen and in dual, the HUD counts time to first reserve live', async () => {
    for (const [kind, q] of [['tablet', `${Q}&intro=0`], ['dual', `${Q}&intro=0&view=dual`]]) {
      const { page, errors } = await open(kind, q)
      await page.waitForSelector('[data-testid=app-root]')
      await page.waitForTimeout(400)
      await page.keyboard.press('?')
      await page.locator('[data-testid=presenter-panel]').waitFor({ state: 'visible' })
      const a = await page.locator('[data-testid=pp-hud-ttfr] b').textContent()
      await page.waitForTimeout(700)
      const b = await page.locator('[data-testid=pp-hud-ttfr] b').textContent()
      assert.notEqual(a, b, `${kind}: the first-reserve clock is live (${a} → ${b})`)
      await page.click('[data-testid=pp-view-phone]')
      assert.equal(await S(page, () => window.__navi.get().session.view), 'phone')
      const w = page.viewportSize().width
      const sw = await page.evaluate(() => document.documentElement.scrollWidth)
      assert.ok(sw <= w, `${kind}: no horizontal scroll`)
      noErrors(errors, kind)
    }
  })

  // ---------------------------------------------------------------- E-13 / T03: the script walks the demo
  await stepC('E-13 / T03: pp-next runs the script; each step builds its state and brings its card', async () => {
    const { page, errors } = await open('phone', `${Q}&intro=0&script=1&speed=8`)
    await page.waitForSelector('[data-testid=card-top]')
    const kinds = new Set()
    const labels = new Set()
    const look = async () => {
      const k = await topKind(page)
      if (k) kinds.add(k)
      const l = await page.locator('[data-testid=btn-primary]').textContent().catch(() => null)
      if (l) labels.add(l.trim())
    }
    const passTop = () => S(page, () => {
      const s = window.__navi.get()
      const c = s.deck.cards[0]
      if (c) s.act(c.id, c.kind === 'invite' && c.variant !== 'twin' ? 'decline' : c.kind === 'breather' ? 'oneMore' : 'pass')
    })
    await page.keyboard.press('?')
    // every bubble the floor says during the demo is a positive line from the room namespace
    await S(page, () => {
      window.__bubbles = new Set()
      window.__navi.api.subscribe(s => s.room.bubbles.forEach(b => window.__bubbles.add(`${b.member}|${b.text.key}`)))
    })
    // my opener goes in first (a thrown card)
    await look()
    await page.click('[data-testid=btn-primary]')
    await page.waitForTimeout(600)
    for (let i = 0; i < 4; i++) {
      await look()
      await passTop()
      await page.waitForTimeout(250)
    }
    const next = async id => {
      assert.equal(await page.locator('[data-testid=pp-next]').getAttribute('data-step'), id, `next step is ${id}`)
      await page.click('[data-testid=pp-next]')
      await page.waitForTimeout(350)
    }
    // steps 2–3 are the room's own reaction to my first song: Minato, then Saki's slow pair
    assert.ok(await waitFor(page, () => window.__navi.get().room.queue.some(q => q.by === 'minato')), 'Minato reserved on his own')
    assert.ok(await waitFor(page, () => window.__navi.get().room.queue.filter(q => q.by === 'saki').length === 2), 'Saki queued her pair')
    assert.deepEqual(await S(page, () => window.__navi.get().room.queue.filter(q => q.by === 'saki').map(q => q.songId)), ['lemon', 'dry-flower'])
    assert.equal(await S(page, () => window.__navi.get().room.now), null, 'nothing starts by itself in script mode')
    await page.waitForTimeout(200)
    await next('jun-join')
    assert.equal(await page.locator('[data-shell=phone] [data-testid=member-orb][data-member=jun]').first().getAttribute('data-present'), '1')
    await page.waitForTimeout(1500)
    await look()
    const visa = await S(page, () => window.__navi.get().deck.cards.some(c => c.kind === 'song' && c.variant === 'visa'))
    assert.ok(visa, 'a visa card is dealt after Jun joins')
    await next('advance-2')
    assert.ok(await waitFor(page, () => window.__navi.get().room.sung.length >= 2 && !window.__navi.get().room.now), 'two songs played')
    const last2 = await S(page, () => window.__navi.get().room.sung.slice(-2).map(e => e.item.songId))
    assert.deepEqual(last2, ['lemon', 'dry-flower'])
    await page.waitForTimeout(400)
    assert.equal(await topKind(page), 'shift', 'mellow2 brings the shift card on top')
    await look()
    await next('my-turn')
    assert.ok(await S(page, () => window.__navi.get().room.now?.item.by === 'me'), 'my song is NOW')
    await next('my-song-end')
    await page.waitForTimeout(300)
    const score = await S(page, () => window.__navi.get().room.sung.at(-1)?.score)
    assert.ok(score >= 78 && score <= 96, `demo score ${score}`)
    assert.equal(await topKind(page), 'voice', 'the voice card is inserted on top')
    await look()
    await next('request-saki')
    assert.ok(await waitFor(page, () => window.__navi.get().deck.cards.some(c => c.kind === 'invite' && c.variant === 'request')), 'the request card is dealt')
    await toTop(page, 'invite', 'request')
    await page.waitForTimeout(300)
    await look()
    await next('coaster')
    assert.ok(await waitFor(page, () => window.__navi.get().deck.cards[0]?.kind === 'coaster'), 'coaster on top')
    await look()
    await next('minutes-15')
    assert.ok(await waitFor(page, () => window.__navi.get().deck.cards[0]?.kind === 'finale'), 'finale on top')
    await look()
    await next('exit')
    assert.equal(await S(page, () => window.__navi.get().session.phase), 'wrap')
    assert.equal(await page.locator('[data-testid=pp-next]').getAttribute('data-step'), '', 'script complete')
    const said = await S(page, () => [...window.__bubbles])
    assert.ok(said.length >= 2, `the floor talks during the demo (${said.join(', ')})`)
    for (const b of said) assert.match(b, /^(minato|saki|jun)\|(room\.bubble\.(know|chorus|agree|queued|cheer|clap|hello|twinYes|duetYes|reqYes)\d?|core\.[\w.]+)$/, `positive bubble only: ${b}`)
    for (const k of ['song', 'invite', 'shift', 'voice', 'coaster', 'finale']) assert.ok(kinds.has(k), `saw ${k} (${[...kinds].join(',')})`)
    assert.ok(kinds.size >= 6, `kinds ${[...kinds].join(',')}`)
    assert.ok(labels.size >= 5, `primary labels ${[...labels].join(' / ')}`)
    noErrors(errors, 'script')
  })

  // ---------------------------------------------------------------- T10: Jun joins, the room re-reads
  await stepC('T10: Jun joins — present, four dots, and his answers light within 2 s at speed 8', async () => {
    const { page, errors } = await open('phone', `${Q}&intro=0&speed=8`)
    await page.waitForSelector('[data-testid=card-top]')
    await S(page, () => {
      for (const id of ['zankoku', 'gurenge', 'idol', 'yoru-ni-kakeru']) window.__navi.get().askRoom(id, 'me')
    })
    await page.waitForTimeout(1200)
    const count = () => S(page, () => Object.values(window.__navi.get().room.knowing).reduce((n, t) => n + Object.keys(t.answers).length, 0))
    const before = await count()
    await page.keyboard.press('?')
    await page.click('[data-testid=pp-join]')
    await page.waitForTimeout(200)
    assert.equal(await page.locator('[data-shell=phone] [data-testid=member-orb][data-member=jun]').first().getAttribute('data-present'), '1')
    const sizes = await page.locator('[data-testid=know-dots]').evaluateAll(els => els.map(e => e.getAttribute('data-size')))
    assert.ok(sizes.length && sizes.every(x => x === '4'), `every know-dots has 4 dots (${sizes})`)
    await page.waitForTimeout(2000)
    const after = await count()
    assert.ok(after > before, `Jun answered the songs the room was asked (${before} → ${after})`)
    const jun = await S(page, () => Object.values(window.__navi.get().room.knowing).filter(t => t.answers.jun).length)
    assert.ok(jun >= 1)
    noErrors(errors, 'T10')
  })

  // ---------------------------------------------------------------- T13 (M5 part): the finale vote
  await stepC('T13: 15 minutes left → vote in the lanterns → the room votes → a gold slot closes the queue', async () => {
    const { page, errors } = await open('phone', `${Q}&intro=0&script=1&speed=8`)
    await page.waitForSelector('[data-testid=card-top]')
    await page.keyboard.press('?')
    await page.click('[data-testid=pp-min15]')
    assert.ok(await waitFor(page, () => window.__navi.get().deck.cards[0]?.kind === 'finale'), 'finale on top')
    await page.click('[data-testid=pp-collapse]')
    const lanterns = page.locator('[data-testid=finale-lantern]')
    assert.equal(await lanterns.count(), 3, 'three lanterns')
    await lanterns.nth(2).click()
    const pick = await lanterns.nth(2).getAttribute('data-song-id')
    await page.click('[data-testid=btn-primary]')
    assert.equal(await page.locator('[data-testid=finale-body]').getAttribute('data-voted'), '1')
    assert.equal(await S(page, () => window.__navi.get().room.prompt?.votes?.me), pick)
    assert.ok(await waitFor(page, () => document.querySelector('[data-testid=finale-body]')?.getAttribute('data-decided')), 'a lantern wins')
    assert.ok(await waitFor(page, () => window.__navi.get().room.prompt === null, null, 4000), 'the room fixed the closing song')
    const last = page.locator('[data-shell=phone] [data-testid=lane-item]').last()
    assert.match((await last.getAttribute('data-tags')) ?? '', /finale/)
    noErrors(errors, 'T13')
  })

  // ---------------------------------------------------------------- E-6: "next time" never reaches the sender
  await stepC('E-6: a request from Saki — "また今度" closes it and Saki is never told', async () => {
    const { page, errors } = await open('phone', `${Q}&intro=0`)
    await page.waitForSelector('[data-testid=card-top]')
    await S(page, () => {
      for (const id of ['marigold', 'lemon']) window.__navi.get().faceEvent(id, 'keep')
    })
    await fire(page, { t: 'request' })
    assert.ok(await waitFor(page, () => window.__navi.get().deck.cards.some(c => c.kind === 'invite' && c.variant === 'request')))
    await toTop(page, 'invite', 'request')
    await page.locator('[data-testid=invite-body][data-variant=request]').waitFor({ state: 'visible' })
    assert.match(await page.locator('[data-testid=invite-body] [data-testid=card-reason]').first().textContent(), /サキ/)
    await page.click('[data-testid=btn-pass]')
    await page.waitForTimeout(1500)
    const st = await S(page, () => window.__navi.get().room.invites.map(i => i.status))
    assert.deepEqual(st, ['open'], 'the sender still sees "delivered"')
    assert.equal(await S(page, () => window.__navi.get().room.bubbles.filter(b => b.member === 'saki').length), 0)
    await fire(page, { t: 'exit' })
    assert.deepEqual(await S(page, () => window.__navi.get().room.invites.filter(i => i.status === 'open')), [], 'it quietly goes at exit')
    noErrors(errors, 'E-6')
  })

  // ---------------------------------------------------------------- E-7 / E-8 on screen
  await stepC('E-7 twin: anonymous until both reveal; E-8 duet: invite → accepted → duet reservation', async () => {
    const { page, errors } = await open('phone', `${Q}&intro=0`)
    await page.waitForSelector('[data-testid=card-top]')
    await S(page, () => {
      const s = window.__navi.get()
      for (const id of ['lilac', 'marigold', 'lemon', 'idol', 'pretender', 'gurenge', 'hakujitsu', 'subtitle']) s.faceEvent(id, 'keep')
    })
    await page.mouse.click(10, 400)
    await fire(page, { t: 'twin' })
    assert.ok(await waitFor(page, () => window.__navi.get().deck.cards.some(c => c.kind === 'invite' && c.variant === 'twin')))
    await toTop(page, 'invite', 'twin')
    const body = page.locator('[data-testid=invite-body][data-variant=twin]')
    await body.waitFor({ state: 'visible' })
    const partner = await S(page, () => window.__navi.get().deck.cards[0].from)
    const names = { minato: 'ミナト', saki: 'サキ', jun: 'ジュン' }
    assert.ok(!(await body.textContent()).includes(names[partner]), 'the partner is not named before both reveal')
    await page.click('[data-testid=btn-primary]')
    assert.equal(await body.getAttribute('data-state'), 'wait')
    assert.ok(await waitFor(page, () => ['met', 'shy'].includes(document.querySelector('[data-testid=invite-body]')?.getAttribute('data-state')), null, 4000))
    const state = await body.getAttribute('data-state')
    if (state === 'met') {
      assert.ok((await body.textContent()).includes(names[partner]), 'names open once both revealed')
      assert.ok((await page.evaluate(() => window.__navi.soundLog)).includes('twin'), 'the harmony plays')
    }
    // duet
    await S(page, () => {
      const s = window.__navi.get()
      s.recordVoice({ nightId: s.session.nightId, at: Date.now(), type: 'clear', power: 0.4, care: 0.7, brightness: 0.6, groove: 0.3, range: null, method: 'quiz', evidence: { key: 'reason.voiceFit' } })
      s.openInvite({ variant: 'duet', from: 'saki', songId: 'uchiage-hanabi' })
    })
    assert.ok(await waitFor(page, () => window.__navi.get().deck.cards.some(c => c.kind === 'invite' && c.variant === 'duet')))
    await toTop(page, 'invite', 'duet')
    const duet = page.locator('[data-testid=invite-body][data-variant=duet]')
    await duet.waitFor({ state: 'visible' })
    assert.match(await duet.textContent(), /光と影のハーモニー/)
    await page.click('[data-testid=btn-primary]')
    assert.ok(await waitFor(page, () => window.__navi.get().room.queue.concat(window.__navi.get().room.now ? [window.__navi.get().room.now.item] : []).some(q => q.songId === 'uchiage-hanabi' && q.tags.includes('duet') && q.with === 'saki'), null, 5000), 'duet reservation with Saki')
    noErrors(errors, 'E-7/E-8')
  })
}
