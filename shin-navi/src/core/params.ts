// URL parameters (SPEC K-10), parsed once at startup.
import type { Locale, ViewMode } from './types'

export type Params = {
  view?: ViewMode
  seed?: string
  speed?: 1 | 4 | 8
  script: boolean
  locale?: Locale
  reset: boolean
  intro0: boolean
  seedNights?: number
  entry: boolean
  test: boolean
}

export function parseParams(search: string): Params {
  const q = new URLSearchParams(search)
  const view = q.get('view')
  const speed = Number(q.get('speed'))
  const locale = q.get('locale')
  const seedNights = Number(q.get('seedNights'))
  return {
    view: view === 'phone' || view === 'room' || view === 'dual' ? view : undefined,
    seed: q.get('seed') || undefined,
    speed: speed === 1 || speed === 4 || speed === 8 ? speed : undefined,
    script: q.get('script') === '1',
    locale: locale === 'ja' || locale === 'en' || locale === 'zhHant' || locale === 'zhHans' || locale === 'ko' ? locale : undefined,
    reset: q.get('reset') === '1',
    intro0: q.get('intro') === '0',
    seedNights: seedNights > 0 ? Math.min(5, Math.floor(seedNights)) : undefined,
    entry: q.get('entry') === '1',
    test: q.get('test') === '1',
  }
}

export const params: Params = parseParams(typeof location === 'undefined' ? '' : location.search)
