// Coverage: every registered namespace (except internal tools) has every key in all five locales,
// with the same {variables}. Feature string files are picked up automatically.
import { describe, expect, it } from 'vitest'
import { INTERNAL_NAMESPACES, LOCALE_IDS, namespaceStrings, registeredNamespaces, trIn, songTitle } from './index'

const modules = import.meta.glob(['./*.ts', '../features/**/strings.ts', '!./*.test.ts', '!./index.ts'], { eager: true })

const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',')

describe('i18n coverage', () => {
  it('loads string modules', () => {
    expect(Object.keys(modules).length).toBeGreaterThan(0)
    expect(registeredNamespaces()).toEqual(expect.arrayContaining(['vocab', 'reason', 'cause', 'core']))
  })

  for (const ns of registeredNamespaces()) {
    if (INTERNAL_NAMESPACES.has(ns)) continue
    it(`namespace ${ns} is complete in 5 locales`, () => {
      const s = namespaceStrings(ns)!
      const ja = s.ja as Record<string, string>
      for (const l of LOCALE_IDS) {
        const d = (s as unknown as Record<string, Record<string, string> | undefined>)[l]
        expect(d, `${ns} missing locale ${l}`).toBeDefined()
        for (const k of Object.keys(ja)) {
          expect(d![k], `${ns}.${k} missing in ${l}`).toBeTypeOf('string')
          expect(vars(d![k]), `${ns}.${k} variables differ in ${l}`).toBe(vars(ja[k]))
        }
      }
    })
  }

  it('resolves variables in the viewing language', () => {
    expect(trIn({ key: 'cause.joined', vars: { member: { member: 'jun' } } }, 'ja')).toBe('ジュンが合流したので')
    expect(trIn({ key: 'cause.joined', vars: { member: { member: 'jun' } } }, 'ko')).toBe('준 님이 합류해서')
    expect(trIn({ key: 'reason.gap', vars: { tempo: { tempo: 'slow' }, genre: { genre: 'J-POP' } } }, 'en')).toBe('Slow × J-Pop is still dark')
    expect(trIn({ key: 'reason.duet', vars: { member: { member: 'saki' }, pair: { pair: ['emotional', 'clear'] } } }, 'ja')).toBe('サキ × あなた＝『光と影のハーモニー』')
  })

  it('song titles follow G-4', () => {
    expect(songTitle('zankoku', 'ko').main).toBe('잔혹한 천사의 테제')
    expect(songTitle('zankoku', 'ko').sub).toBe('残酷な天使のテーゼ')
    expect(songTitle('zankoku', 'ja').main).toBe('残酷な天使のテーゼ')
    expect(songTitle('kanden', 'zhHant').main).toBe('Kanden')
  })
})
