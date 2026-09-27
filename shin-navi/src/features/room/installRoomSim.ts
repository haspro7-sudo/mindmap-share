// The three roommates, alive (SPEC E-1…E-11, E-13, K-3 PresenterCmd). Everything runs on the
// core sim clock (`after`), so 1×/4×/8× just works and a hidden tab pauses the room, and every
// decision is seeded, so the same seed replays the same night.
import type { NaviApi } from '../../core/store/types'
import type { MemberId, OtherId, PresenterCmd, QueueItem, QueueTag, RoomPrompt, SongId, TextRef } from '../../core/types'
import { isMine, presentMembers } from '../../core/store'
import { after } from '../../core/clock'
import { bus } from '../../core/events'
import { introDelay, introElapsedMs } from '../../core/intro'
import { roomMinutesLeft, SIM_MS_PER_ROOM_MIN } from '../../core/rules'
import { JUN_JOIN_MINUTE } from '../../data/members'
import { SONG_BY_ID } from '../../data/songs'
import { LOCALE_IDS, getLocale, setLocale } from '../../i18n'
import { seeded } from '../../lib/rng'
import { drawAnswer } from './knowModel'
import { R, type RoomKey } from './strings'
import {
  finaleVote,
  finaleWinner,
  findTwin,
  freshSim,
  junWants,
  membersMayReserve,
  minatoWants,
  OPENER_GRACE_MS,
  myScore,
  pickMemberSong,
  sakiWants,
  sendRequest,
  sendTwin,
  useSim,
} from './sim'
import { advanceOne, autoStep, finishMineOrTurn, makeMyTurn, restoreHome, runNext, runStep, settleChain } from './script'

const BUBBLE_TTL = 2600
// positive floor chatter only (E-2, E-12): never about who knows what, never a judgement
const QUEUED_BUBBLES = ['bubble.queued0', 'bubble.queued1', 'bubble.queued2'] as const
const CHEER_BUBBLES = ['bubble.cheer0', 'bubble.cheer1'] as const
const CLAP_BUBBLES = ['bubble.clap0', 'bubble.clap1'] as const

export function installRoomSim(api: NaviApi): () => void {
  const S = () => api.getState()
  const seedOf = () => S().session.seed
  const live = () => S().session.phase === 'live'

  // ---- timers on the sim clock, dropped when the night changes or the sim is uninstalled
  const jobs = new Set<() => void>()
  const later = (simMs: number, fn: () => void): (() => void) => {
    const night = S().session.nightId
    const box: { cancel: () => void } = { cancel: () => {} }
    box.cancel = after(simMs, () => {
      jobs.delete(box.cancel)
      if (S().session.nightId !== night) return
      fn()
    })
    jobs.add(box.cancel)
    return box.cancel
  }
  /** pacing in real ms that looks the same at every speed */
  const laterReal = (realMs: number, fn: () => void) => later(realMs * S().session.speed, fn)
  const offs: (() => void)[] = []

  // ---- per-night bookkeeping
  let answered = new Set<string>() // `${member}|${songId}` already scheduled (or silent)
  let pendingRes: Partial<Record<OtherId, () => void>> = {}
  let resCount: Record<OtherId, number> = { minato: 0, saki: 0, jun: 0 }
  let songEnds = 0
  let songStarts = 0
  let junAuto = false
  let requestRound = -1
  let twinHalves = new Set<number>()
  let seenPrompts = new Set<string>()
  let shiftsSeen = 0
  let firstShift = ''
  let lastBubble: Partial<Record<MemberId, number>> = {}
  let mineTimer: (() => void) | null = null
  /** performance.now() at the start of this night's entrance */
  let introStart = performance.now() - introElapsedMs()

  const resetNight = () => {
    jobs.forEach(c => c())
    jobs.clear()
    answered = new Set()
    pendingRes = {}
    resCount = { minato: 0, saki: 0, jun: 0 }
    songEnds = 0
    songStarts = 0
    junAuto = false
    requestRound = -1
    twinHalves = new Set()
    seenPrompts = new Set(S().room.prompt ? [S().room.prompt!.id] : [])
    shiftsSeen = 0
    firstShift = ''
    lastBubble = {}
    mineTimer = null
    useSim.setState(freshSim(S().session.nightId, getLocale()))
  }

  const bubble = (member: MemberId, text: TextRef) => {
    const now = Date.now()
    if ((lastBubble[member] ?? 0) > now - 2200 || !live()) return
    lastBubble[member] = now
    S().pushBubble({ member, text, ttl: BUBBLE_TTL })
  }

  // ================================================================ 知ってる (E-2, C-11)

  /**
   * The navi's own question about the night's first card during the entrance (B-2): two dots
   * light at ~1.9 s. The first card is the opener in Japanese and a visa card in other locales
   * (C-10); either way the friends who came along answer it first.
   */
  const isOpenerAsk = (songId: SongId) => {
    const s = S()
    const top = s.deck.cards[0]
    const tally = s.room.knowing[songId]
    return (
      !!top &&
      top.kind === 'song' &&
      (top.variant === 'opener' || !s.deck.history.length) &&
      performance.now() - introStart < 8000 &&
      top.songId === songId &&
      !s.room.sung.length &&
      !s.room.now &&
      !s.room.queue.length &&
      !!tally &&
      !Object.keys(tally.answers).length
    )
  }

  const openerAnswers = (songId: SongId) => {
    // Minato and Saki are the friends who came along: they know the first song, and their dots
    // arrive exactly when the entrance lights the dots (INTRO_TIMELINE.knowDots), in arrival order.
    const base = introDelay('knowDots') * 1000
    const elapsed = performance.now() - introStart
    presentMembers(S())
      .filter(m => m.id !== 'me')
      .forEach((m, i) => {
        answered.add(`${m.id}|${songId}`)
        const wait = Math.max(0, base + i * 170 - elapsed)
        laterReal(wait, () => {
          const s = S()
          if (!live() || !s.room.members[m.id].present || s.room.knowing[songId]?.answers[m.id]) return
          s.answerKnow(songId, m.id, 'know')
        })
      })
  }

  /** Schedule the room's answers to one question (only those who were not asked yet). */
  const scheduleAnswers = (songId: SongId, o: { only?: MemberId; delay?: (m: MemberId) => number } = {}) => {
    const s = S()
    const song = SONG_BY_ID[songId]
    if (!song) return
    let talked = false
    for (const m of presentMembers(s)) {
      if (m.id === 'me' || (o.only && m.id !== o.only)) continue
      const key = `${m.id}|${songId}`
      if (answered.has(key) || s.room.knowing[songId]?.answers[m.id]) continue
      answered.add(key)
      const d = drawAnswer(s.session.seed, m, song)
      if (d.silent) continue // 15% never answer: their dot stays exactly like "don't know"
      later(o.delay ? o.delay(m.id) : d.delayMs, () => {
        const st = S()
        if (!live() || !st.room.members[m.id].present) {
          answered.delete(key)
          return
        }
        if (st.room.knowing[songId]?.answers[m.id]) return
        st.answerKnow(songId, m.id, d.answer)
        // a re-count after a join brings at most one bubble, so the floor is not flooded
        if (d.bubble && !(o.only && talked)) {
          talked = true
          bubble(m.id, d.bubble)
        }
      })
    }
  }

  const onAsked = (songId: SongId) => {
    if (!live()) return
    if (isOpenerAsk(songId)) openerAnswers(songId)
    else scheduleAnswers(songId)
  }

  // ================================================================ reservations (E-3)

  const reserveFor = (id: OtherId) => {
    const s = S()
    const n = resCount[id]++
    const songId = pickMemberSong(s, id, n)
    if (!songId) return
    const tags: QueueTag[] = []
    // Saki uses the navi's recommendation tag 30% of the time: the excuse helps the shy one (E-3)
    if (id === 'saki' && seeded(`${s.session.seed}|sakiNavi|${n}`)() < 0.3) tags.push('navi')
    s.reserve(songId, { by: id, tags, source: 'member' })
  }

  const cancelPending = () => {
    for (const c of Object.values(pendingRes)) c?.()
    pendingRes = {}
  }

  const checkMembers = () => {
    const s = S()
    if (!membersMayReserve(s)) {
      cancelPending()
      return
    }
    const seed = s.session.seed
    if (minatoWants(s) && !pendingRes.minato) {
      const r = seeded(`${seed}|minatoWait|${resCount.minato}`)()
      pendingRes.minato = later(4000 + 4000 * r, () => {
        pendingRes.minato = undefined
        const st = S()
        if (membersMayReserve(st) && minatoWants(st)) reserveFor('minato')
      })
    }
    if (junWants(s) && !pendingRes.jun) {
      const r = seeded(`${seed}|junWait|${resCount.jun}`)()
      pendingRes.jun = later(5000 + 6000 * r, () => {
        pendingRes.jun = undefined
        const st = S()
        if (membersMayReserve(st) && junWants(st)) reserveFor('jun')
      })
    }
  }

  // ================================================================ script mode: the room's quiet set-up (E-13 steps 2–3)

  /**
   * In script mode the room reacts to my first song the way E-13 describes: once it is on
   * stage (the core starts the night's first song after the undo window), Saki queues her slow
   * pair, then Minato one of his. Saki goes first so beat 6 plays the room on in queue order,
   * never jumping it. Both are the script's own quiet steps, run only while they are the next
   * step (a → press beats them to it), so the order never breaks.
   */
  const onQueued = (item: QueueItem) => {
    const s = S()
    if (!live()) return
    const seed = s.session.seed
    // a roommate who just booked a song sometimes says so (always positive, never about me)
    if (item.by !== 'me' && s.room.members[item.by]?.present) {
      const r = seeded(`${seed}|queuedSay|${item.by}|${item.songId}`)
      if (r() < 0.45) {
        const text = R.ref(QUEUED_BUBBLES[Math.floor(r() * QUEUED_BUBBLES.length) % QUEUED_BUBBLES.length])
        laterReal(350, () => bubble(item.by, text))
      }
    }
    if (!s.session.script) return
    if (isMine(item)) {
      laterReal(3900 + 1300 * seeded(`${seed}|autoSaki`)(), () => {
        const st = S()
        const mine = st.room.queue.some(isMine) || (!!st.room.now && isMine(st.room.now.item)) || st.room.sung.some(e => isMine(e.item))
        if (mine) autoStep(api, 'saki-mellow')
      })
    } else if (item.by === 'saki') {
      laterReal(3200 + 1800 * seeded(`${seed}|autoMinato`)(), () => void autoStep(api, 'minato-reserve'))
    }
  }

  // ================================================================ songs start and end: Saki, cheers, requests, twins

  /** One friend (seeded) cheers from the floor: my turn starts, my song ends, someone arrives. */
  const cheer = (key: string, keys: readonly string[], p: number, delayMs: number, exclude: MemberId | null = null) => {
    const s = S()
    const room = presentMembers(s).filter(m => m.id !== 'me' && m.id !== exclude)
    if (!room.length) return
    const r = seeded(`${s.session.seed}|cheer|${key}`)
    if (r() >= p) return
    const who = room[Math.floor(r() * room.length) % room.length].id
    const text = R.ref(keys[Math.floor(r() * keys.length) % keys.length] as RoomKey)
    laterReal(delayMs, () => bubble(who, text))
  }

  const onSongStarted = (item: QueueItem) => {
    songStarts++
    const s = S()
    if (!live()) return
    if (isMine(item)) cheer(`start|${item.id}`, CHEER_BUBBLES, 0.85, 450, item.with ?? null)
    if (s.session.script) return
    // Saki: every second song (E-3). She books while it plays, so the room never falls silent.
    if (songStarts % 2 === 0 && sakiWants(s) && membersMayReserve(s) && !pendingRes.saki) {
      const r = seeded(`${s.session.seed}|sakiWait|${songStarts}`)()
      pendingRes.saki = later(2500 + 4500 * r, () => {
        pendingRes.saki = undefined
        const st = S()
        if (membersMayReserve(st) && sakiWants(st)) reserveFor('saki')
      })
    }
  }

  const onSongEnded = (item: QueueItem) => {
    songEnds++
    const s = S()
    if (!live()) return
    if (isMine(item)) cheer(`end|${item.id}`, CLAP_BUBBLES, 0.8, 300, item.with ?? null)
    if (s.session.script) return
    const seed = s.session.seed
    // Saki's request, at most once a round, once I have two faces (E-6)
    if (
      s.room.members.saki.present &&
      requestRound !== s.deck.round &&
      s.deck.offers.requestRound !== s.deck.round &&
      !s.room.invites.some(i => i.variant === 'request' && i.status === 'open') &&
      Object.keys(s.col.faces).length >= 2
    ) {
      const r = seeded(`${seed}|reqRoll|${songEnds}`)
      if (r() < 0.55) {
        requestRound = s.deck.round
        later(2500 + 3500 * r(), () => void sendRequest(api))
      }
    }
    // twin star, once in each half of the night (E-7, C-8 ⑦)
    const half = roomMinutesLeft(s.session.simMs) > 45 ? 0 : 1
    if (!twinHalves.has(half) && !(s.deck.offers.twinHalves ?? []).includes(half) && findTwin(s)) {
      twinHalves.add(half)
      later(1800, () => {
        const st = S()
        if (!st.session.script) sendTwin(api)
      })
    }
  }

  // ================================================================ my song (E-4) and my voice

  const armMySong = () => {
    mineTimer?.()
    mineTimer = null
    const s = S()
    const now = s.room.now
    if (!now || !isMine(now.item)) return
    // outside script mode my song ends on its own; finish it a hair early so it carries its score
    const early = 300 * s.session.speed + 100
    const left = Math.max(0, now.startedAt + now.durationMs - early - s.session.simMs)
    const id = now.item.id
    mineTimer = later(left, () => {
      const st = S()
      if (st.session.script || st.room.now?.item.id !== id) return
      st.finishNow({ score: myScore(st, st.room.now.item) })
    })
  }

  const syncMyVoice = () => {
    const s = S()
    const v = [...s.col.voices].reverse().find(x => x.nightId === s.session.nightId)
    if (v && s.room.members.me.voiceType !== v.type) s.setMemberVoice('me', v.type)
  }

  // ================================================================ agreement and votes (E-5)

  /**
   * One roommate's answer to a shift proposal: agree with p 0.85 within 2.5 s. In script mode
   * the night's first proposal is the demo's beat (SPEC N #6: the song slots in second), so the
   * room says yes to that one; every later proposal draws its answers as usual.
   */
  const scheduleAgree = (p: RoomPrompt, id: MemberId, first: boolean) => {
    const s = S()
    const r = seeded(`${s.session.seed}|agree|${id}|${p.songIds[0]}`)
    const roll = r()
    const ok = (first && s.session.script) || roll < 0.85
    const delay = 350 + 2050 * r() // within 2.5 s
    const talk = ok && r() < 0.4
    const text = R.ref(r() < 0.5 ? 'bubble.agree0' : 'bubble.agree1')
    later(delay, () => {
      const st = S()
      if (st.room.prompt?.id !== p.id || st.room.prompt.agree?.[id] != null) return
      // a hold-out still answers (false) so the prompt resolves; nobody learns who it was
      st.agreePrompt(id, st.room.members[id].present ? ok : true)
      if (talk) bubble(id, text)
    })
  }

  const onPrompt = (p: RoomPrompt) => {
    if (seenPrompts.has(p.id)) return
    seenPrompts.add(p.id)
    if (p.kind !== 'shift') return
    const first = shiftsSeen++ === 0
    firstShift = first ? p.id : firstShift
    const room = presentMembers(S()).filter(m => m.id !== 'me')
    if (!room.length) {
      S().agreePrompt('me', true)
      return
    }
    for (const m of room) scheduleAgree(p, m.id, first)
  }

  /** Someone walked in or went home while the room was deciding: the decision still closes. */
  const onRoomChanged = (joined: MemberId | null) => {
    const s = S()
    const p = s.room.prompt
    if (!p) return
    const others = presentMembers(s).filter(m => m.id !== 'me')
    if (p.kind === 'shift') {
      if (joined) scheduleAgree(p, joined, p.id === firstShift)
      else if (others.every(m => p.agree?.[m.id] != null)) {
        // everyone still here has answered: re-state one answer so the room resolves it
        const first = others[0]
        s.agreePrompt(first ? first.id : 'me', first ? !!p.agree?.[first.id] : true)
      }
    } else if (p.kind === 'finale' && p.votes?.me) {
      const seed = s.session.seed
      if (joined) {
        const m = s.room.members[joined]
        later(600 + 2400 * seeded(`${seed}|voteAt|${joined}|${p.id}`)(), () => castVote(p.id, joined, finaleVote(seed, m, p.songIds)))
      } else if (presentMembers(s).every(m => p.votes?.[m.id])) {
        useSim.setState(u => ({ decided: { ...u.decided, [p.id]: finaleWinner(p.songIds, p.votes ?? {}) } }))
        laterReal(1700, () => {
          const st = S()
          if (st.room.prompt?.id === p.id && p.votes?.me) st.votePrompt('me', p.votes.me)
        })
      }
    }
  }

  /** My finale vote is in: the roommates' votes drift to the lanterns over 0.6–3 s. */
  const onMyVote = () => {
    const s = S()
    const p = s.room.prompt
    if (!p || p.kind !== 'finale') return
    const seed = s.session.seed
    const plan = presentMembers(s)
      .filter(m => m.id !== 'me' && !p.votes?.[m.id])
      .map(m => ({ id: m.id, songId: finaleVote(seed, m, p.songIds), delay: 600 + 2400 * seeded(`${seed}|voteAt|${m.id}|${p.id}`)() }))
      .sort((a, b) => a.delay - b.delay)
    for (const v of plan) later(v.delay, () => castVote(p.id, v.id, v.songId))
  }

  const castVote = (promptId: string, member: MemberId, songId: SongId) => {
    const s = S()
    const p = s.room.prompt
    if (!p || p.id !== promptId || p.votes?.[member] || !s.room.members[member].present) return
    const flights = [...(useSim.getState().votes[promptId] ?? []), { member, songId, at: Date.now() }]
    useSim.setState(u => ({ votes: { ...u.votes, [promptId]: flights } }))
    const votes = { ...(p.votes ?? {}), [member]: songId }
    const complete = presentMembers(s).every(m => votes[m.id])
    if (!complete) {
      s.votePrompt(member, songId)
      return
    }
    // the last thread lands and the winning lantern flares before the room fixes the gold slot
    useSim.setState(u => ({ decided: { ...u.decided, [promptId]: finaleWinner(p.songIds, votes) } }))
    laterReal(1700, () => {
      if (S().room.prompt?.id === promptId) S().votePrompt(member, songId)
    })
  }

  // ================================================================ invites: twin reveal, duet, my requests

  const onReveal = (cardId: string, variant: string | undefined, songId: SongId | undefined, from: OtherId | undefined) => {
    if (!songId || !from) return
    const seed = seedOf()
    if (variant === 'twin') {
      if (useSim.getState().twin[cardId]?.mine) return
      const r = seeded(`${seed}|twinReveal|${songId}|${from}`)
      const yes = r() < 0.8
      const delay = 1500 + 1500 * r()
      useSim.setState(u => ({ twin: { ...u.twin, [cardId]: { mine: true, them: 'wait' } } }))
      later(delay, () => {
        useSim.setState(u => ({ twin: { ...u.twin, [cardId]: { mine: true, them: yes ? 'yes' : 'no' } } }))
        if (yes) bubble(from, R.ref('bubble.twinYes'))
      })
    } else if (variant === 'duet') {
      if (useSim.getState().duet[cardId]) return
      const r = seeded(`${seed}|duetYes|${songId}|${from}`)
      const yes = r() < 0.9
      const delay = 900 + 1100 * r()
      useSim.setState(u => ({ duet: { ...u.duet, [cardId]: 'asking' } }))
      later(delay, () => {
        useSim.setState(u => ({ duet: { ...u.duet, [cardId]: yes ? 'yes' : 'sent' } }))
        if (yes) bubble(from, R.ref('bubble.duetYes'))
      })
    }
  }

  /** "誰かに歌ってほしい" from my face sheet (E-6): 3 s later, accepted with p 0.6. */
  const onRequestSent = (to: OtherId, songId: SongId) => {
    const r = seeded(`${seedOf()}|reqAccept|${to}|${songId}`)()
    later(3000, () => {
      const s = S()
      const song = SONG_BY_ID[songId]
      if (r >= 0.6 || !song?.reservable || !s.room.members[to].present) return // no answer is ever shown as a refusal
      if (s.room.queue.some(q => q.songId === songId) || s.room.now?.item.songId === songId) return
      s.reserve(songId, { by: to, tags: ['request'], source: 'member' })
      bubble(to, R.ref('bubble.reqYes'))
    })
  }

  // ================================================================ presenter commands (K-3)

  let cycling: ReturnType<typeof setTimeout>[] = []
  const cycleLocales = () => {
    cycling.forEach(clearTimeout)
    const start = getLocale()
    const i0 = LOCALE_IDS.indexOf(start)
    cycling = LOCALE_IDS.map((_, k) => setTimeout(() => setLocale(LOCALE_IDS[(i0 + k + 1) % LOCALE_IDS.length]), (k + 1) * 1000))
  }

  /** New night without losing the presenter's setup (script, speed, view, panel). */
  const keepPresenter = (fn: () => void) => {
    const before = S()
    const keep = { script: before.session.script, speed: before.session.speed, view: before.session.view, noDuck: before.session.noDuck, panel: before.ui.presenter }
    const seededNights = before.col.nights.filter(n => n.seeded).length
    fn()
    const s = S()
    if (s.session.script !== keep.script) s.setScript(keep.script)
    s.setSpeed(keep.speed)
    s.setView(keep.view)
    s.setNoDuck(keep.noDuck)
    if (seededNights && !S().col.nights.some(n => n.seeded)) S().seedPastNights(seededNights)
    if (keep.panel && !S().ui.presenter) S().togglePresenter()
  }

  const onCmd = (cmd: PresenterCmd) => {
    const s = S()
    switch (cmd.t) {
      case 'next':
        runNext(api)
        break
      case 'step':
        runStep(api, cmd.id)
        break
      case 'speed':
        s.setSpeed(cmd.v)
        break
      case 'script':
        s.setScript(cmd.on)
        break
      case 'join':
        if (!s.room.members[cmd.id].present) {
          junAuto = junAuto || cmd.id === 'jun'
          s.memberJoin(cmd.id)
        }
        break
      case 'leave':
        s.memberLeave(cmd.id)
        break
      case 'advance':
        advanceOne(api)
        break
      case 'myTurn':
        makeMyTurn(api)
        break
      case 'finishMine':
        finishMineOrTurn(api, cmd.score)
        break
      case 'request':
        sendRequest(api, true)
        break
      case 'twin':
        sendTwin(api, true)
        break
      case 'coaster':
        break // the dealer answers this cue itself (insert.coaster.cue)
      case 'minutesLeft':
        if (live()) s.jumpToMinutesLeft(cmd.m)
        break
      case 'exit':
        // a scripted demo closes in the language it was told in (QA DEMO#5)
        settleChain()
        if (s.session.script) restoreHome()
        S().exitRoom()
        break
      case 'nextVisit':
        keepPresenter(() => {
          const st = S()
          if (st.session.phase === 'live') st.exitRoom()
          S().closeNight({ linked: true })
          S().startNight({ nextVisit: true })
        })
        break
      case 'seedNights':
        s.seedPastNights(cmd.n)
        break
      case 'view':
        s.setView(cmd.v)
        break
      case 'localeCycle':
        cycleLocales()
        break
      case 'reset':
        keepPresenter(() => S().resetAll())
        break
    }
  }

  // ================================================================ wiring

  // the night may already be running: boot loaded or started it (and the director may have
  // asked about the opener) before this installer ran
  resetNight()
  for (const songId of Object.keys(S().room.knowing)) onAsked(songId)
  syncMyVoice()
  armMySong()
  if (S().room.prompt) onPrompt(S().room.prompt!)

  let checkQueued = false
  const soon = () => {
    if (checkQueued) return
    checkQueued = true
    queueMicrotask(() => {
      checkQueued = false
      checkMembers()
      junArrives()
    })
  }

  /** Outside script mode Jun walks in at room minute 12 (E-1, E-9). */
  const junArrives = () => {
    const s = S()
    if (junAuto || s.session.script || !live()) return
    if (s.session.simMs < JUN_JOIN_MINUTE * SIM_MS_PER_ROOM_MIN) return
    junAuto = true
    if (!s.room.members.jun.present) s.memberJoin('jun')
  }

  offs.push(
    bus.on('night/started', () => {
      introStart = performance.now()
      resetNight()
    }),
    bus.on('know/asked', e => onAsked(e.songId)),
    bus.on('member/joined', e => {
      if (e.id === 'jun') junAuto = true
      // C-11 ⑤: the newcomer answers what the room was already asked, 1–3 s later
      const seed = seedOf()
      for (const songId of Object.keys(S().room.knowing)) {
        scheduleAnswers(songId, { only: e.id, delay: () => 1000 + 2000 * seeded(`${seed}|recount|${e.id}|${songId}`)() })
      }
      onRoomChanged(e.id)
      // the newcomer says hello once the ring has turned into light (C-11 ①)
      if (seeded(`${seed}|hello|${e.id}`)() < 0.9) laterReal(900, () => bubble(e.id, R.ref('bubble.hello')))
      soon()
    }),
    bus.on('member/left', e => {
      // someone who went home will not sing: their waiting songs leave the queue
      const s = S()
      const theirs = s.room.queue.filter((q: QueueItem) => q.by === e.id)
      for (const q of theirs) S().cancelReserve(q.id)
      pendingRes[e.id]?.()
      delete pendingRes[e.id]
      onRoomChanged(null)
    }),
    bus.on('queue/added', e => onQueued(e.item)),
    bus.on('song/started', e => {
      armMySong()
      onSongStarted(e.item)
    }),
    bus.on('song/ended', e => {
      armMySong()
      onSongEnded(e.entry.item)
      soon()
    }),
    bus.on('card/acted', e => {
      if (e.card.kind === 'finale' && e.action === 'vote') onMyVote()
      if (e.card.kind === 'invite' && e.action === 'reveal') onReveal(e.card.id, e.card.variant, e.card.songId, e.card.from)
    }),
    bus.on('request/sent', e => onRequestSent(e.to, e.songId)),
    bus.on('presenter/cmd', e => onCmd(e.cmd)),
    api.subscribe((s, p) => {
      if (s.session.nightId !== p.session.nightId) return
      if (s.room.prompt && s.room.prompt !== p.room.prompt) {
        const pr = s.room.prompt
        queueMicrotask(() => onPrompt(pr))
      }
      if (s.col.voices !== p.col.voices) queueMicrotask(syncMyVoice)
      if (s.session.speed !== p.session.speed || s.session.script !== p.session.script) queueMicrotask(armMySong)
      if (
        s.room.queue !== p.room.queue ||
        s.room.now !== p.room.now ||
        s.room.members !== p.room.members ||
        s.session.script !== p.session.script ||
        s.session.phase !== p.session.phase ||
        s.metrics.firstReserveMs !== p.metrics.firstReserveMs ||
        (s.session.simMs !== p.session.simMs && !junAuto) ||
        (p.session.simMs < OPENER_GRACE_MS && s.session.simMs >= OPENER_GRACE_MS)
      )
        soon()
    }),
  )

  return () => {
    offs.forEach(f => f())
    jobs.forEach(c => c())
    jobs.clear()
    cycling.forEach(clearTimeout)
  }
}
