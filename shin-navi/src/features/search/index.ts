// M8 search-mixer — PHASE-0 STUB (owned by M8 from phase 1). Public API per SPEC L/M8.
// The stub has a working search over every title script, reserve from results, and a working
// language sheet (switches in place, no reload).
import { createElement as h, useMemo, useState } from 'react'
import type { SearchFilters, Song } from '../../core/types'
import { SONGS } from '../../data/songs'
import { useNavi, naviApi } from '../../core/store'
import { selReservedPos } from '../../core/selectors'
import { reserveAsMe } from '../../core/actions'
import { Icon } from '../../core/ui/Icon'
import { SongTitle } from '../../core/ui/SongTitle'
import { StubBox } from '../../core/ui/StubBox'
import { common } from '../../i18n/common'
import { LOCALES, setLocale, useLocale } from '../../i18n'
import '../../styles/stubs.css'

export type SearchHit = { song: Song; score: number; matched: 'title' | 'artist' | 'romaji' | 'en' | 'zhHant' | 'zhHans' | 'ko' }

/** NFKC, lower-case, katakana → hiragana, strip spaces / symbols / long-vowel marks. */
export function normalize(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[\sー‐-―\-_.,!?'"“”‘’・〜~()（）「」『』:：;；/／&＆]+/g, '')
}

export function searchSongs(q: string, o: { filters?: SearchFilters; limit?: number } = {}): SearchHit[] {
  const n = normalize(q)
  const out: SearchHit[] = []
  for (const song of SONGS) {
    const f = o.filters
    if (f?.genre && song.genre !== f.genre) continue
    if (f?.tempo && song.tempo !== f.tempo) continue
    if (f?.lang && song.lang !== f.lang) continue
    if (f?.vibe && !song.tags.hypothesis.includes(f.vibe)) continue
    if (!n) {
      out.push({ song, score: 0, matched: 'title' })
      continue
    }
    const fields: [SearchHit['matched'], string | undefined][] = [
      ['title', song.title],
      ['romaji', song.inboundTitle.romaji],
      ['en', song.inboundTitle.en],
      ['ko', song.inboundTitle.ko],
      ['zhHant', song.inboundTitle.zhHant],
      ['zhHans', song.inboundTitle.zhHans],
      ['artist', song.artist],
    ]
    let best: SearchHit | null = null
    for (const [k, v] of fields) {
      if (!v) continue
      const nv = normalize(v)
      const i = nv.indexOf(n)
      if (i < 0) continue
      const score = (i === 0 ? 2 : 1) + n.length / Math.max(1, nv.length) - (k === 'artist' ? 0.5 : 0)
      if (!best || score > best.score) best = { song, score, matched: k }
    }
    if (best) out.push(best)
  }
  return out.sort((a, b) => b.score - a.score).slice(0, o.limit ?? 30)
}

export function SearchBar(): JSX.Element {
  const t = common.useT()
  return h(
    'button',
    { type: 'button', className: 'stub-searchbar', 'data-testid': 'search-bar', 'data-anchor': 'search', onClick: () => naviApi.getState().openSheet('search') },
    h(Icon, { name: 'search', size: 18, strokeWidth: 2 }),
    h('span', null, t('search.placeholder')),
  )
}

function Result({ song }: { song: Song }) {
  const t = common.useT()
  const pos = useNavi(selReservedPos(song.id))
  return h(
    'li',
    { className: 'stub-result', 'data-testid': 'search-result', 'data-song-id': song.id },
    h('div', { className: 'stub-result__title' }, h(SongTitle, { songId: song.id, variant: 'chip' }), h('small', null, song.artist)),
    pos != null
      ? h('span', { className: 'stub-result__pos', 'data-testid': 'search-reserved-pos' }, `#${pos}`)
      : h('button', { type: 'button', className: 'stub-result__btn', 'data-testid': 'search-reserve', disabled: !song.reservable, onClick: () => reserveAsMe(naviApi, song.id, { source: 'search' }) }, t('reserve')),
  )
}

export function SearchSheet(): JSX.Element {
  const t = common.useT()
  const arg = useNavi(s => s.ui.sheet?.arg as { filters?: SearchFilters; query?: string } | undefined)
  const [q, setQ] = useState(arg?.query ?? '')
  const hits = useMemo(() => searchSongs(q, { filters: arg?.filters, limit: 30 }), [q, arg?.filters])
  return h(
    'div',
    { className: 'stub-search' },
    h('input', { className: 'stub-search__input', 'data-testid': 'search-input', value: q, placeholder: t('search.placeholder'), onChange: e => setQ((e.target as HTMLInputElement).value), autoFocus: true }),
    h('ul', { className: 'stub-search__list' }, hits.map(x => h(Result, { key: x.song.id, song: x.song }))),
  )
}

export function MoodMixer(): JSX.Element {
  return h(StubBox, { name: 'MoodMixer', module: 'M8', className: 'stub-sheetbody', testid: 'mixer-pad' })
}

export function LangSheet(): JSX.Element {
  const cur = useLocale()
  return h(
    'div',
    { className: 'stub-langs' },
    LOCALES.map(l =>
      h(
        'button',
        {
          key: l.id,
          type: 'button',
          className: `stub-lang${l.id === cur ? ' is-on' : ''}`,
          'data-testid': 'lang-chip',
          'data-locale': l.id,
          onClick: () => {
            setLocale(l.id)
            naviApi.getState().closeSheet()
          },
        },
        h('b', null, l.short),
        h('span', null, l.label),
      ),
    ),
  )
}
