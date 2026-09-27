// M7 voice (SPEC L/M7): quiz → features → all four types, the reading (evidence, song, key),
// the "this time" wording with no judgement words in any language, and the no-recording rule.
import { describe, expect, it } from 'vitest'
import type { VoiceTypeId } from '../../core/types'
import { voiceType, rangeFit } from '../../engine/reading'
import { SONG_BY_ID } from '../../data/songs'
import { LOCALE_IDS, namespaceStrings, trIn } from '../../i18n'
import type { CaptureResult, PitchFrame } from '../../lib/pitch'
import {
  QUIZ,
  QUIZ_ORDER,
  VOICE_TYPES,
  DEFAULT_RANGE,
  buildReading,
  dynamicsOf,
  evidenceFor,
  keyAdvice,
  keyBadge,
  partialFeatures,
  quizToFeatures,
  reserveLabel,
  shiftText,
  singingRange,
  suggestionsFor,
  type QuizAnswers,
} from './buildReading'
import './strings'
import '../../i18n/vocab'

const allQuizzes = (): QuizAnswers[] => {
  const out: QuizAnswers[] = []
  for (const high of QUIZ.high) for (const chorus of QUIZ.chorus) for (const style of QUIZ.style) out.push({ high, chorus, style })
  return out
}
const ctx = { nightId: 'n-test', now: 1_000, exclude: [] as string[] }

// ---------------------------------------------------------------- quizToFeatures

describe('quizToFeatures', () => {
  it('has 27 answer combinations in the order high → chorus → style', () => {
    expect(QUIZ_ORDER).toEqual(['high', 'chorus', 'style'])
    expect(allQuizzes()).toHaveLength(27)
  })

  it('reaches all four voice types', () => {
    const reached = new Map<VoiceTypeId, QuizAnswers>()
    for (const q of allQuizzes()) {
      const t = voiceType(quizToFeatures(q))
      if (!reached.has(t)) reached.set(t, q)
    }
    expect([...reached.keys()].sort()).toEqual([...VOICE_TYPES].sort())
  })

  it('has a known example answer for each type (used by the demo and the e2e test)', () => {
    expect(voiceType(quizToFeatures({ high: 'easy', chorus: 'soft', style: 'sustain' }))).toBe('clear')
    expect(voiceType(quizToFeatures({ high: 'easy', chorus: 'belt', style: 'sustain' }))).toBe('power')
    expect(voiceType(quizToFeatures({ high: 'normal', chorus: 'between', style: 'ride' }))).toBe('groove')
    expect(voiceType(quizToFeatures({ high: 'hard', chorus: 'between', style: 'talk' }))).toBe('emotional')
  })

  it('keeps every factor in 0..1 and gives a sane range', () => {
    for (const q of allQuizzes()) {
      const f = quizToFeatures(q)
      for (const k of ['power', 'care', 'brightness', 'groove'] as const) {
        expect(f[k]).toBeGreaterThanOrEqual(0)
        expect(f[k]).toBeLessThanOrEqual(1)
      }
      expect(f.range[0]).toBeLessThan(f.range[1])
      expect(f.range[1] - f.range[0]).toBeGreaterThanOrEqual(12)
    }
  })

  it('each answer moves its own pillar: chorus → power, style → care, high → brightness', () => {
    const base: QuizAnswers = { high: 'normal', chorus: 'between', style: 'ride' }
    expect(quizToFeatures({ ...base, chorus: 'belt' }).power).toBeGreaterThan(quizToFeatures({ ...base, chorus: 'soft' }).power)
    expect(quizToFeatures({ ...base, style: 'sustain' }).care).toBeGreaterThan(quizToFeatures({ ...base, style: 'talk' }).care)
    expect(quizToFeatures({ ...base, high: 'easy' }).brightness).toBeGreaterThan(quizToFeatures({ ...base, high: 'hard' }).brightness)
  })

  it('the live preview lifts a pillar as soon as its question is answered', () => {
    const none = partialFeatures({})
    expect(partialFeatures({ chorus: 'belt' }).power).toBeGreaterThan(none.power)
    expect(partialFeatures({ style: 'sustain' }).care).toBeGreaterThan(none.care)
    expect(partialFeatures({ high: 'easy' }).brightness).toBeGreaterThan(none.brightness)
  })
})

// ---------------------------------------------------------------- buildReading

describe('buildReading from the quiz', () => {
  it('records the type, the factors, the method and an evidence line that resolves in 5 languages', () => {
    for (const q of allQuizzes()) {
      const r = buildReading({ capture: null, quiz: q }, ctx)
      const f = quizToFeatures(q)
      expect(r.method).toBe('quiz')
      expect(r.type).toBe(voiceType(f))
      expect([r.power, r.care, r.brightness, r.groove]).toEqual([f.power, f.care, f.brightness, f.groove])
      expect(r.range).toEqual(f.range)
      expect(r.nightId).toBe('n-test')
      expect(r.evidence.key.startsWith('voice.ev.')).toBe(true)
      for (const l of LOCALE_IDS) {
        const text = trIn(r.evidence, l)
        expect(text.length).toBeGreaterThan(4)
        expect(text).not.toMatch(/^voice\./)
      }
    }
  })

  it('suggests one reservable song with the key from rangeFit', () => {
    for (const q of allQuizzes()) {
      const r = buildReading({ capture: null, quiz: q }, ctx)
      expect(r.suggest).toBeDefined()
      const song = SONG_BY_ID[r.suggest!.songId]
      expect(song.reservable).toBe(true)
      expect(r.suggest!.keyShift).toBe(rangeFit(song, r.range!).shift)
    }
  })

  it('never suggests a song that is already queued', () => {
    const q: QuizAnswers = { high: 'hard', chorus: 'between', style: 'talk' }
    const first = buildReading({ capture: null, quiz: q }, ctx).suggest!.songId
    const again = buildReading({ capture: null, quiz: q }, { ...ctx, exclude: [first] })
    expect(again.suggest!.songId).not.toBe(first)
    expect(suggestionsFor(again.type, again.range!, [first], 3).map(s => s.songId)).not.toContain(first)
  })

  it('is deterministic', () => {
    const q: QuizAnswers = { high: 'easy', chorus: 'soft', style: 'sustain' }
    expect(buildReading({ capture: null, quiz: q }, ctx)).toEqual(buildReading({ capture: null, quiz: q }, ctx))
  })

  it('a lower comfortable range can suggest a lower key (T09: "−n reserve")', () => {
    const lowered = allQuizzes()
      .filter(q => q.high === 'hard')
      .map(q => buildReading({ capture: null, quiz: q }, ctx).suggest!.keyShift)
    expect(lowered.some(k => k < 0)).toBe(true)
    // the e2e answer set lands on a lowered key
    expect(buildReading({ capture: null, quiz: { high: 'hard', chorus: 'between', style: 'talk' } }, ctx).suggest!.keyShift).toBeLessThan(0)
  })
})

// a capture that looks like a 3-second hum sliding from A3 up to D4 with a swell
function hum(): CaptureResult {
  const frames: PitchFrame[] = []
  for (let i = 0; i < 120; i++) {
    const t = i / 40
    const midi = 57 + (5 * i) / 120
    frames.push({ t, hz: 440 * Math.pow(2, (midi - 69) / 12), rms: 0.02 + 0.2 * Math.sin(i / 12) ** 2, centroid: 1500 })
  }
  return { frames, range: [57, 62], features: { power: 0.72, care: 0.4, brightness: 0.2, groove: 0.35 }, voicedRatio: 1 }
}

describe('buildReading from a hum', () => {
  it('is a mic reading, and the key is fitted to a singing range widened around the hummed notes', () => {
    const cap = hum()
    const r = buildReading({ capture: cap }, ctx)
    expect(r.method).toBe('mic')
    expect(r.type).toBe(voiceType(cap.features))
    expect(r.range).toEqual(singingRange([57, 62]))
    expect(r.range![0]).toBeLessThanOrEqual(57)
    expect(r.range![1] - r.range![0]).toBeGreaterThanOrEqual(18)
    const song = SONG_BY_ID[r.suggest!.songId]
    expect(r.suggest!.keyShift).toBe(rangeFit(song, r.range!).shift)
  })

  it('a hum too short for a range still gives a reading, keyed to a neutral range', () => {
    const cap: CaptureResult = { frames: [], range: null, features: { power: 0.5, care: 0.5, brightness: 0.5, groove: 0.5 }, voicedRatio: 0.1 }
    const r = buildReading({ capture: cap }, ctx)
    expect(r.method).toBe('mic')
    expect(r.range).toBeNull()
    const song = SONG_BY_ID[r.suggest!.songId]
    expect(r.suggest!.keyShift).toBe(rangeFit(song, DEFAULT_RANGE).shift)
  })

  it('keeps no audio: only numbers and a note range (no frames) end up in the reading', () => {
    const r = buildReading({ capture: hum() }, ctx) as unknown as Record<string, unknown>
    expect(Object.keys(r).sort()).toEqual(['at', 'brightness', 'care', 'evidence', 'groove', 'method', 'nightId', 'power', 'range', 'suggest', 'type'])
    expect(JSON.stringify(r).length).toBeLessThan(400)
  })

  it('reads "big changes in loudness" when the hum swells and fades', () => {
    const cap = hum()
    expect(dynamicsOf(cap)).toBeGreaterThan(0.42)
    expect(evidenceFor('emotional', cap.features, { capture: cap }).key).toBe('voice.ev.dynamics')
    expect(trIn({ key: 'voice.ev.dynamics' }, 'ja')).toBe('強弱の変化が大きい歌い方でした')
  })
})

// ---------------------------------------------------------------- key presentation

describe('key labels', () => {
  it('uses a real minus sign and flat/sharp marks', () => {
    expect(shiftText(-2)).toBe('−2')
    expect(shiftText(3)).toBe('+3')
    expect(keyBadge(-2)).toBe('♭2')
    expect(keyBadge(1)).toBe('♯1')
    expect(keyBadge(0)).toBe('')
  })
  it('says the key advice and the reserve label in every language', () => {
    expect(trIn(keyAdvice(-2), 'ja')).toBe('キーを2下げると歌いやすい可能性があります')
    expect(trIn(reserveLabel(-2), 'ja')).toBe('−2で予約')
    expect(trIn(reserveLabel(0), 'ja')).toBe('原曲キーで予約')
    for (const l of LOCALE_IDS) {
      for (const k of [-3, 0, 2]) {
        expect(trIn(keyAdvice(k), l)).not.toMatch(/\{|\}|^voice\./)
        expect(trIn(reserveLabel(k), l)).not.toMatch(/\{|\}|^voice\./)
      }
    }
  })
})

// ---------------------------------------------------------------- wording (C-8 5 / O)

describe('the wording is playful self-discovery, never a verdict', () => {
  const s = namespaceStrings('voice')!
  const all = (l: string) => Object.values((s as unknown as Record<string, Record<string, string>>)[l] ?? {})

  it('the result line is "this time, the voice was {type}" in every language', () => {
    const typeName = (l: (typeof LOCALE_IDS)[number]) => trIn({ key: 'vocab.voice.emotional' }, l)
    expect(trIn({ key: 'voice.result', vars: { type: typeName('ja') } }, 'ja')).toBe('今回の声はエモーショナル')
    expect(trIn({ key: 'voice.result', vars: { type: 'X' } }, 'en')).toMatch(/^This time/)
    expect(trIn({ key: 'voice.result', vars: { type: 'X' } }, 'zhHant')).toMatch(/^這次/)
    expect(trIn({ key: 'voice.result', vars: { type: 'X' } }, 'zhHans')).toMatch(/^这次/)
    expect(trIn({ key: 'voice.result', vars: { type: 'X' } }, 'ko')).toMatch(/^이번/)
  })

  // "you are a … type", fixed labels, and any judgement of skill, personality, age or gender
  const FORBIDDEN: Record<string, RegExp[]> = {
    ja: [/あなたは/, /タイプ/, /常に/, /いつも/, /上手/, /下手/, /音痴/, /才能/, /性格/, /年齢/, /性別/, /男性/, /女性/, /男らし/, /女らし/, /点数/, /採点/, /ランク/, /診断/],
    en: [/\byou are\b/i, /\byou're\b/i, /\btype\b/i, /\balways\b/i, /\bskill/i, /\btalent/i, /\bgood at\b/i, /\bbad at\b/i, /\bpersonality\b/i, /\bage\b/i, /\bgender\b/i, /\bmale\b/i, /\bfemale\b/i, /\bscore\b/i, /\brank/i, /\bdiagnos/i],
    zhHant: [/你是/, /類型/, /總是/, /永遠/, /唱得好/, /唱得差/, /音痴/, /天賦/, /性格/, /年齡/, /性別/, /男性/, /女性/, /分數/, /排名/, /診斷/],
    zhHans: [/你是/, /类型/, /总是/, /永远/, /唱得好/, /唱得差/, /音痴/, /天赋/, /性格/, /年龄/, /性别/, /男性/, /女性/, /分数/, /排名/, /诊断/],
    ko: [/당신은/, /타입/, /유형/, /항상/, /언제나/, /잘 부르/, /못 부르/, /음치/, /재능/, /성격/, /나이/, /성별/, /남성/, /여성/, /점수/, /순위/, /진단/],
  }
  for (const l of LOCALE_IDS) {
    it(`no judgement or fixed-label words in ${l}`, () => {
      const texts = all(l)
      expect(texts.length).toBeGreaterThan(60)
      for (const raw of texts) {
        const text = raw.replace(/\{\w+\}/g, '')
        for (const re of FORBIDDEN[l]) expect(text, `${l}: "${raw}" matches ${re}`).not.toMatch(re)
      }
    })
  }

  it('says that nothing is recorded, and that voices change', () => {
    expect(trIn({ key: 'voice.card.noRec' }, 'ja')).toBe('録音は保存しません')
    expect(trIn({ key: 'voice.fallback' }, 'ja')).toBe('マイクが使えないので、3つの質問で見てみましょう')
    expect(trIn({ key: 'voice.card.q' }, 'ja')).toBe('今夜の声を見てみる？')
    expect(trIn({ key: 'voice.note' }, 'ja')).toBe('声は曲や日によって変わります')
  })
})

// ---------------------------------------------------------------- source rules

describe('module source rules', () => {
  const tsx = import.meta.glob('./*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
  const ts = import.meta.glob(['./*.ts', '!./*.test.ts', '!./strings.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>
  it('has the component files', () => expect(Object.keys(tsx).sort()).toEqual(['./MicCapture.tsx', './Pillars.tsx', './Quiz.tsx', './VoiceCardBody.tsx', './VoiceSheet.tsx']))
  for (const [name, src] of Object.entries(tsx)) {
    it(`${name}: no Japanese / full-width literals (text lives in strings.ts)`, () => {
      expect(src).not.toMatch(/[　-ヿ㐀-鿿＀-￯]/)
    })
  }
  const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
  it('never records audio: no MediaRecorder, no requestAnimationFrame loop of its own', () => {
    for (const [name, raw] of Object.entries({ ...tsx, ...ts })) {
      const src = code(raw)
      expect(src, name).not.toMatch(/MediaRecorder/)
      expect(src, name).not.toMatch(/requestAnimationFrame/)
      expect(src, name).not.toMatch(/shadowBlur|ctx\.filter/)
    }
  })
})
