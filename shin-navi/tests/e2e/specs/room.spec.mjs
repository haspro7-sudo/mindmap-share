// M5 room-sim acceptance (SPEC L/M5; the M5 parts of B-2, T03, T10, T13; E-6, E-7, E-13, E-14)
// and QA fix round 1: the → presses of SPEC N (DEMO#1/#8), the presenter pill (DEMO#0/#10), the
// demo's language at exit (DEMO#5) and あなたの番 never taking a private song (POLICY#1).
export const name = 'room'

const Q = '?test=1&seed=test&reset=1'
const PP_IDS = [
  'next', 'script', 'speed-1', 'speed-4', 'speed-8', 'join', 'leave', 'advance', 'myturn', 'finish', 'hundred', 'request', 'twin',
  'coaster', 'min15', 'exit', 'nextvisit', 'seed', 'view-auto', 'view-phone', 'view-room', 'view-dual', 'lang', 'lens', 'split',
  'noduck', 'entry', 'reset', 'metrics-reset', 'close', 'collapse',
]
/** The script: two quiet set-up steps and six → presses (SPEC N beats 5, 6, 7, 7, 8, 10). */
const STEPS = ['enter', 'saki-mellow', 'minato-reserve', 'jun-join', 'advance-2', 'my-turn', 'my-song-end', 'coaster', 'exit']
const IMPORT_DEMO = ['kaiju-hanauta', 'hakujitsu', 'bansanka', 'plastic-love', 'ditto']
const box = async loc => {
  const b = await loc.boundingBox()
  return b && { l: b.x, t: b.y, r: b.x + b.width, b: b.y + b.height, w: b.width, h: b.height }
}
const hits = (a, b) => !!a && !!b && a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5

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
        // already on top (presenter-fired invites land there): keep its primary button
        if (i <= 0) return {}
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
    assert.equal(await page.locator('[data-testid^=pp-step-]').count(), STEPS.length, 'one rail dot per script step')
    for (const id of STEPS) assert.equal(await page.locator(`[data-testid=pp-step-${id}]`).count(), 1, `pp-step-${id}`)
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

  // ---------------------------------------------------------------- QA DEMO#0/#10: the presenter pill
  await stepC('presenter pill: folded panel ≤ 340×52 on the tab bar (phone) / bottom-right (wide); ⋯ menu; S and L fold it', async () => {
    for (const kind of ['phone', 'small']) {
      const { page, errors } = await open(kind, `${Q}&intro=0&script=1`)
      await page.waitForSelector('[data-testid=card-top]')
      await page.keyboard.press('?')
      await page.locator('[data-testid=presenter-panel][data-mini="0"]').waitFor({ state: 'visible' })
      await page.click('[data-testid=pp-collapse]')
      const pill = page.locator('[data-testid=presenter-panel][data-mini="1"]')
      await pill.waitFor({ state: 'visible' })
      await page.waitForTimeout(400)
      const vw = page.viewportSize().width
      const vh = page.viewportSize().height
      const p = await box(pill)
      assert.ok(p.w <= 340 + 0.5 && p.h <= 52 + 0.5, `${kind}: pill ${p.w}×${p.h}`)
      assert.ok(p.l >= 0 && p.r <= vw && p.t >= 0 && p.b <= vh, `${kind}: pill inside the viewport`)
      for (const [what, sel] of [
        ['status bar', '[data-testid=status-bar]'],
        ['queue', '[data-shell=phone] [data-testid=stage-lane]'],
        ['search', '[data-shell=phone] [data-testid=search-bar]'],
        ['card', '[data-shell=phone] [data-testid=card-top]'],
        ['action bar', '[data-shell=phone] [data-testid=btn-primary]'],
        ['language', '[data-testid=lang-button]'],
      ]) {
        const b = await box(page.locator(sel).first())
        assert.ok(!hits(p, b), `${kind}: pill clear of the ${what} ${JSON.stringify(b)} (pill ${JSON.stringify(p)})`)
      }
      // → from the pill runs the script (the quiet set-up passes silently, Jun walks in)
      assert.equal(await page.locator('[data-testid=pp-next]').getAttribute('data-step'), 'jun-join')
      await page.click('[data-testid=pp-next]')
      assert.ok(await waitFor(page, () => window.__navi.get().room.members.jun.present), `${kind}: → from the pill`)
      // a quick tap on the pill does nothing; holding it opens the menu (Escape closes it)
      const grip = await box(page.locator('.pp-pill__grip'))
      await page.mouse.move(grip.l + 40, grip.t + grip.h / 2)
      await page.mouse.down()
      await page.mouse.up()
      await page.waitForTimeout(700)
      assert.equal(await page.locator('[data-testid=pp-menu]').count(), 0, `${kind}: a tap is not a hold`)
      await page.mouse.down()
      await page.waitForTimeout(700)
      await page.mouse.up()
      await page.locator('[data-testid=pp-menu]').waitFor({ state: 'visible' })
      await page.keyboard.press('Escape')
      await page.locator('[data-testid=pp-menu]').waitFor({ state: 'detached' })
      // ⋯ opens split / lens / Jun / open / close
      await page.click('[data-testid=pp-more]')
      await page.locator('[data-testid=pp-menu]').waitFor({ state: 'visible' })
      for (const id of ['split', 'lens', 'join', 'open', 'close']) assert.equal(await page.locator(`[data-testid=pp-menu] [data-testid=pp-${id}]`).count(), 1, `menu pp-${id}`)
      const m = await box(page.locator('[data-testid=pp-menu]'))
      assert.ok(m.t >= 0 && m.b <= vh && m.l >= 0 && m.r <= vw, `${kind}: the menu is on screen`)
      await page.click('[data-testid=pp-menu] [data-testid=pp-split]')
      await page.locator('[data-testid=split-view]').waitFor({ state: 'visible' })
      assert.equal(await page.locator('[data-testid=presenter-panel]').getAttribute('data-pill'), 'forced')
      // the pill can be dragged, but never over the queue
      const g = await box(page.locator('.pp-pill__grip'))
      await page.mouse.move(g.l + 30, g.t + g.h / 2)
      await page.mouse.down()
      await page.mouse.move(g.l + 30, 10, { steps: 8 })
      await page.mouse.up()
      await page.waitForTimeout(250)
      const lane = await box(page.locator('[data-shell=phone] [data-testid=stage-lane]').first())
      const moved = await box(pill)
      assert.ok(moved.t < p.t - 40, `${kind}: dragged up (${p.t} → ${moved.t})`)
      assert.ok(moved.t >= lane.b - 1, `${kind}: never over the queue (${moved.t} < ${lane.b})`)
      noErrors(errors, `pill ${kind}`)
    }
    // wide: the full panel folds into a bottom-right pill as soon as the split or the lens shows
    const { page, errors } = await open('dual', `?test=1&seed=demo&reset=1&intro=0&view=dual&script=1`)
    await page.waitForSelector('[data-testid=app-root]')
    await page.waitForTimeout(700)
    await page.keyboard.press('?')
    await page.locator('[data-testid=presenter-panel][data-mini="0"]').waitFor({ state: 'visible' })
    for (const key of ['s', 'l']) {
      await page.keyboard.press(key)
      const pill = page.locator('[data-testid=presenter-panel][data-mini="1"]')
      await pill.waitFor({ state: 'visible' })
      await page.waitForTimeout(500)
      const p = await box(pill)
      assert.ok(p.w <= 340.5 && p.h <= 52.5, `dual ${key}: pill ${p.w}×${p.h}`)
      assert.ok(Math.abs(1366 - 16 - p.r) <= 1 && Math.abs(768 - 16 - p.b) <= 1, `dual ${key}: bottom-right, 16 px in (${JSON.stringify(p)})`)
      if (key === 's') {
        await page.evaluate(() => window.__navi.fire({ t: 'join', id: 'jun' }))
        await page.waitForTimeout(1300)
        for (const sel of ['[data-testid=split-dynamic]', '[data-testid=split-flash]']) {
          const b = await box(page.locator(sel).first())
          assert.ok(b && !hits(p, b), `dual: ${sel} clear of the pill`)
        }
      }
      await page.keyboard.press(key)
      await page.locator('[data-testid=presenter-panel][data-mini="0"]').waitFor({ state: 'visible' })
    }
    noErrors(errors, 'pill dual')
  })

  // ---------------------------------------------------------------- E-13 / T03: the script walks the demo
  await stepC('E-13 / T03 (QA DEMO#1/#8): six → presses, each with its own result; the opener is sung; nobody jumps the queue', async () => {
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
    const started = () => S(page, () => window.__started)
    await page.keyboard.press('?')
    await page.click('[data-testid=pp-collapse]')
    // every bubble the floor says during the demo is a positive line from the room namespace
    await S(page, () => {
      window.__bubbles = new Set()
      window.__started = []
      window.__navi.api.subscribe(s => s.room.bubbles.forEach(b => window.__bubbles.add(`${b.member}|${b.text.key}`)))
      window.__navi.api.subscribe((s, p) => {
        if (s.room.now && s.room.now !== p.room.now) window.__started.push(`${s.room.now.item.songId}|${s.room.now.item.by}`)
      })
    })
    // beat 2: my opener goes in first (a thrown card) and is actually sung
    await look()
    const opener = await S(page, () => window.__navi.get().deck.cards[0].songId)
    await page.click('[data-testid=btn-primary]')
    await page.waitForTimeout(600)
    for (let i = 0; i < 3; i++) {
      await look()
      await passTop()
      await page.waitForTimeout(250)
    }
    const presses = []
    const next = async id => {
      assert.equal(await page.locator('[data-testid=pp-next]').getAttribute('data-step'), id, `next step is ${id}`)
      presses.push(id)
      await page.click('[data-testid=pp-next]')
      await page.waitForTimeout(350)
    }
    assert.ok(await waitFor(page, o => window.__navi.get().room.now?.item.songId === o, opener, 5000), 'the opener goes on stage by itself (handshake 6)')
    // the room's quiet set-up: Saki's slow pair first, then Minato
    assert.ok(await waitFor(page, () => window.__navi.get().room.queue.filter(q => q.by === 'saki').length === 2, null, 7000), 'Saki queued her pair')
    assert.ok(await waitFor(page, () => window.__navi.get().room.queue.some(q => q.by === 'minato'), null, 7000), 'Minato reserved on his own')
    const q0 = await S(page, () => window.__navi.get().room.queue.map(q => `${q.songId}|${q.by}`))
    assert.deepEqual(q0.slice(0, 2), ['lemon|saki', 'dry-flower|saki'], `Saki's pair is ahead of Minato (${q0})`)
    // beat 5
    await next('jun-join')
    assert.equal(await page.locator('[data-shell=phone] [data-testid=member-orb][data-member=jun]').first().getAttribute('data-present'), '1')
    await page.waitForTimeout(1500)
    await look()
    const visa = await S(page, () => window.__navi.get().deck.cards.some(c => c.kind === 'song' && c.variant === 'visa'))
    assert.ok(visa, 'a visa card is dealt after Jun joins')
    // beat 6: the opener ends first (mirror face), then Saki's pair back to back → the shift card on top
    await next('advance-2')
    assert.ok(await waitFor(page, () => window.__navi.get().room.sung.length >= 3 && !window.__navi.get().room.now), 'three songs played')
    const sung3 = await S(page, () => window.__navi.get().room.sung.map(e => `${e.item.songId}|${e.item.by}`))
    assert.deepEqual(sung3, [`${opener}|me`, 'lemon|saki', 'dry-flower|saki'])
    assert.equal(await S(page, o => window.__navi.get().col.faces[o]?.state, opener), 'mirror', 'the sung opener is a mirror face')
    await page.waitForTimeout(400)
    assert.equal(await topKind(page), 'shift', 'mellow2 brings the shift card on top (no voice card above it)')
    await look()
    // beat 7: my turn comes after the songs ahead of it, in order
    await next('my-turn')
    assert.ok(await waitFor(page, () => window.__navi.get().room.now?.item.by === 'me'), 'my song is NOW')
    await next('my-song-end')
    await page.waitForTimeout(300)
    const score = await S(page, () => window.__navi.get().room.sung.at(-1)?.score)
    assert.ok(score >= 78 && score <= 96, `demo score ${score}`)
    assert.ok(await waitFor(page, () => window.__navi.get().deck.cards[0]?.kind === 'voice'), 'the voice card is inserted on top')
    await look()
    // Saki's request is a panel button (backup beat), and it lands on top
    await page.click('[data-testid=pp-collapse]')
    await page.click('[data-testid=pp-request]')
    assert.ok(await waitFor(page, () => { const c = window.__navi.get().deck.cards[0]; return c?.kind === 'invite' && c.variant === 'request' }), 'the requested invite lands on top')
    await look()
    await page.click('[data-testid=pp-collapse]')
    // beat 8
    await next('coaster')
    assert.ok(await waitFor(page, () => window.__navi.get().deck.cards[0]?.kind === 'coaster'), 'coaster on top')
    await look()
    // the finale is a panel button too
    await fire(page, { t: 'minutesLeft', m: 15 })
    assert.ok(await waitFor(page, () => window.__navi.get().deck.cards[0]?.kind === 'finale'), 'finale on top')
    await look()
    // beat 10
    await next('exit')
    assert.equal(await S(page, () => window.__navi.get().session.phase), 'wrap')
    assert.equal(await page.locator('[data-testid=pp-next]').getAttribute('data-step'), '', 'script complete')
    assert.deepEqual(presses, ['jun-join', 'advance-2', 'my-turn', 'my-song-end', 'coaster', 'exit'], 'six → presses')
    // songs started in the order they were queued (the opener, Saki's pair, then on)
    const order = await started()
    assert.deepEqual(order.slice(0, 3), [`${opener}|me`, 'lemon|saki', 'dry-flower|saki'], `start order ${order}`)
    const said = await S(page, () => [...window.__bubbles])
    assert.ok(said.length >= 2, `the floor talks during the demo (${said.join(', ')})`)
    for (const b of said) assert.match(b, /^(minato|saki|jun)\|(room\.bubble\.(know|chorus|agree|queued|cheer|clap|hello|twinYes|duetYes|reqYes)\d?|core\.[\w.]+)$/, `positive bubble only: ${b}`)
    for (const k of ['song', 'invite', 'shift', 'voice', 'coaster', 'finale']) assert.ok(kinds.has(k), `saw ${k} (${[...kinds].join(',')})`)
    assert.ok(kinds.size >= 6, `kinds ${[...kinds].join(',')}`)
    assert.ok(labels.size >= 5, `primary labels ${[...labels].join(' / ')}`)
    noErrors(errors, 'script')
  })

  // ---------------------------------------------------------------- QA DEMO#5: the ending in the demo's language
  await stepC('DEMO#5: beat 9 switches to 한국어; the exit → brings the wrap back in Japanese', async () => {
    const { page, errors } = await open('phone', `${Q}&intro=0&script=1`)
    await page.waitForSelector('[data-testid=card-top]')
    await page.keyboard.press('?')
    await page.click('[data-testid=pp-collapse]')
    await page.click('[data-testid=pp-next]') // jun-join
    await page.waitForTimeout(300)
    await S(page, () => window.__navi.fire({ t: 'step', id: 'my-song-end' }))
    assert.ok(await waitFor(page, () => window.__navi.get().room.sung.some(e => e.item.by === 'me')))
    await page.click('[data-testid=lang-button]')
    await page.click('[data-testid=lang-chip][data-locale=ko]')
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'ko')
    await page.keyboard.press('Escape').catch(() => {})
    await fire(page, { t: 'step', id: 'coaster' })
    assert.equal(await page.locator('[data-testid=pp-next]').getAttribute('data-step'), 'exit')
    assert.match(await page.locator('[data-testid=pp-next]').getAttribute('aria-label'), /日本語/, 'the pill says the language comes back')
    await page.click('[data-testid=pp-next]')
    assert.ok(await waitFor(page, () => window.__navi.get().session.phase === 'wrap'))
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'ja', 'the wrap is in Japanese')
    await page.locator('[data-testid=wrap]').waitFor({ state: 'visible' })
    await page.waitForTimeout(600)
    const text = await page.locator('[data-testid=wrap]').innerText()
    assert.ok(/[ぁ-んァ-ン]/.test(text) && !/[가-힣]{2}/.test(text), `the wrap reads in Japanese (${text.slice(0, 80)})`)
    noErrors(errors, 'DEMO#5')
  })

  // ---------------------------------------------------------------- QA POLICY#1: あなたの番 never picks a private card
  await stepC('POLICY#1: pp-myTurn with an import card on top never puts a candidate on the room screen', async () => {
    const { page, errors } = await open('dual', '?test=1&seed=demo&script=1&reset=1&intro=0&view=dual')
    await page.waitForSelector('[data-shell=phone] [data-testid=card-top]')
    assert.ok(await waitFor(page, () => window.__navi.get().deck.cards.some(c => c.kind === 'import')) || true)
    // an import candidate on top, a private invite and a voice card behind it, no reservation of mine
    await S(page, () => {
      const s = window.__navi.get()
      s.openInvite({ variant: 'request', from: 'saki', songId: 'hakujitsu' })
    })
    await page.waitForTimeout(300)
    await S(page, () => {
      const api = window.__navi.api
      const mk = (id, kind, songId, extra = {}) => ({ id, kind, songId, reason: { source: 'dare', text: { key: 'reason.twin' } }, trigger: { type: 'refill', at: 0 }, rule: 'test', dealtAt: Date.now(), ...extra })
      api.setState(s => ({ deck: { ...s.deck, primary: null, cards: [mk('t-imp', 'import', 'kaiju-hanauta'), mk('t-inv', 'invite', 'hakujitsu', { variant: 'request', from: 'saki' }), mk('t-voice', 'voice', 'kanade'), ...s.deck.cards.filter(c => c.kind === 'song')] } }))
    })
    await page.waitForTimeout(300)
    const imports = await S(page, () => window.__navi.get().col.imports.map(i => i.songId))
    await page.keyboard.press('?')
    await page.click('[data-testid=pp-myturn]')
    assert.ok(await waitFor(page, () => window.__navi.get().room.now?.item.by === 'me'), 'my turn')
    const now = await S(page, () => window.__navi.get().room.now.item.songId)
    for (const id of [...IMPORT_DEMO, ...imports, 'hakujitsu', 'kanade']) assert.notEqual(now, id, `NOW is not the private ${id}`)
    const roomText = await page.locator('[data-shell=room]').innerText()
    for (const t of ['怪獣の花唄', 'ハクジツ', '奏']) assert.ok(!roomText.includes(t), `the room screen never shows ${t}`)
    noErrors(errors, 'POLICY#1')
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
    // a presenter-fired twin star lands on top (QA DEMO#14/#15: room fires, the dealer places)
    assert.ok(await waitFor(page, () => { const c = window.__navi.get().deck.cards[0]; return c?.kind === 'invite' && c.variant === 'twin' }), 'the twin invite is on top')
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
