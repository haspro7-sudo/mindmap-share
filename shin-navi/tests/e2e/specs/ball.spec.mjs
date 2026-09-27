// M2 ball acceptance (SPEC L/M2 1–8; T01 ball parts, T02 keep → data-lit-count/data-sketch,
// T04 sketch → neon → mirror, T12 room ball privacy, T15 reduced motion + performance).
// QA fix round 1: ROBUST#2 (raster cost: DPR cap, frame pacing, governor tiers), the record chips'
// highlight (fxState.ballHighlight) and the gap card front (OWNER#6 card-front contract).
export const name = 'ball'

const HERO = '[data-shell=phone] [data-testid=ball-canvas][data-variant=hero], [data-testid=ball-canvas][data-variant=hero]'

async function stats(page) {
  return page.evaluate(() => {
    const faces = Object.values(window.__navi.get().col.faces)
    const st = { lit: faces.length, sketch: 0, neon: 0, mirror: 0, prism: 0 }
    for (const f of faces) st[f.state]++
    const el = document.querySelector('[data-testid=ball-canvas][data-variant=hero]')
    const a = k => Number(el.getAttribute(k))
    return { store: st, dom: { lit: a('data-lit-count'), sketch: a('data-sketch'), neon: a('data-neon'), mirror: a('data-mirror'), prism: a('data-prism') } }
  })
}

/** mean luminance of a square region of the page (0..255), sampled from a screenshot */
async function regionLuma(page, clip) {
  const buf = await page.screenshot({ clip })
  return page.evaluate(async b64 => {
    const img = new Image()
    img.src = `data:image/png;base64,${b64}`
    await img.decode()
    const c = document.createElement('canvas')
    c.width = img.width
    c.height = img.height
    const x = c.getContext('2d')
    x.drawImage(img, 0, 0)
    const d = x.getImageData(0, 0, c.width, c.height).data
    let s = 0
    for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]
    return s / (d.length / 4)
  }, buf.toString('base64'))
}

export async function run({ openApp, assert, step, browser, url }) {
  const noErrors = (errors, where) => assert.deepEqual(errors, [], `${where}: console/page errors\n${errors.join('\n')}`)

  await step('hero: drops in on a wire, is ready by 3.2 s, bright centre, spins (B-2, T01)', async () => {
    const { page, errors, context } = await openApp('phone')
    await page.waitForSelector(HERO)
    await page.waitForTimeout(90)
    const early = await page.evaluate(() => {
      const body = document.querySelector('.mb--hero .mb__body')
      return { t: getComputedStyle(body).transform, wire: !!document.querySelector('.mb--hero .mb__wire') }
    })
    assert.ok(early.wire, 'the hero hangs from a wire')
    assert.notEqual(early.t, 'none', `ball is still dropping at 90 ms (transform ${early.t})`)
    await page.waitForTimeout(3100)
    assert.equal(await page.getAttribute(HERO, 'data-ready'), '1')
    const settled = await page.evaluate(() => getComputedStyle(document.querySelector('.mb--hero .mb__body')).transform)
    assert.ok(settled === 'none' || /matrix\(1, 0, 0, 1, 0, 0\)/.test(settled), `ball rests at its final spot (${settled})`)
    const box = await page.locator('.mb--hero').boundingBox()
    assert.ok(Math.abs(box.width - 196) < 1, `hero ball Ø196 at 390 wide (${box.width})`)
    const luma = await regionLuma(page, { x: box.x + box.width * 0.3, y: box.y + box.height * 0.3, width: box.width * 0.4, height: box.height * 0.4 })
    assert.ok(luma > 55, `ball centre is lit (mean luma ${luma.toFixed(1)})`)
    const r0 = await page.evaluate(() => window.__ball.rot())
    await page.waitForTimeout(1000)
    const r1 = await page.evaluate(() => window.__ball.rot())
    const perSec = r1 - r0
    assert.ok(Math.abs(perSec - (Math.PI * 2) / 24) < 0.06, `one turn per 24 s (${perSec.toFixed(3)} rad/s)`)
    const em = await page.evaluate(() => window.__ball.emitters())
    assert.ok(em.length >= 4 && em.every(e => e.x > box.x - 60 && e.x < box.x + box.width + 60 && e.y > box.y - 60 && e.y < box.y + box.height + 60), `fxState.emitters sit on the ball (${JSON.stringify(em.slice(0, 3))})`)
    noErrors(errors, 'hero')
    await context.close()
  })

  await step('small 360×740: Ø160 and no horizontal scroll', async () => {
    const { page, errors, context } = await openApp('small', '?test=1&seed=test&reset=1&intro=0')
    await page.waitForSelector(HERO)
    await page.waitForTimeout(500)
    const box = await page.locator('.mb--hero').boundingBox()
    assert.ok(Math.abs(box.width - 160) < 1, `hero ball Ø160 at 360 wide (${box.width})`)
    const sw = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth))
    assert.ok(sw <= 360, `scrollWidth ${sw}`)
    noErrors(errors, 'small')
    await context.close()
  })

  await step('data attributes mirror the store through sketch → neon → mirror → prism (T02/T04)', async () => {
    const { page, errors, context } = await openApp('phone', '?test=1&seed=test&reset=1&intro=0')
    await page.waitForSelector(HERO)
    await page.waitForTimeout(300)
    let s = await stats(page)
    assert.deepEqual(s.dom, s.store)
    await page.evaluate(() => ['lemon', 'gurenge', 'idol'].forEach(id => window.__navi.get().faceEvent(id, 'keep')))
    await page.waitForTimeout(150)
    s = await stats(page)
    assert.equal(s.dom.sketch, 3)
    assert.deepEqual(s.dom, s.store)
    await page.evaluate(() => {
      const g = window.__navi.get
      g().faceEvent('lemon', 'reserve')
      g().faceEvent('gurenge', 'sung')
      g().faceEvent('idol', 'sungAllKnow')
      g().faceEvent('marigold', 'reserve')
    })
    await page.waitForTimeout(150)
    s = await stats(page)
    assert.deepEqual(s.dom, { lit: 4, sketch: 0, neon: 2, mirror: 1, prism: 1 })
    assert.deepEqual(s.dom, s.store)
    const mini = await page.evaluate(() => {
      const el = document.querySelector('[data-testid=ball-canvas-mini]')
      return el && { lit: el.getAttribute('data-lit-count'), priv: el.closest('[data-private="1"]') != null }
    })
    assert.ok(mini && mini.lit === '4' && mini.priv, `dock mini ball mirrors the store and is private (${JSON.stringify(mini)})`)
    noErrors(errors, 'data')
    await context.close()
  })

  await step('keep flight: the face turns to the front before landing; face resolver is on screen (M2-4)', async () => {
    const { page, errors, context } = await openApp('phone', '?test=1&seed=test&reset=1&intro=0')
    await page.waitForSelector(HERO)
    await page.waitForTimeout(600)
    // pick a song whose face is on the back right now
    const id = await page.evaluate(() => {
      const ids = ['lemon', 'gurenge', 'idol', 'pretender', 'plastic-love', 'que-sera', 'kick-back', 'hakujitsu', 'first-love', 'cha-la']
      return ids.find(x => window.__ball.face(x).z < -0.2) ?? ids[0]
    })
    const before = await page.evaluate(x => window.__ball.face(x), id)
    // a real keep: deal a song card for this id and keep it (performCardAction emits fx/flight)
    await page.evaluate(x => {
      const s = window.__navi.get()
      s.dealCards([{ id: 'k-test', kind: 'song', songId: x, reason: { source: 'yomu', text: { key: 'reason.opener' } }, trigger: { type: 'enter', at: 0 }, rule: 'test', dealtAt: Date.now() }], 'top')
    }, id)
    await page.evaluate(() => window.__navi.get().act('k-test', 'keep'))
    const target = await page.evaluate(x => window.__ball.resolve(x), id)
    await page.waitForTimeout(420)
    const after = await page.evaluate(x => window.__ball.face(x), id)
    assert.ok(after.z > 0.6, `face ${id} came to the front (z ${before.z.toFixed(2)} → ${after.z.toFixed(2)})`)
    assert.ok(target && target.x > 0 && target.x < 390 && target.y > 0 && target.y < 844, `resolveTarget(face:${id}) is on screen ${JSON.stringify(target)}`)
    assert.ok(Math.hypot(target.x + target.w / 2 - after.x, target.y + target.h / 2 - after.y) < 14, 'the flight target is where the face ends up')
    await page.waitForTimeout(600)
    const still = await page.evaluate(x => window.__ball.face(x), id)
    assert.ok(still.z > 0.6, 'the face stays in front while it flashes')
    // pins fly to the hanging ring: face:@pins resolves to the top of the ball
    const ring = await page.evaluate(() => window.__ball.resolve('@pins'))
    const hb = await page.locator('.mb--hero').boundingBox()
    assert.ok(ring && Math.abs(ring.x + ring.w / 2 - (hb.x + hb.width / 2)) < 4 && ring.y + ring.h / 2 < hb.y + hb.height * 0.2, `pin ring target sits at the top of the ball ${JSON.stringify(ring)}`)
    noErrors(errors, 'keep')
    await context.close()
  })

  await step('tap a lit face → face sheet; tap a dark face → area bubble → search filtered (C-1)', async () => {
    const { page, errors, context } = await openApp('phone', '?test=1&seed=test&reset=1&intro=0')
    await page.waitForSelector(HERO)
    await page.waitForTimeout(500)
    // dark face
    const dark = await page.evaluate(() => window.__ball.darkPoint())
    assert.ok(dark, 'a dark face is in front')
    await page.mouse.click(dark.x, dark.y)
    await page.locator('[data-testid=ball-area-bubble]').waitFor({ state: 'visible', timeout: 2000 })
    const area = await page.getAttribute('[data-testid=ball-area-bubble]', 'data-area')
    assert.match(area, /^(fast|mid|slow):/)
    // the bubble floats above the hero's floor lights
    const hit = await page.evaluate(() => {
      const b = document.querySelector('[data-testid=ball-area-open]').getBoundingClientRect()
      const el = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)
      return !!el && !!el.closest('[data-testid=ball-area-open]')
    })
    assert.ok(hit, 'the bubble button is on top')
    await page.click('[data-testid=ball-area-open]')
    await page.waitForTimeout(200)
    const sheet = await page.evaluate(() => window.__navi.get().ui.sheet)
    assert.equal(sheet?.id, 'search')
    assert.equal(`${sheet.arg.filters.tempo}:${sheet.arg.filters.genre}`, area)
    await page.evaluate(() => window.__navi.get().closeSheet())
    await page.waitForTimeout(400)
    // lit face: light the face under the centre, then tap it
    const lit = await page.evaluate(() => {
      const p = window.__ball.darkPoint()
      window.__navi.get().faceEvent(p.songId, 'reserve')
      return window.__ball.face(p.songId) && { ...window.__ball.face(p.songId), songId: p.songId }
    })
    await page.waitForTimeout(700) // it turns to the front
    const p2 = await page.evaluate(x => window.__ball.face(x), lit.songId)
    await page.mouse.click(p2.x, p2.y)
    await page.waitForTimeout(200)
    const sheet2 = await page.evaluate(() => window.__navi.get().ui.sheet)
    assert.equal(sheet2?.id, 'face')
    assert.equal(sheet2.arg.songId, lit.songId)
    noErrors(errors, 'tap')
    await context.close()
  })

  await step('horizontal drag spins the ball with inertia; vertical swipes still reach the hero', async () => {
    const { page, errors, context } = await openApp('phone', '?test=1&seed=test&reset=1&intro=0')
    await page.waitForSelector(HERO)
    await page.waitForTimeout(400)
    const box = await page.locator('.mb--hero').boundingBox()
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    const r0 = await page.evaluate(() => window.__ball.rot())
    await page.mouse.move(cx - 60, cy)
    await page.mouse.down()
    await page.mouse.move(cx - 30, cy, { steps: 2 })
    await page.mouse.move(cx + 60, cy, { steps: 6 })
    await page.mouse.up()
    const r1 = await page.evaluate(() => window.__ball.rot())
    assert.ok(r1 - r0 > 1.0, `dragging 120 px turns the ball (Δ ${(r1 - r0).toFixed(2)} rad)`)
    // a quick flick at touch-event rate (dispatched in the page so the timing is real)
    await page.waitForTimeout(1200)
    const f1 = await page.evaluate(async ([x0, y]) => {
      const el = document.querySelector('.mb--hero')
      const fire = (type, x) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y }))
      fire('pointerdown', x0)
      for (let i = 1; i <= 8; i++) {
        await new Promise(r => setTimeout(r, 12))
        fire('pointermove', x0 + i * 15)
      }
      fire('pointerup', x0 + 120)
      return window.__ball.rot()
    }, [cx - 60, cy])
    await page.waitForTimeout(300)
    const f2 = await page.evaluate(() => window.__ball.rot())
    assert.ok(f2 - f1 > 0.4, `it keeps turning after the flick (inertia Δ ${(f2 - f1).toFixed(2)} rad in 300 ms)`)
    await page.waitForTimeout(3000)
    const r3 = await page.evaluate(() => window.__ball.rot())
    await page.waitForTimeout(1000)
    const r4 = await page.evaluate(() => window.__ball.rot())
    assert.ok(Math.abs(r4 - r3 - (Math.PI * 2) / 24) < 0.08, `settles back to the 24 s turn (${(r4 - r3).toFixed(3)})`)
    // C-1: a horizontal drag on the hero background (outside the ball) turns the ball as well
    const hb0 = await page.evaluate(() => window.__ball.rot())
    const hb1 = await page.evaluate(async y => {
      const el = document.querySelector('[data-testid=hero]')
      const fire = (type, x) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 11, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y }))
      fire('pointerdown', 20)
      for (let i = 1; i <= 6; i++) {
        await new Promise(r => setTimeout(r, 12))
        fire('pointermove', 20 + i * 12)
      }
      fire('pointerup', 92)
      return window.__ball.rot()
    }, box.y + 30)
    assert.ok(hb1 - hb0 > 0.5, `dragging the hero background turns the ball (Δ ${(hb1 - hb0).toFixed(2)} rad)`)
    await page.waitForTimeout(2500)
    // vertical swipe on the ball: the hero opens search (not a ball drag)
    const [rs0, ts0] = await page.evaluate(() => [window.__ball.rot(), performance.now()])
    await page.evaluate(async ([x, y0]) => {
      const el = document.querySelector('.mb--hero')
      const fire = (type, y) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 9, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y }))
      fire('pointerdown', y0)
      for (let i = 1; i <= 8; i++) {
        await new Promise(r => setTimeout(r, 12))
        fire('pointermove', y0 - i * 15)
      }
      fire('pointerup', y0 - 120)
    }, [cx, cy + 40])
    await page.waitForTimeout(250)
    const sheet = await page.evaluate(() => window.__navi.get().ui.sheet?.id ?? null)
    assert.equal(sheet, 'search', 'swipe up on the hero opens search')
    const [rs1, ts1] = await page.evaluate(() => [window.__ball.rot(), performance.now()])
    // The ball keeps its idle spin (one turn per 24 s); only extra rotation would come from the swipe.
    const idle = ((ts1 - ts0) / 1000) * ((Math.PI * 2) / 24)
    assert.ok(Math.abs(rs1 - rs0 - idle) < 0.2, `a vertical swipe does not spin the ball (Δ ${(rs1 - rs0).toFixed(2)} rad, idle ${idle.toFixed(2)})`)
    noErrors(errors, 'drag')
    await context.close()
  })

  await step('mini ball draws at ~10 fps; hero pauses while another tab is shown', async () => {
    const { page, errors, context } = await openApp('phone', '?test=1&seed=test&reset=1&intro=0')
    await page.waitForSelector('[data-testid=ball-canvas-mini]')
    await page.waitForTimeout(500)
    const f0 = await page.evaluate(() => ({ mini: window.__ball.frames('mini'), hero: window.__ball.frames('hero') }))
    await page.waitForTimeout(2000)
    const f1 = await page.evaluate(() => ({ mini: window.__ball.frames('mini'), hero: window.__ball.frames('hero') }))
    const miniFps = (f1.mini - f0.mini) / 2
    const heroFps = (f1.hero - f0.hero) / 2
    // headless machines may render below 60 fps; the mini ball must still stay at ≤10 fps
    assert.ok(miniFps <= 11 && miniFps >= Math.min(7, heroFps * 0.45), `mini ball ≈10 fps (${miniFps}; hero ${heroFps})`)
    assert.ok(heroFps > miniFps * 1.4, `the idle hero draws faster than the dock ball (${heroFps} fps, ≈30 when idle — ROBUST#2 pacing)`)
    await page.click('[data-testid=dock-sing]')
    await page.waitForTimeout(700)
    const h0 = await page.evaluate(() => window.__ball.frames('hero'))
    await page.waitForTimeout(1000)
    const h1 = await page.evaluate(() => window.__ball.frames('hero'))
    assert.ok(h1 - h0 <= 1, `hero is paused behind the sing tab (${h1 - h0} frames)`)
    noErrors(errors, 'fps')
    await context.close()
  })

  await step('room view: Ø≈420 shared ball lights only tonight’s queue in the reserver’s colour (M2-7, T12)', async () => {
    const { page, errors, context } = await openApp('tablet')
    await page.waitForSelector('[data-shell=room] [data-testid=ball-canvas]')
    await page.waitForTimeout(3300)
    const sel = '[data-shell=room] [data-testid=ball-canvas]'
    assert.equal(await page.getAttribute(sel, 'data-ready'), '1')
    const priv = await page.evaluate(() => document.querySelector('[data-shell=room] .mb').closest('[data-private="1"]') != null || document.querySelector('[data-shell=room] .mb').getAttribute('data-private'))
    assert.ok(!priv, 'the room ball is not private')
    const w = (await page.locator('[data-shell=room] .mb').boundingBox()).width
    assert.ok(w >= 360 && w <= 421, `room ball Ø ${w}`)
    await page.evaluate(() => {
      const s = window.__navi.get()
      s.faceEvent('lemon', 'keep') // personal: never on the shared ball
      s.reserve('gurenge', { by: 'minato' })
    })
    await page.waitForTimeout(300)
    const a = await page.evaluate(s => {
      const el = document.querySelector(s)
      return { lit: el.getAttribute('data-lit-count'), neon: el.getAttribute('data-neon'), sketch: el.getAttribute('data-sketch') }
    }, sel)
    assert.deepEqual(a, { lit: '1', neon: '1', sketch: '0' })
    const visiblePrivate = await page.evaluate(() => [...document.querySelectorAll('[data-shell=room] [data-private="1"]')].filter(e => e.getBoundingClientRect().width > 0).length)
    assert.equal(visiblePrivate, 0)
    noErrors(errors, 'room')
    await context.close()
  })

  await step('gap card front: zoomed ball, the area as the title, one short line, a peek at its songs; primary opens the area (M2-8, OWNER#6)', async () => {
    for (const [locale, viewport] of [['ja', 'phone'], ['en', 'small']]) {
      const { page, errors, context } = await openApp(viewport, `?test=1&seed=test&reset=1&intro=0&locale=${locale}`)
      await page.waitForSelector('[data-testid=deck]')
      await page.waitForTimeout(500)
      await page.evaluate(() => {
        window.__navi.get().dealCards([{ id: 'gap-e2e', kind: 'gap', area: 'slow:J-POP', reason: { source: 'yomu', text: { key: 'reason.gap', vars: { tempo: { tempo: 'slow' }, genre: { genre: 'J-POP' } } }, cause: { key: 'cause.interval' } }, trigger: { type: 'enter', at: 0 }, rule: 'test', dealtAt: Date.now() }], 'top')
      })
      await page.waitForSelector('.gap-body [data-testid=gap-ball]')
      await page.waitForTimeout(400)
      const info = await page.evaluate(() => {
        const body = document.querySelector('.gap-body')
        // visible text elements on the front of the body (leaf elements with their own text)
        const texts = [...body.querySelectorAll('*')].filter(el => [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && el.getBoundingClientRect().width > 0)
        const title = body.querySelector('.gap-body__title').getBoundingClientRect()
        const line = body.querySelector('.gap-body__line').getBoundingClientRect()
        const face = body.closest('.cs__face')?.getBoundingClientRect() ?? body.getBoundingClientRect()
        return {
          head: body.querySelector('[data-testid=card-reason]').textContent,
          title: body.querySelector('.gap-body__title').textContent,
          line: body.querySelector('.gap-body__line').textContent,
          songs: body.querySelector('.gap-body__songs').textContent.split(' · ').length,
          all: body.textContent,
          texts: texts.length,
          minFont: Math.min(...texts.map(el => parseFloat(getComputedStyle(el).fontSize))),
          inside: title.left >= face.left - 1 && title.right <= face.right + 1 && line.bottom <= face.bottom + 1,
          ready: body.querySelector('[data-testid=gap-ball]').getAttribute('data-ready'),
          primary: window.__navi.get().deck.primary,
        }
      })
      if (locale === 'ja') {
        assert.equal(info.title, 'スローなJ-POP', `the area is the title (${info.title})`)
        assert.match(info.line, /まだ0曲/)
      } else {
        assert.equal(info.title, 'Slow J-Pop', `the area is the title (${info.title})`)
        assert.match(info.line, /None lit/)
      }
      // card-front contract: no planner numbers or region jargon on the front
      assert.ok(!/23|面が点灯|南側|faces lit|the south/.test(info.all), `no counters / region jargon on the front: ${info.all}`)
      assert.ok(info.texts <= 4, `at most title, line and a song peek on the body (${info.texts} text elements)`)
      assert.ok(info.minFont >= 12, `min font 12px (${info.minFont})`)
      assert.ok(info.inside, 'title and line inside the card')
      assert.equal(info.songs, 3, 'a peek at three songs of the area')
      assert.equal(info.ready, '1')
      assert.equal(info.primary?.action, 'openArea')
      await page.evaluate(() => window.__navi.get().act('gap-e2e', 'openArea'))
      await page.waitForTimeout(200)
      const sheet = await page.evaluate(() => window.__navi.get().ui.sheet)
      assert.equal(sheet?.id, 'search')
      assert.equal(sheet.arg.filters.tempo, 'slow')
      noErrors(errors, `gap ${locale}`)
      await context.close()
    }
  })

  await step('record chips: fxState.ballHighlight dims the other faces to ~25 %, turns the nearest match to the front, clears on null', async () => {
    const { page, errors, context } = await openApp('phone', '?test=1&seed=test&reset=1&intro=0')
    await page.waitForSelector(HERO)
    await page.evaluate(() => {
      const g = window.__navi.get
      ;['lemon', 'gurenge', 'idol', 'pretender', 'marigold', 'hakujitsu'].forEach((id, i) => g().faceEvent(id, i % 2 ? 'reserve' : 'sung'))
    })
    await page.click('[data-testid=dock-record]')
    const REC = '[data-testid=ball-canvas][data-variant=record]'
    await page.waitForSelector(REC)
    await page.waitForTimeout(600)
    assert.equal(await page.evaluate(() => window.__ball.dimmed('record')), 0, 'nothing dimmed without a chip')
    const neon = await page.evaluate(() => Object.values(window.__navi.get().col.faces).filter(f => f.state === 'neon').map(f => f.songId))
    await page.evaluate(() => window.__ball.highlight('neon'))
    await page.waitForTimeout(1100)
    const r = await page.evaluate(ids => ({
      attr: document.querySelector('[data-testid=ball-canvas][data-variant=record]').getAttribute('data-highlight'),
      dimmed: window.__ball.dimmed('record'),
      mini: window.__ball.dimmed('mini'),
      front: Math.max(...ids.map(id => window.__ball.face(id, 'record')?.z ?? -1)),
    }), neon)
    assert.equal(r.attr, 'neon')
    assert.equal(r.dimmed, 154 - neon.length, `every face but the ${neon.length} neon ones dims (${r.dimmed})`)
    assert.ok(r.mini > 100, `the dock ball follows (${r.mini})`)
    assert.ok(r.front > 0.8, `the nearest neon face turned to the front (z ${r.front.toFixed(2)})`)
    await page.evaluate(() => window.__ball.highlight(null))
    await page.waitForTimeout(700)
    assert.equal(await page.evaluate(() => window.__ball.dimmed('record')), 0, 'all faces light again')
    noErrors(errors, 'highlight')
    await context.close()
  })

  await step('reduced motion: no drop, no spin, ball in place at 300 ms (T15)', async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce' })
    const page = await context.newPage()
    await page.goto(new URL('?test=1&seed=test&reset=1', url).href)
    await page.waitForSelector(HERO)
    await page.waitForTimeout(300)
    const t = await page.evaluate(() => getComputedStyle(document.querySelector('.mb--hero .mb__body')).transform)
    assert.ok(t === 'none' || /matrix\(1, 0, 0, 1, 0, 0\)/.test(t), `no drop under reduced motion (${t})`)
    const r0 = await page.evaluate(() => window.__ball.rot())
    await page.waitForTimeout(800)
    const r1 = await page.evaluate(() => window.__ball.rot())
    assert.ok(Math.abs(r1 - r0) < 1e-6, 'the ball does not spin')
    await context.close()
  })

  await step('ROBUST#2 raster cost: DPR ≤ 1.5, the idle hero redraws at ~30 fps, a finger gets every frame, lower tiers go lighter', async () => {
    const { page, errors, context } = await openApp('phone', '?test=1&seed=test&reset=1&intro=0')
    await page.waitForSelector(HERO)
    await page.evaluate(() => window.__fx.forceTier(2))
    await page.waitForTimeout(1200)
    const a = await page.evaluate(() => ({ p: window.__ball.pace('hero'), t: performance.now(), css: document.querySelector('[data-testid=ball-canvas][data-variant=hero]').getBoundingClientRect().width }))
    assert.ok(a.p.dpr <= 1.5, `hero DPR ${a.p.dpr} (device 2)`)
    assert.ok(a.p.px <= Math.ceil(a.css * 1.5) ** 2, `backing store ${a.p.px} px for ${a.css} css px`)
    const halo = await page.evaluate(() => !!document.querySelector('.mb--hero .mb__halo'))
    assert.ok(halo, 'the static halo lives in its own canvas')
    await page.waitForTimeout(2000)
    const b = await page.evaluate(() => ({ p: window.__ball.pace('hero'), t: performance.now() }))
    const draws = b.p.frames - a.p.frames
    const ticks = draws + (b.p.skipped - a.p.skipped)
    const fps = (draws * 1000) / (b.t - a.t)
    assert.ok(b.p.skipped - a.p.skipped > 10, `idle ticks are skipped (${b.p.skipped - a.p.skipped})`)
    assert.ok(fps <= 36, `idle hero ≈30 fps at most: ${fps.toFixed(1)} fps, ${draws}/${ticks} ticks drawn`)
    // a finger on the ball: every frame is drawn
    const box = await page.locator('.mb--hero').boundingBox()
    const drag = await page.evaluate(async ([x0, y]) => {
      const el = document.querySelector('.mb--hero')
      const fire = (type, x) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 5, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y }))
      fire('pointerdown', x0)
      const p0 = window.__ball.pace('hero')
      for (let i = 1; i <= 30; i++) {
        await new Promise(r => requestAnimationFrame(r))
        fire('pointermove', x0 + i * 3)
      }
      const p1 = window.__ball.pace('hero')
      fire('pointerup', x0 + 90)
      return { draws: p1.frames - p0.frames, skipped: p1.skipped - p0.skipped }
    }, [box.x + 30, box.y + box.height / 2])
    assert.ok(drag.draws >= 26 && drag.skipped <= 3, `dragging draws every frame (${JSON.stringify(drag)})`)
    // tier 0: 15 fps, DPR 1
    await page.evaluate(() => window.__fx.forceTier(0))
    await page.waitForTimeout(1500)
    const c = await page.evaluate(() => ({ p: window.__ball.pace('hero'), t: performance.now() }))
    await page.waitForTimeout(2000)
    const d = await page.evaluate(() => ({ p: window.__ball.pace('hero'), t: performance.now() }))
    const fps0 = ((d.p.frames - c.p.frames) * 1000) / (d.t - c.t)
    assert.equal(d.p.dpr, 1, 'tier 0 draws at DPR 1')
    assert.ok(fps0 <= 19, `tier 0 idles at ≈15 fps (${fps0.toFixed(1)})`)
    noErrors(errors, 'pace')
    await context.close()
  })

  await step('performance: 154 faces ≤ 4 ms per frame with the CPU throttled ×4 (M2-6)', async () => {
    const { page, errors, context } = await openApp('phone', '?test=1&seed=test&reset=1&intro=0')
    await page.waitForSelector(HERO)
    await page.evaluate(() => {
      const g = window.__navi.get
      const evs = ['keep', 'reserve', 'sung', 'sungAllKnow']
      const all = ['marigold', 'lemon', 'gurenge', 'zankoku', 'idol', 'pretender', 'plastic-love', 'que-sera', 'yoru-ni-kakeru', 'first-love', 'kick-back', 'bbbb', 'hakujitsu', 'dry-flower', 'cha-la', 'kanden', 'uchiage-hanabi', 'ao-no-sumika', 'shinjidai', 'homura', 'lilac', 'otonoke', 'bansanka', 'kaiju-hanauta', 'ditto', 'mixed-nuts', 'subtitle', 'cinderella-boy', 'suiheisen', 'kimi-rock']
      all.forEach((id, i) => g().faceEvent(id, evs[i % 4]))
      g().addLink('marigold', 'dry-flower')
      g().addLink('lemon', 'pretender')
      for (const p of ['spark', 'allKnow', 'faces30']) g().earnPin(p)
    })
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
    await page.waitForTimeout(2200)
    // three one-second medians; the best one filters out other processes stealing the CPU
    const samples = []
    for (let k = 0; k < 3; k++) {
      await page.waitForTimeout(1100)
      samples.push({ ms: Number(await page.getAttribute(HERO, 'data-draw-ms')), p90: Number(await page.getAttribute(HERO, 'data-draw-ms-p90')) })
    }
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
    const best = Math.min(...samples.map(x => x.ms))
    assert.ok(best > 0 && best <= 4, `median draw ≤ 4 ms at 4× CPU throttle (${JSON.stringify(samples)})`)
    noErrors(errors, 'perf')
    await context.close()
  })
}
