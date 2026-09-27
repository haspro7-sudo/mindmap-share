// M9 record-wrap acceptance (SPEC L/M9 1–5; the M9 parts of T04, T12, T13, T14).
export const name = 'record'

const Q = '?test=1&seed=test&reset=1&intro=0&script=1'

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
        while (opened.length)
          await opened
            .pop()
            .close()
            .catch(() => {})
      }
    })
  const noErrors = (errors, where) => assert.deepEqual(errors, [], `${where}: console/page errors\n${errors.join('\n')}`)
  const S = (page, fn, arg) => page.evaluate(fn, arg)
  const fire = (page, cmd) => page.evaluate(c => window.__navi.fire(c), cmd)
  const waitFor = async (page, fn, arg, ms = 5000) => {
    const t0 = Date.now()
    while (Date.now() - t0 < ms) {
      if (await page.evaluate(fn, arg)) return true
      await page.waitForTimeout(80)
    }
    return false
  }
  const sounds = page => S(page, () => [...(window.__navi.soundLog ?? [])])
  const BANNED = /連続|残り\s*\d+\s*枚|期間限定|今だけ/

  /** A small real night: 3 keeps and a navi reserve through the card actions, I sing it,
   *  two roommates sing, everyone knows one song; optionally demo nights, a voice and a save. */
  async function playNight(page, { seedNights = true, voice = true, tap = true } = {}) {
    await page.waitForSelector('[data-testid=app-root]')
    await page.waitForTimeout(700)
    if (tap) await page.mouse.click(30, 420) // first tap: lights on, audio unlocked
    // reserve the opener (navi tag), then keep three song-bearing cards, one at a time
    const reserved = await S(page, () => {
      const s = window.__navi.get()
      const c = s.deck.cards.find(x => x.songId && x.kind === 'song') ?? s.deck.cards.find(x => x.songId)
      s.act(c.id, 'reserve', { songId: c.songId, navi: true })
      return c.songId
    })
    for (let k = 0; k < 3; k++) {
      await page.waitForTimeout(160)
      await S(page, () => {
        const s = window.__navi.get()
        const c = s.deck.cards.find(x => (x.kind === 'song' || x.kind === 'ask' || x.kind === 'link' || x.kind === 'voice') && (x.songId || x.options?.length))
        if (c) s.act(c.id, 'keep', { songId: c.kind === 'link' ? c.options?.[0] : (c.songId ?? c.options?.[0]) })
      })
    }
    await fire(page, { t: 'myTurn' })
    await page.waitForTimeout(150)
    await S(
      page,
      id => {
        const s = () => window.__navi.get()
        s().askRoom(id, 'me')
        for (const m of ['me', 'minato', 'saki']) s().answerKnow(id, m, 'know')
      },
      reserved,
    )
    await fire(page, { t: 'finishMine' })
    await page.waitForTimeout(200)
    await S(page, () => {
      const s = () => window.__navi.get()
      for (const [id, by] of [
        ['gurenge', 'minato'],
        ['lemon', 'saki'],
      ]) {
        if (s().room.now) s().finishNow()
        s().reserve(id, { by })
        s().startNext()
        s().finishNow()
      }
      // a song the whole room knows (asked tonight)
      s().askRoom('yoru-ni-kakeru', 'me')
      for (const m of ['me', 'minato', 'saki']) s().answerKnow('yoru-ni-kakeru', m, 'know')
    })
    if (seedNights) await fire(page, { t: 'seedNights', n: 2 })
    if (voice)
      await S(page, () => {
        const s = window.__navi.get()
        s.recordVoice({
          nightId: s.session.nightId,
          at: Date.now(),
          type: 'emotional',
          power: 0.6,
          care: 0.4,
          brightness: 0.55,
          groove: 0.3,
          range: [55, 72],
          method: 'quiz',
          evidence: { key: 'voice.ev.dynamics' },
        })
        s.saveSong('hakujitsu', 'original', 'import')
      })
    await page.waitForTimeout(200)
    return reserved
  }
  const openRecord = async page => {
    await S(page, () => window.__navi.get().setTab('record'))
    await page.waitForSelector('[data-testid=record-screen]')
    await page.waitForTimeout(500)
  }

  // ---------------------------------------------------------------- M9 #1 + T04: the record tab
  await stepC('record tab: ball slot, faces by state = store, 10 pins with public conditions, calendar, nights (demo labelled), voice, My Songs', async () => {
    const { page, errors } = await open('phone', Q)
    const reserved = await playNight(page)
    await openRecord(page)
    const st = await S(page, () => {
      const f = Object.values(window.__navi.get().col.faces)
      const c = { sketch: 0, neon: 0, mirror: 0, prism: 0 }
      for (const x of f) c[x.state]++
      return { ...c, lit: f.length }
    })
    const stats = page.locator('[data-testid=record-stats]')
    for (const k of ['sketch', 'neon', 'mirror', 'prism', 'lit']) assert.equal(Number(await stats.getAttribute(`data-${k}`)), st[k], `record-stats ${k}`)
    const ball = page.locator('[data-testid=record-screen] [data-testid=ball-canvas][data-variant=record]')
    assert.equal(await ball.count(), 1, 'the big ball sits in the record tab')
    assert.equal(Number(await ball.getAttribute('data-lit-count')), st.lit)
    // T04: the face I sang is mirror (prism when everyone knew it), the spark pin is earned
    assert.ok(['mirror', 'prism'].includes(await S(page, id => window.__navi.get().col.faces[id].state, reserved)), 'sung face is mirror or prism')
    const pins = page.locator('[data-testid=pin]')
    assert.equal(await pins.count(), 10, 'all 10 pins are listed, earned or not')
    assert.equal(await page.locator('[data-testid=pin][data-id=spark]').getAttribute('data-earned'), '1')
    assert.equal(await page.locator('[data-testid=pin][data-id=hundred]').getAttribute('data-earned'), '0')
    assert.match(await page.locator('[data-testid=pin][data-id=hundred]').innerText(), /100点/, 'unearned pins show their condition')
    assert.equal(await page.locator('[data-testid=record-screen] [data-testid=stamp-cell][data-today="1"]').count(), 1, 'today is on the calendar')
    const nights = await S(page, () => window.__navi.get().col.nights.length)
    assert.equal(await page.locator('[data-testid=record-night]').count(), nights, 'every night has a page')
    const demo = page.locator('[data-testid=record-demo-badge]')
    assert.equal(await demo.count(), 2, 'seeded nights say so')
    assert.equal((await demo.first().innerText()).trim(), 'デモ用データ')
    const text = await page.locator('[data-testid=record-screen]').innerText()
    assert.match(text, /声は曲や日によって変わります/, 'voice log note')
    assert.match(text, /白日/, 'My Songs lists the saved song')
    assert.doesNotMatch(text, /刻印の見方/, 'the marks legend is behind ⓘ, not on the tab')
    assert.doesNotMatch(text, BANNED)
    assert.equal(await page.locator('[data-testid=record-screen]').getAttribute('data-private'), '1')
    assert.equal(await page.locator('[data-testid=record-screen]').getAttribute('data-anchor'), 'record')
    noErrors(errors, 'record tab')
  })

  // ---------------------------------------------------------------- QA OWNER#8: the collection as a toy
  await stepC('record tab is a toy: the ball fills ≥ 70 % of the first screen, one line, 4 chips light faces on the ball, ⓘ legend, pager, settings behind one row', async () => {
    const { page, errors } = await open('phone', Q)
    await playNight(page)
    await openRecord(page)
    // the ball's stage owns the first screen (between the compact lane and the dock)
    const geo = await S(page, () => {
      const sc = document.querySelector('.ps-tab--record')
      const st = document.querySelector('[data-testid=record-stage]').getBoundingClientRect()
      const r = sc.getBoundingClientRect()
      const top = r.top + parseFloat(getComputedStyle(sc).paddingTop)
      return { visible: r.bottom - top, stage: st.height, stageTop: st.top - top, ball: document.querySelector('[data-testid=record-stage] [data-testid=ball-canvas]').getBoundingClientRect().width }
    })
    assert.ok(geo.stage / geo.visible >= 0.69, `stage ${geo.stage}px of ${geo.visible}px`)
    assert.ok(geo.stageTop < 8, `the stage starts at the top (${geo.stageTop})`)
    assert.match(await page.locator('[data-testid=record-line]').innerText(), /\d+面が点灯/)
    // the four chips sit in the first screen and light one state on the ball (fxState.ballHighlight)
    const chips = page.locator('[data-testid=record-state-chip]')
    assert.equal(await chips.count(), 4)
    const chipBottom = await S(page, () => {
      const r = document.querySelector('[data-testid=record-stats]').getBoundingClientRect()
      return r.bottom <= document.querySelector('.ps-dock').getBoundingClientRect().top
    })
    assert.ok(chipBottom, 'chips visible without scrolling')
    const hl = () => S(page, () => window.__fx?.state().ballHighlight ?? null)
    await page.click('[data-testid=record-state-chip][data-state=neon]')
    assert.equal(await hl(), 'neon')
    assert.equal(await page.locator('[data-testid=record-screen]').getAttribute('data-sel'), 'neon')
    assert.ok(await waitFor(page, () => /ネオン[\s\S]*予約した/.test(document.querySelector('[data-testid=record-line]')?.innerText ?? ''), null, 1500), 'the line says what neon means')
    await page.click('[data-testid=record-state-chip][data-state=neon]')
    assert.equal(await hl(), null, 'tap again: all faces')
    await page.click('[data-testid=record-state-chip][data-state=mirror]')
    assert.equal(await hl(), 'mirror')
    // ⓘ: states, marks and the map live in a sheet
    await page.click('[data-testid=record-legend-open]')
    const legend = page.locator('[data-testid=sheet][data-sheet=legend]')
    await legend.waitFor()
    const lt = await legend.innerText()
    for (const w of ['面の状態', '刻印の見方', 'ボールの地図']) assert.ok(lt.includes(w), `legend shows ${w}`)
    await legend.locator('.sheet__close').click()
    await legend.waitFor({ state: 'detached' })
    // the pager: tonight's wall · calendar · pins
    const tabs = page.locator('[data-testid=record-pager-tab]')
    assert.deepEqual(await tabs.evaluateAll(els => els.map(e => e.dataset.page)), ['wall', 'cal', 'pins'])
    await tabs.nth(2).click()
    assert.ok(await waitFor(page, () => document.querySelector('[data-testid=record-pager]')?.dataset.page === 'pins', null, 2000), 'tab → pins page')
    const pinsIn = await waitFor(
      page,
      () => {
        const pg = document.querySelector('[data-testid=record-page][data-page=pins]').getBoundingClientRect()
        const tr = document.querySelector('.rc-pager__track').getBoundingClientRect()
        return pg.left >= tr.left - 1 && pg.right <= tr.right + 1
      },
      null,
      2000,
    )
    assert.ok(pinsIn, 'the pins page scrolled into view')
    // settings: one row, the panel in a sheet
    await page.locator('[data-testid=record-settings]').scrollIntoViewIfNeeded()
    await page.click('[data-testid=record-settings]')
    const set = page.locator('[data-testid=sheet][data-sheet=settings]')
    await set.waitFor()
    assert.equal(await set.locator('[data-testid=record-wipe]').count(), 1)
    // leaving the tab puts every face back
    await S(page, () => window.__navi.get().setTab('discover'))
    await page.waitForTimeout(600)
    assert.equal(await hl(), null, 'cleared on leave')
    noErrors(errors, 'toy')
  })

  await stepC('record tab: gap areas open a filtered search; clearing data asks first', async () => {
    const { page, errors } = await open('phone', Q)
    await playNight(page, { seedNights: false })
    await openRecord(page)
    const gap = page.locator('[data-testid=record-gap-open]').first()
    await gap.scrollIntoViewIfNeeded()
    await gap.click()
    await page.waitForSelector('[data-testid=sheet][data-sheet=search]')
    const filters = await S(page, () => window.__navi.get().ui.sheet?.arg?.filters)
    assert.ok(filters?.tempo && filters?.genre, `search opened with area filters ${JSON.stringify(filters)}`)
    await S(page, () => window.__navi.get().closeSheet())
    await page.waitForTimeout(400)
    const row = page.locator('[data-testid=record-settings]')
    await row.scrollIntoViewIfNeeded()
    await row.click()
    const wipe = page.locator('[data-testid=sheet][data-sheet=settings] [data-testid=record-wipe]')
    await wipe.waitFor()
    await wipe.click()
    await page.waitForTimeout(250)
    assert.ok((await S(page, () => Object.keys(window.__navi.get().col.faces).length)) > 0, 'nothing erased before confirming')
    await page.click('[data-testid=record-wipe-confirm]')
    await page.waitForTimeout(300)
    assert.equal(await S(page, () => Object.keys(window.__navi.get().col.faces).length), 0, 'erased after confirming')
    assert.equal(await page.locator('[data-testid=record-stats]').getAttribute('data-lit'), '0')
    noErrors(errors, 'gaps + wipe')
  })

  // ---------------------------------------------------------------- M9 #2: face detail
  await stepC('face detail: facts, marks, reserve again, polish a sleeping face (rub ×3), ask someone → request/sent', async () => {
    const { page, errors } = await open('phone', Q)
    await playNight(page)
    await openRecord(page)
    const sleepy = await S(page, () => Object.values(window.__navi.get().col.faces).find(f => f.sungCount > 0 && f.lastSungAt && Date.now() - f.lastSungAt > 60 * 864e5)?.songId)
    assert.ok(sleepy, 'demo nights include a sleeping face')
    await S(page, id => window.__navi.get().openSheet('face', { songId: id }), sleepy)
    const sheet = page.locator('[data-testid=face-detail]')
    await sheet.waitFor()
    await page.waitForTimeout(600)
    const txt = await sheet.innerText()
    for (const w of ['初めて貼った夜', '歌った回数', '推奨キー', 'この面の刻印', 'また予約', '誰かに歌ってほしい']) assert.ok(txt.includes(w), `face sheet shows ${w}`)
    // rub three times
    const pad = await page.locator('[data-testid=face-rub]').boundingBox()
    const cy = pad.y + pad.height / 2
    const cx = pad.x + pad.width / 2
    await page.mouse.move(cx - 70, cy)
    await page.mouse.down()
    for (let k = 0; k < 3; k++) {
      await page.mouse.move(cx + 70, cy, { steps: 6 })
      await page.mouse.move(cx - 70, cy, { steps: 6 })
    }
    await page.mouse.up()
    await page.waitForTimeout(200)
    assert.equal(await page.locator('[data-testid=face-polish]').getAttribute('data-rubs'), '3')
    assert.ok(await S(page, id => window.__navi.get().col.faces[id].polishedAt > 0, sleepy), 'polishFace stored')
    // reserve again → the lane gets it
    await page.click('[data-testid=face-reserve]')
    assert.ok(await waitFor(page, id => window.__navi.get().room.queue.some(q => q.songId === id && q.by === 'me'), sleepy, 1500), 'reserved from the face sheet')
    await page.locator('[data-testid=face-queued]').waitFor()
    // ask someone to sing another face
    await S(page, () => window.__navi.get().closeSheet())
    await page.waitForTimeout(350)
    const other = await S(page, () => Object.keys(window.__navi.get().col.faces).find(id => !window.__navi.get().room.queue.some(q => q.songId === id)))
    await S(page, id => window.__navi.get().openSheet('face', { songId: id }), other)
    await page.click('[data-testid=face-ask]')
    await page.click('[data-testid=face-ask-member][data-member=saki]')
    await page.locator('[data-testid=face-ask-sent]').waitFor()
    const ev = await S(page, () => window.__recordEvents)
    assert.deepEqual(ev.at(-1), { type: 'request/sent', to: 'saki', songId: other })
    assert.doesNotMatch(await page.locator('[data-testid=face-detail]').innerText(), /断|refus/i, 'never a refusal')
    noErrors(errors, 'face detail')
  })

  await stepC('night page: stamp, name, the wall drawn again, the melody replays, my songs only', async () => {
    const { page, errors } = await open('phone', Q)
    const reserved = await playNight(page, { seedNights: false })
    await openRecord(page)
    const row = page.locator('[data-testid=record-night]').first()
    await row.scrollIntoViewIfNeeded()
    await row.click()
    const sheet = page.locator('[data-testid=night-detail]')
    await sheet.waitFor()
    assert.ok(Number(await sheet.locator('[data-testid=wall-constellation]').getAttribute('data-points')) >= 3)
    assert.match(await sheet.innerText(), /座/)
    const mineList = (await sheet.innerText()).split('あなたが歌った曲')[1]?.split('この夜に貼った面')[0] ?? ''
    assert.ok(mineList.length > 0, 'my songs listed')
    assert.doesNotMatch(mineList, /紅蓮華|Lemon/, 'roommates’ songs are not in my list')
    void reserved
    const before = (await sounds(page)).filter(x => x === 'melody').length
    await page.click('[data-testid=night-melody-play]')
    await page.waitForTimeout(150)
    assert.equal((await sounds(page)).filter(x => x === 'melody').length, before + 1)
    noErrors(errors, 'night page')
  })

  // ---------------------------------------------------------------- M9 #3 + T13 (M9 part): the wrap
  await stepC('wrap: fanfare, five pages (tap or 4 s), melody on page 4 + replay, 600 ms stamp, equal buttons, save → survey', async () => {
    const { page, errors } = await open('phone', Q)
    await playNight(page, { seedNights: false })
    await fire(page, { t: 'exit' })
    const wrap = page.locator('[data-testid=wrap]')
    await wrap.waitFor()
    assert.equal(await wrap.getAttribute('data-anchor'), 'wrap')
    assert.ok((await sounds(page)).includes('fanfare'), 'fanfare opens the recap')
    const pageNo = () => page.locator('[data-testid=wrap-page]').last().getAttribute('data-page')
    assert.equal(await pageNo(), '1')
    // ball with tonight's faces
    assert.equal(await page.locator('[data-testid=wrap] [data-testid=ball-canvas][data-variant=wrap]').count(), 1)
    // 4 s auto-advance
    assert.ok(await waitFor(page, () => document.querySelector('[data-testid=wrap-page]')?.getAttribute('data-page') === '2', null, 5200), 'page 2 after ~4 s')
    await page.mouse.click(300, 420)
    assert.ok(await waitFor(page, () => document.querySelector('[data-testid=wrap-page]')?.getAttribute('data-page') === '3', null, 1500), 'tap → page 3')
    assert.match(await page.locator('[data-testid=wrap-page]').innerText(), /全員が知ってた曲/)
    assert.ok((await page.locator('[data-testid=wrap-common-song]').count()) >= 1, 'page 3 lists the songs everyone knew')
    // POLICY#5: the recap carries the concept-prototype label
    assert.equal((await page.locator('[data-testid=wrap-brand]').innerText()).trim(), '新ナビ（コンセプト試作）')
    await page.waitForTimeout(400)
    const melodyBefore = (await sounds(page)).filter(x => x === 'melody').length
    await page.mouse.click(300, 420)
    assert.ok(await waitFor(page, () => document.querySelector('[data-testid=wrap-page]')?.getAttribute('data-page') === '4', null, 1500), 'tap → page 4')
    assert.ok(await waitFor(page, n => window.__navi.soundLog.filter(x => x === 'melody').length > n, melodyBefore, 1600), 'tonight’s melody plays on page 4')
    const name = await page.locator('[data-testid=wrap-night-name]').innerText()
    assert.match(name.replace(/\s/g, ''), /^[日月火水木金土]曜の(瑠璃|菫|珊瑚|琥珀).+座$/, `night name ${name}`)
    assert.match((await S(page, () => window.__navi.get().col.nights.find(n => n.id === window.__navi.get().session.nightId).name?.key)) ?? '', /^record\.nn\./, 'nameNight stored a TextRef')
    await page.click('[data-testid=wrap-melody-play]')
    await page.waitForTimeout(120)
    assert.equal((await sounds(page)).filter(x => x === 'melody').length, melodyBefore + 2, 'the melody can be played again')
    await page.mouse.click(300, 420)
    assert.ok(await waitFor(page, () => document.querySelector('[data-testid=wrap-page]')?.getAttribute('data-page') === '5', null, 1500), 'tap → page 5')
    await page.waitForTimeout(500)
    assert.equal((await page.locator('.rw-p5__brand').innerText()).trim(), '新ナビ（コンセプト試作）', 'the stamp page carries the label too')
    // the stamp: a short press does nothing, a 700 ms hold stamps
    const cell = page.locator('[data-testid=wrap] [data-testid=stamp-cell][data-today="1"]')
    const box = await cell.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(300)
    await page.mouse.up()
    await page.waitForTimeout(150)
    assert.equal(await cell.getAttribute('data-stamped'), '0', 'a 300 ms press does not stamp')
    await page.mouse.down()
    await page.waitForTimeout(700)
    await page.mouse.up()
    await page.waitForTimeout(150)
    assert.equal(await cell.getAttribute('data-stamped'), '1', '700 ms hold stamps')
    assert.ok((await sounds(page)).includes('stamp'), 'stamp sound')
    assert.equal(await S(page, () => window.__navi.get().col.nights.find(n => n.id === window.__navi.get().session.nightId).stamped), true)
    // equal-width choices
    const w = await S(page, () => ['wrap-save', 'wrap-nosave'].map(id => document.querySelector(`[data-testid=${id}]`).getBoundingClientRect().width))
    assert.ok(Math.abs(w[0] - w[1]) <= 2, `buttons ${w.join(' vs ')}`)
    const wrapText = await wrap.innerText()
    assert.doesNotMatch(wrapText, BANNED)
    await page.click('[data-testid=wrap-save]')
    await page.waitForSelector('[data-testid=sheet][data-sheet=survey]')
    const after = await S(page, () => {
      const s = window.__navi.get()
      return { phase: s.session.phase, linked: s.session.linked, tab: s.ui.tab, overlay: s.ui.overlay, wrapSaved: s.col.saved.filter(x => x.from === 'wrap').length }
    })
    assert.deepEqual({ ...after, wrapSaved: after.wrapSaved > 0 }, { phase: 'closed', linked: true, tab: 'record', overlay: null, wrapSaved: true })
    // the optional five questions
    for (const q of ['findEase', 'surprise', 'fun', 'again']) await page.click(`[data-testid=survey-q][data-q=${q}] [data-v="4"]`)
    await page.click('[data-testid=survey-send]')
    await page.locator('[data-testid=survey-thanks]').waitFor()
    assert.deepEqual(await S(page, () => window.__navi.get().metrics.survey), { findEase: 4, surprise: 4, fun: 4, again: 4, why: [] })
    await page.waitForTimeout(1900)
    assert.match(await page.locator('[data-testid=record-screen]').innerText(), /またね/, 'the record tab says see you')
    noErrors(errors, 'wrap')
  })

  await stepC('wrap: tap left goes back, skip jumps to the stamp, "keep on this device" stays local', async () => {
    const { page, errors } = await open('phone', Q)
    await playNight(page, { seedNights: false, voice: false })
    await fire(page, { t: 'exit' })
    await page.locator('[data-testid=wrap]').waitFor()
    const cur = () => S(page, () => document.querySelector('[data-testid=wrap-page]')?.getAttribute('data-page'))
    await page.mouse.click(320, 420)
    assert.ok(await waitFor(page, () => document.querySelector('[data-testid=wrap-page]')?.getAttribute('data-page') === '2', null, 1500))
    await page.mouse.click(30, 420)
    assert.ok(await waitFor(page, () => document.querySelector('[data-testid=wrap-page]')?.getAttribute('data-page') === '1', null, 1500), `left tap goes back (${await cur()})`)
    await page.click('[data-testid=wrap-skip]')
    assert.ok(await waitFor(page, () => document.querySelector('[data-testid=wrap-page]')?.getAttribute('data-page') === '5', null, 1500), 'skip → stamp page')
    await page.click('[data-testid=wrap-nosave]')
    await page.waitForTimeout(400)
    const s = await S(page, () => ({ phase: window.__navi.get().session.phase, linked: window.__navi.get().session.linked, wrap: window.__navi.get().col.saved.filter(x => x.from === 'wrap').length }))
    assert.deepEqual(s, { phase: 'closed', linked: false, wrap: 0 })
    noErrors(errors, 'wrap nav')
  })

  await stepC('night names follow the language (Settings switches in place)', async () => {
    const { page, errors } = await open('phone', Q)
    await playNight(page, { seedNights: false, voice: false })
    await openRecord(page)
    const row = page.locator('[data-testid=record-night]').first()
    const ja = await row.locator('.rc-night__name').innerText()
    assert.match(ja, /座$/)
    await page.evaluate(() => (window.__marker = 1))
    await page.locator('[data-testid=record-settings]').scrollIntoViewIfNeeded()
    await page.click('[data-testid=record-settings]')
    const en = page.locator('.rc-set__lang', { hasText: 'English' })
    await en.waitFor()
    await en.click()
    await page.waitForTimeout(250)
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'en')
    assert.match(await row.locator('.rc-night__name').innerText(), /^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)'s (Lapis|Violet|Coral|Amber) /)
    await page.locator('.rc-set__lang', { hasText: '한국어' }).click()
    await page.waitForTimeout(250)
    assert.match(await row.locator('.rc-night__name').innerText(), /요일의 .+자리$/)
    assert.equal(await page.evaluate(() => window.__marker), 1, 'no reload')
    await page.locator('.rc-set__lang', { hasText: '日本語' }).click()
    noErrors(errors, 'names')
  })

  // ---------------------------------------------------------------- T12 (M9 part): the room screen shows the public wall only
  await stepC('room screen: the public wall of light, nothing private', async () => {
    const { page, errors } = await open('tablet', Q)
    await playNight(page, { seedNights: true, tap: false })
    await page.waitForTimeout(600)
    const wall = page.locator('[data-testid=room-sidebar] [data-testid=wall-constellation]')
    assert.equal(await wall.count(), 1)
    assert.ok(Number(await wall.getAttribute('data-points')) >= 3)
    assert.equal(await wall.getAttribute('data-private'), null)
    const priv = await S(
      page,
      () =>
        [...document.querySelectorAll('[data-private="1"]')].filter(e => {
          const r = e.getBoundingClientRect()
          return r.width > 0 && r.height > 0
        }).length,
    )
    assert.equal(priv, 0, 'no private element is visible on the room screen')
    assert.doesNotMatch(await page.locator('body').innerText(), /知らない|連続/)
    noErrors(errors, 'room')
  })

  // ---------------------------------------------------------------- QA DEMO#4: everyone knew it, then someone joined
  await stepC('wrap page 3 keeps an all-know moment after someone joins (night.allKnow), with its size', async () => {
    const { page, errors } = await open('phone', Q)
    await playNight(page, { seedNights: false, voice: false })
    const before = await S(page, () => window.__navi.get().col.nights.find(n => n.id === window.__navi.get().session.nightId).allKnow ?? [])
    assert.ok(
      before.some(a => a.songId === 'yoru-ni-kakeru' && a.size === 3),
      `core remembered the moment ${JSON.stringify(before)}`,
    )
    // Jun joins and has not answered: "now" nothing is all-know among 4
    await S(page, () => window.__navi.get().memberJoin('jun'))
    await page.waitForTimeout(200)
    await fire(page, { t: 'exit' })
    await page.locator('[data-testid=wrap]').waitFor()
    await page.locator('.rw__dot').nth(2).click()
    assert.ok(await waitFor(page, () => document.querySelector('[data-testid=wrap-page]')?.getAttribute('data-page') === '3', null, 1500))
    const song = page.locator('[data-testid=wrap-common-song][data-song=yoru-ni-kakeru]')
    await song.waitFor()
    assert.ok(Number(await song.getAttribute('data-size')) >= 3)
    assert.match(await song.innerText(), /\d人全員/)
    assert.doesNotMatch(await page.locator('[data-testid=wrap-page]').innerText(), /全員がそろう曲は、次の夜に/, 'not the empty state')
    noErrors(errors, 'all-know after join')
  })

  // ---------------------------------------------------------------- QA ROBUST#8 / DEMO#16: the empty wall line wraps, never clipped
  await stepC('room sidebar: the empty wall-of-light line is fully visible (dual 1366 ja, room 1024 en)', async () => {
    for (const [kind, q, vp] of [
      ['dual', '?test=1&seed=demo&reset=1&intro=0&view=dual', null],
      ['tablet', '?test=1&seed=demo&reset=1&intro=0&view=room&locale=en', { width: 1024, height: 768 }],
    ]) {
      const { page, errors } = await open(kind, q)
      if (vp) await page.setViewportSize(vp)
      await page.waitForSelector('[data-testid=app-root]')
      await page.waitForTimeout(900)
      const empty = page.locator('[data-shell=room] [data-testid=room-sidebar] [data-testid=wall-empty]')
      await empty.waitFor()
      const fit = await empty.evaluate(el => {
        const span = el.firstElementChild
        const box = el.closest('.sg-side__constellation') ?? el.parentElement
        const a = span.getBoundingClientRect()
        const b = box.getBoundingClientRect()
        return { inside: a.left >= b.left - 0.5 && a.right <= b.right + 0.5, noClip: span.scrollWidth <= span.clientWidth + 1, text: span.textContent }
      })
      assert.ok(fit.inside && fit.noClip, `${kind}: empty line fits ${JSON.stringify(fit)}`)
      assert.ok(fit.text.length > 10)
      noErrors(errors, `wall empty ${kind}`)
    }
  })

  // ---------------------------------------------------------------- small phone + T14 wording
  await stepC('360×740: record tab and the wrap fit without horizontal scroll', async () => {
    const { page, errors } = await open('small', Q)
    await playNight(page)
    await openRecord(page)
    const sw = () => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth))
    assert.ok((await sw()) <= 360, `record scrollWidth ${await sw()}`)
    const cut = await S(page, () => [...document.querySelectorAll('.rc-chip__name, .rc-pager__tab span')].filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.textContent))
    assert.deepEqual(cut, [], 'chip and tab labels are not cut at 360')
    await fire(page, { t: 'exit' })
    await page.locator('[data-testid=wrap]').waitFor()
    await page.click('[data-testid=wrap-skip]')
    await page.waitForTimeout(700)
    assert.ok((await sw()) <= 360, `wrap scrollWidth ${await sw()}`)
    const save = await page.locator('[data-testid=wrap-save]').boundingBox()
    assert.ok(save && save.y + save.height <= 740, 'the choices are on screen')
    noErrors(errors, 'small')
  })
}
