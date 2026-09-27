// M7 voice acceptance (SPEC L/M7 1–5, T09, I-4 #6, C-8 (5)).
//   · T09: getUserMedia rejects → the quiz takes over by itself (no error sound) → 3 answers → a
//     reading of one of the four types → "−n reserve" puts a negative data-key on my lane item
//   · a missing mic API falls back as soon as the sheet opens
//   · the harness fake mic reads a hum (method=mic); tracks are stopped, nothing is recorded
//   · the reveal: pillar notes, the orb pop, "今回の声は{type}", the stamp on tonight
//   · the card after a reading: key-attached primary, face key mark, you take the voice colour
//   · reduced motion shows the result at once; other languages say "this time" too
export const name = 'voice'

const Q = '?test=1&seed=test&reset=1&intro=0&script=1'
const TYPES = ['clear', 'power', 'groove', 'emotional']

export async function run({ browser, url, openApp, assert, step, VIEWPORTS }) {
  const opened = []
  const track = c => (opened.push(c), c)
  const stepC = (label, fn) =>
    step(label, async () => {
      try {
        await fn()
      } finally {
        while (opened.length) await opened.pop().close().catch(() => {})
      }
    })
  const open = async (...a) => {
    const r = await openApp(...a)
    opened.push(r.context)
    return r
  }
  const S = (page, fn, arg) => page.evaluate(fn, arg)
  const waitFor = async (page, fn, ms = 6000, arg) => {
    const t0 = Date.now()
    while (Date.now() - t0 < ms) {
      if (await page.evaluate(fn, arg).catch(() => false)) return true
      await page.waitForTimeout(80)
    }
    return false
  }
  const noErrors = (errors, where) => assert.deepEqual(errors, [], `${where}: console/page errors\n${errors.join('\n')}`)

  /** A context with an init script (the harness opens pages before scripts could be added). */
  const openWith = async (init, kind = 'phone', query = Q, extra = {}) => {
    const context = track(await browser.newContext({ ...VIEWPORTS[kind], locale: 'ja-JP', permissions: ['microphone'], ...extra }))
    if (init) await context.addInitScript(init)
    const page = await context.newPage()
    const errors = []
    page.on('console', m => {
      if (m.type() === 'error') errors.push(`console: ${m.text()}`)
    })
    page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
    await page.goto(new URL(query, url).href)
    return { context, page, errors }
  }

  /** Script mode: my turn → my song ends → the voice card is on top (C-3). */
  const toVoiceCard = async page => {
    await page.waitForSelector('[data-shell=phone] [data-testid=card-top]', { timeout: 8000 })
    await page.mouse.click(30, 300) // the first tap switches the lights (and the sounds) on
    await page.waitForTimeout(250)
    await S(page, () => window.__navi.fire({ t: 'step', id: 'my-turn' }))
    assert.ok(await waitFor(page, () => window.__navi.get().room.now?.item.by === 'me'), 'my song is NOW')
    await S(page, () => window.__navi.fire({ t: 'step', id: 'my-song-end' }))
    assert.ok(await waitFor(page, () => window.__navi.get().deck.cards[0]?.kind === 'voice'), 'the voice card is inserted on top')
    await page.waitForSelector('[data-shell=phone] [data-testid=card-top][data-kind=voice]', { timeout: 4000 })
    await page.waitForTimeout(500)
  }
  const openFromPrimary = async page => {
    const primary = page.locator('[data-shell=phone] [data-testid=btn-primary]')
    assert.match(await primary.textContent(), /声を見る/)
    await primary.click()
    await page.waitForSelector('[data-testid=sheet][data-sheet=voice]', { timeout: 4000 })
  }
  const answer = async (page, answers) => {
    for (const [q, a] of answers) {
      const sel = `[data-testid=voice-q][data-q=${q}] [data-a=${a}]`
      await page.waitForSelector(sel, { timeout: 4000 })
      await page.click(sel)
    }
  }
  const resultType = page => page.locator('[data-testid=voice-result]').getAttribute('data-type')

  // ---------------------------------------------------------------- T09 fallback
  await stepC('T09: a refused mic hands over to the 3 questions by itself; −n reserve lands in the lane', async () => {
    const { page, errors } = await openWith(() => {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'))
    })
    await toVoiceCard(page)
    const card = page.locator('[data-shell=phone] [data-testid=card-top][data-kind=voice]')
    assert.match(await card.textContent(), /今夜の声を見てみる？/)
    assert.match(await card.textContent(), /録音は保存しません/)
    assert.equal(await card.locator('[data-testid=voice-card-mic]').count(), 1, 'the hum path on the card')
    assert.equal(await card.locator('[data-testid=voice-card-quiz]').count(), 1, 'the quiz path on the card')
    await openFromPrimary(page)
    const logBefore = (await S(page, () => window.__navi.soundLog.length)) | 0
    await page.click('[data-testid=voice-mic-start]')
    await page.waitForSelector('[data-testid=voice-fallback]', { timeout: 4000 })
    assert.match(await page.locator('[data-testid=voice-fallback]').textContent(), /マイクが使えないので、3つの質問で見てみましょう/)
    assert.equal(await page.locator('[data-testid=voice-q]').getAttribute('data-q'), 'high', 'the quiz starts at once')
    const after = await S(page, n => window.__navi.soundLog.slice(n), logBefore)
    assert.ok(!after.some(n => /error|softTock|pass/.test(n)), `no error sound (${after.join(',')})`)
    // three answers (each lifts its pillar with a note)
    await answer(page, [
      ['high', 'hard'],
      ['chorus', 'between'],
      ['style', 'talk'],
    ])
    await page.waitForSelector('[data-testid=voice-result]', { timeout: 4000 })
    const type = await resultType(page)
    assert.ok(TYPES.includes(type), `a reading of one of the four types (${type})`)
    assert.equal(await page.locator('[data-testid=voice-result]').getAttribute('data-method'), 'quiz')
    const st = await S(page, () => {
      const s = window.__navi.get()
      return { n: s.col.voices.length, v: s.col.voices.at(-1), me: s.room.members.me.voiceType }
    })
    assert.equal(st.n, 1, 'recordVoice once')
    assert.equal(st.v.type, type)
    assert.equal(st.me, type, 'setMemberVoice(me)')
    // the key line and the key-attached reserve
    const btn = page.locator('[data-testid=voice-reserve-key]')
    await btn.waitFor({ state: 'visible', timeout: 5000 })
    const key = Number(await btn.getAttribute('data-key'))
    assert.ok(key < 0, `a lowered key is suggested (${key})`)
    assert.equal(key, st.v.suggest.keyShift)
    assert.match(await btn.textContent(), new RegExp(`−${-key}で予約`))
    assert.match(await page.locator('[data-testid=sheet][data-sheet=voice]').textContent(), new RegExp(`キーを${-key}下げると歌いやすい可能性があります`))
    await btn.click()
    const lane = page.locator(`[data-shell=phone] [data-testid=lane-item][data-song-id="${st.v.suggest.songId}"]`)
    await lane.first().waitFor({ state: 'attached', timeout: 3000 })
    assert.equal(Number(await lane.first().getAttribute('data-key')), key, 'lane-item[data-key] carries the key')
    assert.equal(await lane.first().getAttribute('data-by'), 'me')
    const face = await S(page, id => window.__navi.get().col.faces[id], st.v.suggest.songId)
    assert.ok(face && face.marks.includes('key') && face.keyShift === key, `the face gets the key mark ${JSON.stringify(face)}`)
    assert.ok(await waitFor(page, () => !window.__navi.get().ui.sheet), 'the sheet closes after reserving')
    assert.equal(await S(page, () => window.__navi.get().metrics.voiceToReserve), 1, 'voice → reserve is counted')
    assert.equal(await S(page, () => window.__navi.get().deck.cards.some(c => c.kind === 'voice')), false, 'the voice card is done')
    noErrors(errors, 'T09 fallback')
  })

  await stepC('a missing mic API: the sheet opens straight into the 3 questions', async () => {
    const { page, errors } = await openWith(() => {
      try {
        Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true })
      } catch {}
    })
    await toVoiceCard(page)
    await openFromPrimary(page)
    await page.waitForSelector('[data-testid=voice-fallback]', { timeout: 3000 })
    await page.waitForSelector('[data-testid=voice-q][data-q=high]', { timeout: 3000 })
    noErrors(errors, 'no mic API')
  })

  // ---------------------------------------------------------------- the mic path
  await stepC('T09 (mic): the harness fake mic reads a hum from voice-mic-start; the stream is stopped, nothing recorded', async () => {
    const { page, errors } = await openWith(() => {
      window.__mic = { streams: [], recorder: 0 }
      const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
      navigator.mediaDevices.getUserMedia = async c => {
        const s = await real(c)
        window.__mic.streams.push(s)
        return s
      }
      const MR = window.MediaRecorder
      window.MediaRecorder = function (...a) {
        window.__mic.recorder++
        return new MR(...a)
      }
    })
    await toVoiceCard(page)
    await openFromPrimary(page)
    await page.click('[data-testid=voice-mic-start]')
    await page.waitForSelector('[data-testid=voice-mic]', { timeout: 3000 })
    assert.ok(await page.locator('[data-testid=voice-mic] canvas').isVisible(), 'the live pitch trail canvas')
    await page.waitForSelector('[data-testid=voice-result]', { timeout: 9000 })
    assert.equal(await page.locator('[data-testid=voice-result]').getAttribute('data-method'), 'mic')
    assert.ok(TYPES.includes(await resultType(page)))
    const mic = await S(page, () => ({ n: window.__mic.streams.length, live: window.__mic.streams.flatMap(s => s.getTracks()).filter(t => t.readyState !== 'ended').length, rec: window.__mic.recorder }))
    assert.equal(mic.n, 1, 'one capture')
    assert.equal(mic.live, 0, 'every track is stopped after 3 seconds')
    assert.equal(mic.rec, 0, 'MediaRecorder is never used')
    const v = await S(page, () => window.__navi.get().col.voices.at(-1))
    assert.equal(v.method, 'mic')
    assert.deepEqual(Object.keys(v).sort(), ['at', 'brightness', 'care', 'evidence', 'groove', 'method', 'nightId', 'power', 'range', 'suggest', 'type'], 'only numbers are kept')
    noErrors(errors, 'fake mic')
  })

  // ---------------------------------------------------------------- the reveal (I-4 #6) and the card after
  await stepC('reveal: pillars rise with notes, fuse into the orb, "今回の声は…" types out, tonight is stamped; the card turns into a key-attached reserve', async () => {
    const { page, errors } = await open('phone', Q)
    await toVoiceCard(page)
    // the in-card quiz button opens the sheet straight at the first question
    await page.click('[data-shell=phone] [data-testid=voice-card-quiz]')
    await page.waitForSelector('[data-testid=voice-q][data-q=high]', { timeout: 4000 })
    assert.equal(await page.locator('[data-testid=voice-fallback]').count(), 0, 'no fallback note when the quiz was chosen')
    const n0 = await S(page, () => window.__navi.soundLog.length)
    await answer(page, [
      ['high', 'easy'],
      ['chorus', 'soft'],
      ['style', 'sustain'],
    ])
    await page.waitForSelector('[data-testid=voice-result]', { timeout: 4000 })
    assert.equal(await resultType(page), 'clear')
    await page.locator('[data-testid=voice-reserve-key]').waitFor({ state: 'visible', timeout: 6000 })
    assert.ok(await waitFor(page, () => document.querySelector('[data-testid=voice-stamp]')?.getAttribute('data-stamped') === '1', 4000), 'the orb stamps tonight')
    const log = await S(page, n => window.__navi.soundLog.slice(n), n0)
    const pillars = log.filter(x => x === 'pillar').length
    assert.ok(pillars >= 6, `a note per answer and per rising pillar (${log.join(',')})`)
    const pop = log.lastIndexOf('orbPop')
    assert.ok(pop > log.lastIndexOf('pillar'), `the orb pops after the pillars (${log.join(',')})`)
    assert.ok(log.indexOf('stamp', pop) > pop, 'then the stamp')
    const text = await page.locator('[data-testid=voice-result]').textContent()
    assert.match(text, /今回の声は/)
    assert.match(text, /クリア/)
    assert.doesNotMatch(text, /あなたは|タイプ|上手|下手|性格|年齢|性別/)
    assert.match(text, /この声で歌ってみたい1曲/)
    assert.match(text, /声は曲や日によって変わります/)
    // close: the card shows tonight's voice and a key-attached primary
    await page.click('.sheet__close')
    assert.ok(await waitFor(page, () => !window.__navi.get().ui.sheet))
    const v = await S(page, () => window.__navi.get().col.voices.at(-1))
    const res = page.locator('[data-shell=phone] [data-testid=card-top][data-kind=voice] [data-testid=voice-card-result]')
    await res.waitFor({ state: 'visible', timeout: 3000 })
    assert.equal(await res.getAttribute('data-type'), 'clear')
    assert.match(await res.textContent(), /今回の声は/)
    const primary = page.locator('[data-shell=phone] [data-testid=btn-primary]')
    assert.ok(await waitFor(page, () => /で予約/.test(document.querySelector('[data-shell=phone] [data-testid=btn-primary]')?.textContent || '')), 'the primary becomes a key-attached reserve')
    const label = await primary.textContent()
    if (v.suggest.keyShift !== 0) assert.match(label, new RegExp(`${v.suggest.keyShift < 0 ? '−' : '\\+'}${Math.abs(v.suggest.keyShift)}で予約`))
    // "you" takes tonight's colour on the floor
    assert.equal(await S(page, () => window.__navi.get().room.members.me.voiceType), 'clear')
    await primary.click()
    assert.ok(await waitFor(page, id => window.__navi.get().room.queue.some(q => q.songId === id && q.by === 'me'), 4000, v.suggest.songId), 'reserved from the card')
    const item = await S(page, id => window.__navi.get().room.queue.find(q => q.songId === id), v.suggest.songId)
    assert.equal(item.keyShift, v.suggest.keyShift, 'with the suggested key')
    noErrors(errors, 'reveal')
  })

  await stepC('the voice card keeps the suggested song on a right flick once there is a reading', async () => {
    const { page, errors } = await open('phone', Q)
    await toVoiceCard(page)
    // before a reading there is nothing to keep: the card wobbles and stays
    await page.click('[data-shell=phone] [data-testid=btn-keep]')
    await page.waitForTimeout(500)
    assert.equal(await S(page, () => window.__navi.get().deck.cards[0]?.kind), 'voice')
    await page.click('[data-shell=phone] [data-testid=voice-card-quiz]')
    await answer(page, [
      ['high', 'normal'],
      ['chorus', 'between'],
      ['style', 'ride'],
    ])
    await page.waitForSelector('[data-testid=voice-result][data-type=groove]', { timeout: 4000 })
    await page.click('.sheet__close')
    assert.ok(await waitFor(page, () => !window.__navi.get().ui.sheet))
    await page.waitForTimeout(400)
    const id = await S(page, () => window.__navi.get().col.voices.at(-1).suggest.songId)
    await page.click('[data-shell=phone] [data-testid=btn-keep]')
    assert.ok(await waitFor(page, sid => window.__navi.get().col.faces[sid]?.state === 'sketch', 4000, id), 'the suggested song becomes a sketch face')
    noErrors(errors, 'keep')
  })

  // ---------------------------------------------------------------- reduced motion, other languages, 360 wide
  await stepC('reduced motion: the result is there at once; small phone has no horizontal scroll', async () => {
    const { page, errors } = await openWith(null, 'small', Q, { reducedMotion: 'reduce' })
    await toVoiceCard(page)
    await page.click('[data-shell=phone] [data-testid=voice-card-quiz]')
    await answer(page, [
      ['high', 'hard'],
      ['chorus', 'between'],
      ['style', 'talk'],
    ])
    await page.waitForSelector('[data-testid=voice-result][data-type=emotional]', { timeout: 3000 })
    await page.locator('[data-testid=voice-reserve-key]').waitFor({ state: 'visible', timeout: 900 })
    assert.equal(await page.locator('[data-testid=voice-stamp]').getAttribute('data-stamped'), '1')
    const w = await S(page, () => document.documentElement.scrollWidth)
    assert.ok(w <= 360, `no horizontal scroll (${w})`)
    noErrors(errors, 'reduced')
  })

  await stepC('other languages: the reading always says "this time"', async () => {
    for (const [locale, re, none] of [
      ['ko', /이번 목소리는/, /당신은/],
      ['en', /This time, the voice was/, /you are/i],
      ['zhHant', /這次的聲音是/, /你是/],
    ]) {
      const { page, errors } = await open('phone', `${Q}&locale=${locale}`)
      await toVoiceCard(page)
      await page.click('[data-shell=phone] [data-testid=voice-card-quiz]')
      await answer(page, [
        ['high', 'easy'],
        ['chorus', 'belt'],
        ['style', 'sustain'],
      ])
      await page.waitForSelector('[data-testid=voice-result][data-type=power]', { timeout: 4000 })
      await page.locator('[data-testid=voice-reserve-key]').waitFor({ state: 'visible', timeout: 6000 })
      const text = await page.locator('[data-testid=sheet][data-sheet=voice]').textContent()
      assert.match(text, re, `${locale}: ${text.slice(0, 200)}`)
      assert.doesNotMatch(text, none)
      assert.doesNotMatch(text, /\bvoice\.[a-z]/, `${locale}: no raw keys`)
      noErrors(errors, `locale ${locale}`)
      await page.context().close()
    }
  })

  await stepC('the shared room screen never shows the voice sheet or card', async () => {
    const { page, errors } = await open('dual', `${Q}&view=dual`)
    await page.waitForTimeout(1200)
    await S(page, () => window.__navi.fire({ t: 'step', id: 'my-turn' }))
    await page.waitForTimeout(300)
    await S(page, () => window.__navi.fire({ t: 'step', id: 'my-song-end' }))
    assert.ok(await waitFor(page, () => window.__navi.get().deck.cards[0]?.kind === 'voice'))
    await S(page, () => window.__navi.get().openSheet('voice'))
    await page.waitForTimeout(600)
    assert.equal(await page.locator('[data-shell=room] [data-testid=sheet][data-sheet=voice]').count(), 0, 'no voice sheet in the room pane')
    assert.equal(await page.locator('[data-shell=room] .vc, [data-shell=room] .vs').count(), 0, 'no voice card or sheet content in the room pane')
    noErrors(errors, 'dual')
  })
}
