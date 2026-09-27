// M1 fx-sound acceptance (SPEC L/M1, T01 background, T15 reduced motion + performance).
// The fx layer exposes counters as window.__fx in test mode (see src/features/fx/installFx.ts).
export const name = 'fx'

export async function run({ browser, url, openApp, assert, step, VIEWPORTS }) {
  const noErrors = (errors, where) => assert.deepEqual(errors, [], `${where}: console/page errors\n${errors.join('\n')}`)
  const fx = page => page.evaluate(() => ({ dbg: JSON.parse(JSON.stringify(window.__fx.debug)), st: window.__fx.state(), sound: window.__fx.sound() }))

  await step('T01: aurora, horizon and 12 specks are up by 3.2 s; the wall is not flat', async () => {
    const { page, errors, context } = await openApp('phone')
    await page.waitForSelector('[data-testid=app-root]')
    await page.waitForTimeout(3200)
    const r = await fx(page)
    assert.equal(r.dbg.bgMode, 'canvas', 'aurora painted on the canvas at start (tier ≥ 1)')
    assert.ok(r.dbg.frames.bg > 10, `aurora frames ${r.dbg.frames.bg}`)
    assert.equal(r.dbg.specks, 12, 'twelve specks thrown from the ball (12 + mirror faces)')
    assert.ok(r.st.emitters > 0, 'the ball feeds fxState.emitters')
    // the horizon line has drawn itself out (scaleX 1)
    const hz = await page.evaluate(() => {
      const el = document.querySelector('[data-shell=phone] .fx-horizon')
      const m = getComputedStyle(el).transform
      const r = el.getBoundingClientRect()
      return { m, top: r.top }
    })
    assert.ok(hz.m === 'none' || /^matrix\(1, 0, 0, 1/.test(hz.m), `horizon fully drawn: ${hz.m}`)
    assert.ok(Math.abs(hz.top - 340) < 4, `horizon at y≈340 (${hz.top})`)
    // luminance of the aurora canvas: lit and uneven (neither black nor one colour).
    // Read right after a paint (a tier change resizes, and so clears, the canvas).
    const lum = await page.evaluate(async () => {
      const f0 = window.__fx.debug.frames.bg
      for (let i = 0; i < 200 && window.__fx.debug.frames.bg === f0; i++) await new Promise(r => setTimeout(r, 4))
      const c = document.querySelector('[data-shell=phone] .fx-bg__canvas')
      const g = c.getContext('2d')
      const d = g.getImageData(0, 0, c.width, c.height).data
      let n = 0
      let sum = 0
      let sq = 0
      for (let i = 0; i < d.length; i += 16) {
        const a = d[i + 3] / 255
        const l = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) * a
        sum += l
        sq += l * l
        n++
      }
      const mean = sum / n
      return { mean, std: Math.sqrt(Math.max(0, sq / n - mean * mean)) }
    })
    assert.ok(lum.mean > 4, `aurora is lit (mean ${lum.mean.toFixed(1)})`)
    assert.ok(lum.std > 4, `aurora is not one flat colour (std ${lum.std.toFixed(1)})`)
    noErrors(errors, 'phone')
    await context.close()
  })

  await step('fx components never re-render while the home screen idles (3 s)', async () => {
    const context = await browser.newContext({ ...VIEWPORTS.phone, locale: 'ja-JP' })
    // count React commits through the devtools hook (React calls it on every commit)
    await context.addInitScript(() => {
      window.__commits = 0
      window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
        supportsFiber: true,
        renderers: new Map(),
        inject() {
          return 1
        },
        onScheduleFiberRoot() {},
        onCommitFiberRoot() {
          window.__commits++
        },
        onCommitFiberUnmount() {},
        onPostCommitFiberRoot() {},
        checkDCE() {},
      }
    })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto(new URL('?test=1&seed=test&reset=1&script=1', url).href)
    await page.waitForTimeout(4200)
    const a = await page.evaluate(() => ({ r: { ...window.__fx.debug.renders }, f: window.__fx.debug.frames.specks, c: window.__commits }))
    await page.waitForTimeout(3000)
    const b = await page.evaluate(() => ({ r: { ...window.__fx.debug.renders }, f: window.__fx.debug.frames.specks, c: window.__commits }))
    assert.deepEqual(b.r, a.r, 'BackgroundCanvas / SpeckCanvas / BurstLayer did not render again')
    assert.ok(b.f - a.f > 30, `the canvases kept painting on the ticker (${b.f - a.f} frames)`)
    console.log(`      (whole app: ${b.c - a.c} React commits in 3 s of idle home, script mode)`)
    noErrors(errors, 'idle')
    await context.close()
  })

  await step('B-4: first tap turns the lights on — lightOn, flash 1 → 0 in 600 ms, speck bloom', async () => {
    const { page, errors, context } = await openApp('phone')
    await page.waitForTimeout(3300)
    const before = await page.evaluate(() => [...window.__navi.soundLog])
    assert.deepEqual(before, [], 'silent before the first tap')
    await page.mouse.click(30, 300)
    await page.waitForTimeout(60)
    const r = await fx(page)
    assert.ok(r.st.flash > 0.5, `flash right after the tap (${r.st.flash})`)
    assert.equal(r.dbg.lightsOn, 1, 'lights-on cue once')
    assert.ok((await page.evaluate(() => window.__navi.soundLog)).includes('lightOn'))
    await page.waitForTimeout(800)
    assert.equal((await fx(page)).st.flash, 0, 'flash decayed within 600 ms')
    noErrors(errors, 'lights on')
    await context.close()
  })

  await step('I-4 #7: heat changes cross-fade the palette over 1.8 s; a rest halves the flow for one song', async () => {
    const { page, errors, context } = await openApp('phone', '?test=1&seed=test&reset=1&intro=0&script=1')
    await page.waitForTimeout(1200)
    const speed0 = (await fx(page)).st.speed
    await page.evaluate(() => window.__navi.api.setState(s => ({ room: { ...s.room, heat: 0.9, moodWord: 'peak' } })))
    await page.waitForTimeout(900)
    const mid = await fx(page)
    assert.equal(mid.st.aurora, 'hot')
    assert.equal(mid.st.auroraFrom, 'quiet')
    assert.ok(mid.st.auroraT > 0.25 && mid.st.auroraT < 0.8, `half-way at 0.9 s (${mid.st.auroraT})`)
    await page.waitForTimeout(1200)
    const end = await fx(page)
    assert.equal(end.st.auroraT, 1, 'settled after 1.8 s')
    assert.ok(end.st.speed > speed0, `hotter room flows faster (${speed0} → ${end.st.speed})`)
    await page.evaluate(() => window.__navi.get().restOneSong())
    await page.waitForTimeout(100)
    const rest = await fx(page)
    assert.ok(Math.abs(rest.st.speed - end.st.speed / 2) < 1e-6, `half speed during the rest (${rest.st.speed})`)
    noErrors(errors, 'palette')
    await context.close()
  })

  await step('bursts and chimes: a prism face bursts at the face, a speck is thrown, the chime is logged', async () => {
    const { page, errors, context } = await openApp('phone', '?test=1&seed=test&reset=1&intro=0&script=1')
    await page.waitForTimeout(1500)
    await page.mouse.click(30, 300) // unlock sound
    await page.waitForTimeout(900)
    const b0 = (await fx(page)).dbg
    await page.evaluate(() => {
      const s = window.__navi.get()
      const id = s.deck.cards.find(c => c.songId)?.songId
      s.faceEvent(id, 'sungAllKnow')
    })
    await page.waitForTimeout(450)
    const b1 = (await fx(page)).dbg
    assert.ok(b1.bursts > b0.bursts, 'prism burst fired')
    const log = await page.evaluate(() => window.__navi.soundLog)
    assert.ok(log.includes('faceChime'), `faceChime logged: ${log}`)
    noErrors(errors, 'bursts')
    await context.close()
  })

  await step('D-4: the specks follow the mirror faces (12 + min(48, mirror + prism)), each level-up throws one', async () => {
    const { page, errors, context } = await openApp('phone', '?test=1&seed=test&reset=1&intro=0&script=1')
    await page.waitForTimeout(1200)
    await page.evaluate(() => window.__fx.forceTier(2))
    await page.waitForTimeout(300)
    assert.equal((await fx(page)).dbg.specks, 12)
    await page.evaluate(() => {
      const s = window.__navi.get()
      const ids = ['marigold', 'lemon', 'gurenge', 'zankoku', 'idol', 'pretender', 'plastic-love', 'yoru-ni-kakeru', 'first-love', 'kick-back']
      ids.forEach(id => s.faceEvent(id, 'sung'))
    })
    await page.waitForTimeout(1500)
    const r = await fx(page)
    assert.equal(r.st.specksTarget, 22, 'target 12 + 10 mirror faces')
    assert.equal(r.dbg.specks, 22, `living specks ${r.dbg.specks}`)
    // tier caps: tier 0 shows at most 20
    await page.evaluate(() => window.__fx.forceTier(0))
    await page.waitForTimeout(1200)
    assert.ok((await fx(page)).dbg.specks <= 20, 'tier 0 caps the specks at 20')
    noErrors(errors, 'specks')
    await context.close()
  })

  await step('bus → sounds and light: reserve throws and lands, orders clink (a repeat only tocks), all-know chords and turns the wall gold, a redeal plays the stair', async () => {
    const { page, errors, context } = await openApp('phone', '?test=1&seed=test&reset=1&intro=0&script=1')
    await page.waitForTimeout(1200)
    await page.mouse.click(30, 300) // the lights come on, sound unlocks
    await page.waitForTimeout(600)
    const log = () => page.evaluate(() => [...window.__navi.soundLog])
    const b0 = (await fx(page)).dbg.bursts
    await page.click('[data-testid=btn-primary]')
    await page.waitForTimeout(1500)
    let l = await log()
    for (const n of ['throw', 'land', 'faceChime']) assert.ok(l.includes(n), `${n} after a reserve: ${l}`)
    assert.ok((await fx(page)).dbg.bursts > b0, 'spark12 at the lane slot')
    await page.evaluate(() => window.__navi.get().placeOrder('m1-test-drink'))
    await page.waitForTimeout(1300)
    await page.evaluate(() => window.__navi.get().placeOrder('m1-test-drink'))
    await page.waitForTimeout(300)
    l = await log()
    assert.equal(l.filter(n => n === 'clink').length, 1, `one clink for one accepted order: ${l}`)
    assert.ok(l.includes('softTock'), 'the repeated order only tocks')
    await page.evaluate(() => {
      const s = window.__navi.get()
      s.askRoom('lemon', 'me')
      for (const m of Object.values(window.__navi.get().room.members)) if (m.present) window.__navi.get().answerKnow('lemon', m.id, 'know')
    })
    await page.waitForTimeout(120)
    assert.ok((await fx(page)).st.gold > 0.3, 'the wall flushes gold when everyone knows')
    await page.waitForTimeout(1500)
    assert.equal((await fx(page)).st.gold, 0, 'gold melts back within 0.8 s')
    l = await log()
    assert.ok(l.includes('knowChord') && l.includes('knowTick'), `ticks and the chord: ${l}`)
    const before = l.filter(n => n === 'redeal').length
    await page.evaluate(() => {
      const s = window.__navi.get()
      s.dealCards(s.deck.cards, 'replace', { key: 'cause.mixed' })
    })
    await page.waitForTimeout(600)
    l = await log()
    assert.equal(l.filter(n => n === 'redeal').length, before + 1, 'a redeal plays once')
    noErrors(errors, 'sounds')
    await context.close()
  })

  await step('bursts: every preset fires on its canvas, which sleeps (hidden, off the ticker) when the last particle fades', async () => {
    const { page, errors, context } = await openApp('phone', '?test=1&seed=test&reset=1&intro=0&script=1')
    await page.waitForTimeout(1200)
    const vis = () => page.evaluate(() => getComputedStyle(document.querySelector('[data-shell=phone] .fx-burst')).visibility)
    assert.equal(await vis(), 'hidden', 'asleep before any burst')
    const b0 = (await fx(page)).dbg.bursts
    for (const p of ['spark12', 'prism', 'pin', 'stamp', 'area']) await page.evaluate(p => window.__fx.burst(p, { x: 195, y: 250 }), p)
    await page.waitForTimeout(80)
    const mid = await fx(page)
    assert.equal(mid.dbg.bursts - b0, 5)
    assert.ok(mid.dbg.particles > 40, `particles in flight (${mid.dbg.particles})`)
    assert.equal(await vis(), 'visible')
    await page.waitForTimeout(2200)
    assert.equal((await fx(page)).dbg.particles, 0)
    assert.equal(await vis(), 'hidden', 'asleep again')
    noErrors(errors, 'bursts')
    await context.close()
  })

  await step('an overlay (standby) hides the phone wall: its canvases stop painting and resume when it closes', async () => {
    const { page, errors, context } = await openApp('phone', '?test=1&seed=test&reset=1&intro=0&script=1')
    await page.waitForTimeout(1200)
    const frames = () => page.evaluate(() => ({ ...window.__fx.debug.frames }))
    await page.evaluate(() => window.__navi.get().setOverlay('standby'))
    await page.waitForTimeout(700)
    const a = await frames()
    await page.waitForTimeout(700)
    const b = await frames()
    assert.equal(b.bg - a.bg, 0, 'aurora paused under the overlay')
    assert.equal(b.specks - a.specks, 0, 'specks paused under the overlay')
    await page.evaluate(() => window.__navi.get().setOverlay(null))
    await page.waitForTimeout(600)
    const c = await frames()
    assert.ok(c.specks > b.specks && c.bg > b.bg, 'painting again')
    noErrors(errors, 'overlay')
    await context.close()
  })

  await step('I-5: mute is saved and still applies after a reload; ducking follows a roommate singing unless noDuck', async () => {
    const { page, errors, context } = await openApp('phone', '?test=1&seed=test&intro=0&script=1')
    await page.waitForSelector('[data-testid=mute-button]')
    await page.mouse.click(30, 300) // unlock
    await page.click('[data-testid=mute-button]')
    await page.waitForTimeout(500)
    assert.equal((await fx(page)).sound.muted, true)
    await page.reload()
    await page.waitForSelector('[data-testid=mute-button]')
    await page.waitForTimeout(400)
    assert.equal(await page.evaluate(() => window.__navi.get().session.muted), true, 'muted after reload')
    assert.equal((await fx(page)).sound.muted, true, 'synth muted after reload')
    await page.click('[data-testid=mute-button]')
    await page.waitForTimeout(200)
    assert.equal((await fx(page)).sound.muted, false)
    await page.evaluate(() => {
      const api = window.__navi.api
      api.getState().setNoDuck(false)
      const q = api.getState().room.queue[0]
      const item = { id: 'dx', songId: q?.songId ?? api.getState().deck.cards.find(c => c.songId).songId, by: 'minato', keyShift: 0, version: 'original', tags: [], addedAt: 0 }
      api.setState(s => ({ room: { ...s.room, now: { item, startedAt: s.session.simMs, durationMs: 40000 } } }))
    })
    assert.equal((await fx(page)).sound.ducked, true, 'ducked while Minato sings')
    await page.evaluate(() => window.__navi.get().setNoDuck(true))
    assert.equal((await fx(page)).sound.ducked, false, 'no ducking with noDuck (presenter)')
    noErrors(errors, 'mute')
    await context.close()
  })

  await step('T15: reduced motion pins tier 0 — static aurora, standing specks', async () => {
    const context = await browser.newContext({ ...VIEWPORTS.phone, locale: 'ja-JP', reducedMotion: 'reduce' })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto(new URL('?test=1&seed=test&reset=1', url).href)
    await page.waitForTimeout(1500)
    assert.equal(await page.getAttribute('[data-testid=app-root]', 'data-reduced'), '1')
    assert.equal(await page.getAttribute('[data-testid=app-root]', 'data-quality'), '0')
    const r = await fx(page)
    assert.equal(r.dbg.bgMode, 'static', 'CSS gradient instead of the canvas')
    assert.equal(r.st.quality, 0)
    const f0 = r.dbg.frames.specks
    await page.waitForTimeout(1000)
    const f1 = (await fx(page)).dbg.frames.specks
    assert.ok(f1 - f0 <= 4, `specks stand still (repaints ${f1 - f0} in 1 s)`)
    noErrors(errors, 'reduced')
    await context.close()
  })

  await step('T15 (fx share): CPU ×4 — the governor settles on a tier ≥ 1 and the frame median < 20 ms', async () => {
    const { page, errors, context } = await openApp('phone', '?test=1&seed=test&reset=1&script=1')
    // isolate this module's cost from the start: the ball canvases are M2's (own 4 ms budget)
    await page.addStyleTag({ content: '[data-testid=ball-canvas], [data-testid=ball-canvas-mini] { display: none !important }' })
    await page.waitForTimeout(3300) // the entrance is over: measure the steady home screen
    const cdp = await context.newCDPSession(page)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
    await page.waitForTimeout(4000)
    // one-second windows until it has settled (other processes on the machine steal the CPU in
    // bursts, so the best of several windows is the steady state)
    const windows = []
    for (let k = 0; k < 8; k++) {
      const w = await page.evaluate(
        () =>
          new Promise(res => {
            const ts = []
            const f = t => {
              ts.push(t)
              if (ts.length < 60) requestAnimationFrame(f)
              else {
                const d = ts
                  .slice(1)
                  .map((x, i) => x - ts[i])
                  .sort((a, b) => a - b)
                res({ median: d[d.length >> 1], tier: window.__fx.tier() })
              }
            }
            requestAnimationFrame(f)
          }),
      )
      windows.push(w)
      if (w.tier >= 1 && w.median < 20) break
    }
    const gov = await page.evaluate(() => window.__fx.govLog())
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
    const ok = windows.find(w => w.tier >= 1 && w.median < 20)
    console.log(`      (CPU×4: ${windows.map(w => `${w.median.toFixed(1)}ms@t${w.tier}`).join(' ')}; governor ${gov.map(e => `${e.from}>${e.to}:${e.why}`).join(' ') || 'kept tier 2'})`)
    assert.ok(ok, `settled on tier ≥ 1 with a median < 20 ms: ${JSON.stringify(windows)}`)
    noErrors(errors, 'perf')
    await context.close()
  })

  await step('room + dual: the room wall has its own aurora and specks; bursts land inside the scaled phone frame', async () => {
    const { page, errors, context } = await openApp('dual', '?test=1&seed=test&reset=1&view=dual')
    await page.waitForTimeout(3300)
    const n = await page.evaluate(() => ({ bg: document.querySelectorAll('.fx-bg').length, specks: document.querySelectorAll('.fx-specks').length, burst: document.querySelectorAll('.fx-burst').length }))
    assert.equal(n.bg, 2, 'phone + room aurora')
    assert.equal(n.specks, 2, 'phone + room specks')
    assert.equal(n.burst, 1, 'one burst layer (phone)')
    const room = await page.evaluate(() => {
      const el = document.querySelector('[data-shell=room] .fx-horizon')
      const ball = document.querySelector('[data-shell=room] .rs-ball').getBoundingClientRect()
      return { hz: el.getBoundingClientRect().top, ballBottom: ball.bottom }
    })
    assert.ok(Math.abs(room.hz - room.ballBottom) < 40, `room floor just under the ball (${room.hz} vs ${room.ballBottom})`)
    const sw = await page.evaluate(() => document.documentElement.scrollWidth)
    assert.ok(sw <= 1366, 'no horizontal scroll')
    noErrors(errors, 'dual')
    await context.close()
  })

  await step('small (360×740): the wall fits the smaller hero, no horizontal scroll, no errors', async () => {
    const { page, errors, context } = await openApp('small')
    await page.waitForTimeout(3300)
    const r = await fx(page)
    assert.ok(r.dbg.frames.bg > 5 && r.dbg.specks >= 12)
    const geo = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, hz: document.querySelector('[data-shell=phone] .fx-horizon').getBoundingClientRect().top, floor: document.querySelector('.hero__floor')?.getBoundingClientRect().top }))
    assert.ok(geo.sw <= 360, `scrollWidth ${geo.sw}`)
    if (geo.floor != null) assert.ok(Math.abs(geo.hz - geo.floor) < 4, `horizon on the floor line (${geo.hz} vs ${geo.floor})`)
    noErrors(errors, 'small')
    await context.close()
  })

  await step('tablet (room view) renders the room aurora without errors', async () => {
    const { page, errors, context } = await openApp('tablet')
    await page.waitForTimeout(2500)
    const r = await fx(page)
    assert.ok(r.dbg.frames.bg > 5)
    noErrors(errors, 'tablet')
    await context.close()
  })
}
