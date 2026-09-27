// Search sheet (SPEC S2, L/M8 #2–#3). Rises from under the stage lane, which stays visible, so
// the queue is in view while choosing. One field searches every script; results show the title
// in the viewing language (G-4) with the original and romaji, the part that matched, sung
// versions, language, whether it can be reserved here, and "予約済み #n" once queued.
// Filter chips separate evidence (solid: genre, decade, tempo, language) from Navi's read
// (dotted hypothesis tags). Opened from a dark area of the ball it arrives pre-filtered and
// celebrates the first light in that area. Reserving throws the song into the lane (fx/flight;
// a twin token rides the same path inside the sheet so the throw is visible end to end);
// "keep" folds a facet onto your ball, counted live in the header.
import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { Genre, SearchFilters, Song, Tempo, Vibe } from '../../core/types'
import { GENRES, SONG_BY_ID } from '../../data/songs'
import { useNavi, naviApi } from '../../core/store'
import { selReservedPos } from '../../core/selectors'
import { reserveAsMe, songColor } from '../../core/actions'
import { bus } from '../../core/events'
import { resolveTarget } from '../../core/targets'
import { useLayoutFrame, useViewMode } from '../../core/layout'
import { sound } from '../../core/sound'
import { areaColor } from '../../core/rules'
import { Icon } from '../../core/ui/Icon'
import { songTitle, useLocale, type Locale } from '../../i18n'
import { vocab } from '../../i18n/vocab'
import { palette } from '../../lib/art'
import { S } from './strings'
import { DECADES, LANG_ORDER, TEMPO_ORDER, TRY_QUERIES, VIBE_ORDER, fieldText, matchRange, searchSongs, songsInArea, type MatchField, type SearchHit } from './search'

type SearchArg = { filters?: SearchFilters; query?: string }
type Facet = keyof SearchFilters

const RESERVE_MS = 280 // same as the card flight (I-4 #2)
const KEEP_MS = 420

// ---------------------------------------------------------------- small helpers

function mainFieldOf(song: Song, l: Locale): MatchField {
  const t = song.inboundTitle
  if (l === 'ja') return 'title'
  if (l !== 'en' && t[l]) return l
  if (t.en) return 'en'
  if (t.romaji) return 'romaji'
  return 'title'
}

/** Text with the matched run wrapped in <mark>. */
function Hl({ text, q }: { text: string; q: string }): JSX.Element {
  const r = q ? matchRange(text, q) : null
  if (!r) return <>{text}</>
  return (
    <>
      {text.slice(0, r[0])}
      <mark className="sx-hl">{text.slice(r[0], r[1])}</mark>
      {text.slice(r[1])}
    </>
  )
}

/** A tilted facet (one tile of the mirror ball). */
function Facet({ className }: { className?: string }): JSX.Element {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 1.5 14.5 8 8 14.5 1.5 8Z" />
      <path className="sx-facet__shine" d="M8 1.5 14.5 8 8 8Z" />
    </svg>
  )
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const qbez = (a: number, c: number, b: number, t: number) => (1 - t) * (1 - t) * a + 2 * (1 - t) * t * c + t * t * b
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)

type Box = { x: number; y: number; w: number; h: number }
function localBox(r: DOMRectReadOnly | DOMRect, host: DOMRect, sc: number): Box {
  return { x: (r.left - host.left) / sc, y: (r.top - host.top) / sc, w: r.width / sc, h: r.height / sc }
}

/**
 * The part of the throw that happens inside the sheet. It follows exactly the card flight's
 * path (quadratic bezier, 280 ms, shrinking to a 40 px chip) and is clipped by the sheet's top
 * edge, where the FlightLayer token (drawn above the lane) takes over.
 */
function throwInSheet(sheet: HTMLElement, from: DOMRect, to: DOMRectReadOnly, songId: string, sc: number): void {
  if (typeof sheet.animate !== 'function') return
  const host = sheet.getBoundingClientRect()
  const f = localBox(from, host, sc)
  const t = localBox(to, host, sc)
  const w = Math.max(40, f.w)
  const h = Math.max(24, f.h)
  const c0 = { x: f.x + f.w / 2, y: f.y + f.h / 2 }
  const c1 = { x: t.x + t.w / 2, y: t.y + t.h / 2 }
  const ctrl = { x: c0.x + (c1.x - c0.x) * 0.12, y: c1.y + (c0.y - c1.y) * 0.22 }
  const s1 = 40 / w
  const pal = palette(songId, SONG_BY_ID[songId]?.energy ?? 0.5)
  const tok = document.createElement('div')
  tok.className = 'sx-tok'
  tok.style.width = `${w}px`
  tok.style.height = `${h}px`
  tok.style.borderRadius = `${Math.min(24, h / 2)}px`
  tok.style.setProperty('--a', pal.a)
  tok.style.setProperty('--b', pal.b)
  const bg = document.createElement('i')
  bg.className = 'sx-tok__bg'
  bg.style.background = pal.bg
  const chip = document.createElement('i')
  chip.className = 'sx-tok__chip'
  tok.append(bg, chip)
  sheet.appendChild(tok)
  const frames: Keyframe[] = []
  const STEPS = 18
  for (let i = 0; i <= STEPS; i++) {
    const k = i / STEPS
    const te = 1 - Math.pow(1 - k, 1.8)
    const x = qbez(c0.x, ctrl.x, c1.x, te)
    const y = qbez(c0.y, ctrl.y, c1.y, te)
    const s = 1 + (s1 - 1) * easeOutCubic(Math.min(1, k / 0.72))
    const rot = Math.sin(Math.PI * k) * -7
    frames.push({ transform: `translate3d(${(x - w / 2).toFixed(1)}px, ${(y - h / 2).toFixed(1)}px, 0) scale(${s.toFixed(4)}) rotate(${rot.toFixed(2)}deg)`, offset: k })
  }
  bg.animate([{ opacity: 1 }, { opacity: 1, offset: 0.35 }, { opacity: 0 }], { duration: RESERVE_MS, fill: 'forwards' })
  chip.animate([{ opacity: 0 }, { opacity: 0, offset: 0.3 }, { opacity: 1 }], { duration: RESERVE_MS, fill: 'forwards' })
  const a = tok.animate(frames, { duration: RESERVE_MS, easing: 'linear', fill: 'forwards' })
  a.onfinish = () => tok.remove()
  // a glow left behind on the row, like a launch pad
  const pad = document.createElement('i')
  pad.className = 'sx-launch'
  pad.style.setProperty('--a', pal.a)
  pad.style.transform = `translate3d(${(c0.x - 40).toFixed(1)}px, ${(c0.y - 40).toFixed(1)}px, 0)`
  sheet.appendChild(pad)
  const g = pad.animate(
    [
      { opacity: 0.95, transform: `translate3d(${(c0.x - 40).toFixed(1)}px, ${(c0.y - 40).toFixed(1)}px, 0) scale(0.4)` },
      { opacity: 0, transform: `translate3d(${(c0.x - 40).toFixed(1)}px, ${(c0.y - 40).toFixed(1)}px, 0) scale(1.6)` },
    ],
    { duration: 520, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'forwards' },
  )
  g.onfinish = () => pad.remove()
}

/** "Keep": a facet pops off the row and arcs into the ball counter in the header. */
function keepInSheet(sheet: HTMLElement, from: DOMRect, to: DOMRect | null, color: string, sc: number, onLand: () => void): void {
  if (!to || typeof sheet.animate !== 'function') return onLand()
  const host = sheet.getBoundingClientRect()
  const f = localBox(from, host, sc)
  const t = localBox(to, host, sc)
  const c0 = { x: f.x + f.w / 2, y: f.y + f.h / 2 }
  const c1 = { x: t.x + 14, y: t.y + t.h / 2 }
  const ctrl = { x: lerp(c0.x, c1.x, 0.5) + 30, y: Math.min(c0.y, c1.y) - 70 }
  const tile = document.createElement('i')
  tile.className = 'sx-ktile'
  tile.style.setProperty('--area', color)
  sheet.appendChild(tile)
  const frames: Keyframe[] = []
  const STEPS = 16
  for (let i = 0; i <= STEPS; i++) {
    const k = i / STEPS
    const e = k < 0.25 ? 0 : easeOutCubic((k - 0.25) / 0.75)
    const x = qbez(c0.x, ctrl.x, c1.x, e)
    const y = qbez(c0.y, ctrl.y, c1.y, e)
    const s = k < 0.25 ? lerp(0.4, 1.6, k / 0.25) : lerp(1.6, 0.55, e)
    frames.push({ transform: `translate3d(${(x - 9).toFixed(1)}px, ${(y - 9).toFixed(1)}px, 0) rotate(${(45 + k * 270).toFixed(0)}deg) scale(${s.toFixed(3)})`, opacity: k > 0.94 ? 0 : 1, offset: k })
  }
  const a = tile.animate(frames, { duration: KEEP_MS, easing: 'linear', fill: 'forwards' })
  a.onfinish = () => {
    tile.remove()
    onLand()
  }
}

// ---------------------------------------------------------------- filter chips

type ChipDef = { facet: Facet; value: string; label: string; dotted?: boolean; color?: string }

function FilterChip({ c, active, onToggle }: { c: ChipDef; active: boolean; onToggle: (c: ChipDef) => void }): JSX.Element {
  return (
    <button
      type="button"
      className={`chip chip--sm ${c.dotted ? 'chip--dotted' : 'chip--solid'} is-button sx-chip${active ? ' is-active' : ''}`}
      data-testid="filter-chip"
      data-kind={c.dotted ? 'hypothesis' : 'evidence'}
      data-facet={c.facet}
      data-value={c.value}
      aria-pressed={active}
      onClick={() => onToggle(c)}
    >
      {c.color ? <span className="chip__dot" style={{ background: c.color }} aria-hidden="true" /> : c.dotted ? <span className="chip__hyp" aria-hidden="true" /> : null}
      <span className="chip__text">{c.label}</span>
      {active ? <Icon name="close" size={10} strokeWidth={2.8} className="sx-chip__x" /> : null}
    </button>
  )
}

function ChipRow({ label, note, chips, filters, dotted, onToggle }: { label: string; note?: string; chips: ChipDef[]; filters: SearchFilters; dotted?: boolean; onToggle: (c: ChipDef) => void }): JSX.Element {
  const isOn = (c: ChipDef) => filters[c.facet] === c.value
  // selected chips come first so an arrival from the ball shows its filters without scrolling
  const ordered = [...chips.filter(isOn), ...chips.filter(c => !isOn(c))]
  let prevFacet: Facet | null = null
  return (
    <div className={`sx-chips${dotted ? ' sx-chips--hyp' : ''}`}>
      <span className="sx-chips__label">
        {label}
        {note ? <small>{note}</small> : null}
      </span>
      <div className="sx-chips__scroll">
        {ordered.map(c => {
          const sep = prevFacet != null && prevFacet !== c.facet && !isOn(c)
          prevFacet = c.facet
          return (
            <span key={`${c.facet}:${c.value}`} className="sx-chips__cell">
              {sep ? <i className="sx-chips__sep" aria-hidden="true" /> : null}
              <FilterChip c={c} active={isOn(c)} onToggle={onToggle} />
            </span>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- one result

type RowProps = {
  hit: SearchHit
  q: string
  room: boolean
  i: number
  onReserve: (songId: string, from: HTMLElement) => void
  onKeep: (songId: string, from: HTMLElement) => void
}

const Row = memo(function Row({ hit, q, room, i, onReserve, onKeep }: RowProps): JSX.Element {
  const t = S.useT()
  const v = vocab.useT()
  const l = useLocale()
  const song = hit.song
  const pos = useNavi(selReservedPos(song.id))
  const face = useNavi(s => (room ? undefined : s.col.faces[song.id]?.state))
  const art = useRef<HTMLSpanElement>(null)
  const firstPos = useRef(pos)
  const title = songTitle(song.id, l)
  const mainField = mainFieldOf(song, l)
  const subs: { text: string; field: MatchField; lang?: string }[] = []
  if (title.sub) subs.push({ text: title.sub, field: 'title', lang: 'ja' })
  if (title.romaji && title.romaji !== title.main) subs.push({ text: title.romaji, field: 'romaji' })
  const shown = new Set<MatchField>([mainField, ...subs.map(s => s.field)])
  const alias = hit.matched === 'artist' ? fieldText(song, 'artist', q) : null
  const matchText = q && (!shown.has(hit.matched) && hit.matched !== 'artist' ? fieldText(song, hit.matched) : alias && alias !== song.artist ? alias : null)
  const pal = useMemo(() => palette(song.id, song.energy), [song.id, song.energy])
  const color = areaColor(song.genre)
  const justQueued = pos != null && firstPos.current == null

  return (
    <li
      className={`sx-row${pos != null ? ' is-queued' : ''}${song.reservable ? '' : ' is-unavailable'}`}
      style={{ '--i': Math.min(i, 10), '--area': color } as CSSProperties}
      data-testid="search-result"
      data-song-id={song.id}
      data-genre={song.genre}
      data-tempo={song.tempo}
      data-matched={hit.matched}
      data-reservable={song.reservable ? '1' : '0'}
    >
      {justQueued ? <i key={`sweep${pos}`} className="sx-row__sweep" aria-hidden="true" /> : null}
      <span ref={art} className="sx-art" style={{ background: pal.bg }} aria-hidden="true">
        <i className="sx-art__shine" />
        <i className={`sx-art__tempo sx-art__tempo--${song.tempo}`} />
        {face ? <Facet className={`sx-art__face sx-face--${face}`} /> : null}
      </span>
      <div className="sx-row__text">
        <div className="sx-row__title" lang={mainField === 'title' ? 'ja' : undefined}>
          <Hl text={title.main} q={q} />
        </div>
        {subs.length ? (
          <div className="sx-row__sub">
            {subs.map((s, k) => (
              <span key={k} lang={s.lang}>
                <Hl text={s.text} q={q} />
              </span>
            ))}
          </div>
        ) : null}
        <div className="sx-row__meta">
          <span className="sx-row__artist" lang="ja">
            <Hl text={song.artist} q={q} />
          </span>
          <span className="sx-row__dot" aria-hidden="true" />
          <span className="sx-row__year">{song.year}</span>
          <span className="sx-row__genre">
            <i style={{ background: color }} aria-hidden="true" />
            {v(`genre.${song.genre}`)}
          </span>
        </div>
      </div>
      <div className="sx-act">
        {room ? null : (
          <button
            type="button"
            className={`sx-keep${face ? ' is-on' : ''}`}
            data-testid="search-keep"
            aria-label={face ? t('row.kept') : t('row.keep')}
            title={face ? t('row.kept') : t('row.keep')}
            aria-pressed={!!face}
            disabled={!!face}
            onClick={e => onKeep(song.id, e.currentTarget)}
          >
            <Facet className={`sx-keep__icon${face ? ` sx-face--${face}` : ''}`} />
          </button>
        )}
        {pos != null ? (
          <span key={`pos${pos}`} className={`sx-pos${pos === 0 ? ' is-now' : ''}`} data-testid="search-reserved-pos">
            {pos === 0 ? t('row.playing') : t('reservedN', { n: pos })}
          </span>
        ) : (
          <button type="button" className="sx-res" data-testid="search-reserve" disabled={!song.reservable} onClick={() => art.current && onReserve(song.id, art.current)}>
            <Icon name="chevron" size={13} strokeWidth={3} className="sx-res__up" />
            {t('row.reserve')}
          </button>
        )}
      </div>
      <div className="sx-row__chips">
        {matchText ? (
          <span className="sx-match">
            <b>{t('row.matched', { field: t(`field.${hit.matched}`) })}</b>
            <span lang={hit.matched === 'ko' ? 'ko' : hit.matched === 'zhHant' ? 'zh-Hant' : hit.matched === 'zhHans' ? 'zh-Hans' : undefined}>
              <Hl text={matchText} q={q} />
            </span>
          </span>
        ) : null}
        <span className="sx-tag sx-tag--lang">{v(`lang.${song.lang}`)}</span>
        {song.versions.map(ver => (
          <span key={ver} className="sx-tag">
            {v(`version.${ver}`)}
          </span>
        ))}
        {song.reservable ? null : <span className="sx-na">{t('row.notReservable')}</span>}
      </div>
    </li>
  )
})

// ---------------------------------------------------------------- area arrival banner

function AreaBanner({ tempo, genre }: { tempo: Tempo; genre: Genre }): JSX.Element {
  const t = S.useT()
  const ids = useMemo(() => songsInArea(tempo, genre).map(s => s.id), [tempo, genre])
  const lit = useNavi(s => ids.reduce((n, id) => n + (s.col.faces[id] ? 1 : 0), 0))
  const litAtOpen = useRef(lit)
  const first = litAtOpen.current === 0 && lit > 0
  return (
    <div className={`sx-area${first ? ' is-lit' : ''}`} style={{ '--area': areaColor(genre) } as CSSProperties} data-private="1" data-testid="search-area" data-lit={first ? '1' : '0'}>
      <span className="sx-area__facet" aria-hidden="true">
        <svg viewBox="0 0 46 38">
          <path className="sx-area__fill" d="M6 6 Q23 1 40 6 L45 32 Q23 38 1 32 Z" />
          <path className="sx-area__edge" d="M6 6 Q23 1 40 6 L45 32 Q23 38 1 32 Z" />
        </svg>
      </span>
      <span className="sx-area__text">
        <small>{first ? t('area.lit') : t('area.label')}</small>
        <b>{t('area.name', { tempo: { tempo }, genre: { genre } })}</b>
        {first ? null : <em>{t('area.hint')}</em>}
      </span>
      <span className="sx-area__count">{t('count', { n: ids.length })}</span>
      {first ? <i key="burst" className="sx-area__burst" aria-hidden="true" /> : null}
    </div>
  )
}

// ---------------------------------------------------------------- the sheet

export function SearchSheet(): JSX.Element {
  const t = S.useT()
  const v = vocab.useT()
  const locale = useLocale()
  const room = useViewMode() === 'room'
  const frame = useLayoutFrame()
  const init = useRef<SearchArg | undefined>(naviApi.getState().ui.sheet?.arg as SearchArg | undefined).current
  const [q, setQ] = useState(init?.query ?? '')
  const [filters, setFilters] = useState<SearchFilters>(() => ({ ...(init?.filters ?? {}) }))
  const area = useRef(init?.filters?.tempo && init.filters.genre ? { tempo: init.filters.tempo, genre: init.filters.genre } : null).current
  const openedAt = useRef(performance.now())
  const logged = useRef('')
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const ballRef = useRef<HTMLSpanElement>(null)
  const faces = useNavi(s => (room ? 0 : Object.keys(s.col.faces).length))
  const [bump, setBump] = useState(0)

  const query = q.trim()
  const hits = useMemo(() => searchSongs(query, { filters, limit: query ? 40 : 60 }), [query, filters])
  const nFilters = Object.values(filters).filter(Boolean).length
  const unfiltered = useMemo(() => (hits.length === 0 && nFilters > 0 ? searchSongs(query, { limit: 500 }).length : 0), [hits.length, nFilters, query])

  // log a query once the typing settles (and a miss when it found nothing)
  const flushLog = () => {
    if (!query || query === logged.current) return
    logged.current = query
    const s = naviApi.getState()
    s.logSearch('query')
    if (hits.length === 0) s.logSearch('miss')
  }
  const flushRef = useRef(flushLog)
  flushRef.current = flushLog
  useEffect(() => {
    if (!query) return
    const id = setTimeout(() => flushRef.current(), 700)
    return () => clearTimeout(id)
  }, [query, hits.length])
  useEffect(() => () => flushRef.current(), [])

  // focus the field once the sheet has risen (not when arriving to browse an area)
  useEffect(() => {
    if (area) return
    const id = setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 340)
    return () => clearTimeout(id)
  }, [])

  const sheetEl = () => rootRef.current?.closest('.sheet') as HTMLElement | null

  const onReserve = (songId: string, from: HTMLElement) => {
    flushRef.current()
    const rect = from.getBoundingClientRect()
    const res = reserveAsMe(naviApi, songId, room ? { source: 'room', tags: ['room'] } : { source: 'search' })
    if (!res) return
    naviApi.getState().logSearch('reserve', Math.round(performance.now() - openedAt.current))
    if (room) return
    bus.emit({ type: 'fx/flight', from: rect, to: 'lane:next', kind: 'reserve', songId, color: songColor(songId) })
    const target = resolveTarget('lane:next')
    const sheet = sheetEl()
    if (sheet && target && !naviApi.getState().ui.reduced) throwInSheet(sheet, rect, target, songId, frame.scale || 1)
  }

  const onKeep = (songId: string, from: HTMLElement) => {
    const s = naviApi.getState()
    if (s.col.faces[songId]) return
    const rect = from.getBoundingClientRect()
    s.faceEvent(songId, 'keep')
    sound.play('keepFold')
    bus.emit({ type: 'fx/flight', from: rect, to: `face:${songId}`, kind: 'keep', songId, color: songColor(songId) })
    const sheet = sheetEl()
    const land = () => setBump(b => b + 1)
    const song = SONG_BY_ID[songId]
    if (sheet && !s.ui.reduced) keepInSheet(sheet, rect, ballRef.current?.getBoundingClientRect() ?? null, song ? areaColor(song.genre) : '#fff', frame.scale || 1, land)
    else land()
  }

  // stable handlers so memoised rows do not re-render on every keystroke
  const act = useRef({ onReserve, onKeep })
  act.current = { onReserve, onKeep }
  const stable = useMemo(
    () => ({
      onReserve: (id: string, el: HTMLElement) => act.current.onReserve(id, el),
      onKeep: (id: string, el: HTMLElement) => act.current.onKeep(id, el),
    }),
    [],
  )

  const toggle = (c: ChipDef) => {
    sound.play('tap')
    setFilters(f => {
      const next = { ...f }
      if (next[c.facet] === c.value) delete next[c.facet]
      else (next as Record<string, string>)[c.facet] = c.value
      return next
    })
  }

  const evidence: ChipDef[] = useMemo(
    () => [
      ...GENRES.map(g => ({ facet: 'genre' as const, value: g, label: v(`genre.${g}`), color: areaColor(g) })),
      ...TEMPO_ORDER.map(x => ({ facet: 'tempo' as const, value: x, label: v(`tempo.${x}`) })),
      ...DECADES.map(d => ({ facet: 'decade' as const, value: d, label: t('decade', { y: d.slice(0, 4) }) })),
      ...LANG_ORDER.map(x => ({ facet: 'lang' as const, value: x, label: v(`lang.${x}`) })),
    ],
    [locale],
  )
  const hypothesis: ChipDef[] = useMemo(() => VIBE_ORDER.map((x: Vibe) => ({ facet: 'vibe' as const, value: x, label: v(`vibe.${x}`), dotted: true })), [locale])

  let body: ReactNode
  if (hits.length === 0) {
    body = (
      <div className="sx-none" data-testid="search-none">
        <span className="sx-none__orb" aria-hidden="true" />
        <b>{t('none.title')}</b>
        <span>{t('none.hint')}</span>
        {unfiltered > 0 ? (
          <button type="button" className="sx-none__btn" onClick={() => setFilters({})}>
            {t('none.unfilter', { n: unfiltered })}
          </button>
        ) : null}
      </div>
    )
  } else {
    body = (
      <ul className="sx-list" aria-label={t('sheet.title')}>
        {hits.map((h, i) => (
          <Row key={h.song.id} hit={h} q={query} room={room} i={i} onReserve={stable.onReserve} onKeep={stable.onKeep} />
        ))}
      </ul>
    )
  }

  return (
    <div ref={rootRef} className={`sx${room ? ' sx--room' : ''}`}>
      <div className="sx__head">
        <label className="sx-field">
          <Icon name="search" size={19} strokeWidth={2.3} className="sx-field__icon" />
          <input
            ref={inputRef}
            className="sx-field__input"
            data-testid="search-input"
            type="text"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            value={q}
            placeholder={t('input.placeholder')}
            aria-label={t('sheet.title')}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                flushRef.current()
                e.currentTarget.blur()
              }
            }}
          />
          {q ? (
            <button
              type="button"
              className="sx-field__clear"
              aria-label={t('input.clear')}
              onClick={() => {
                setQ('')
                inputRef.current?.focus({ preventScroll: true })
              }}
            >
              <Icon name="close" size={14} strokeWidth={2.6} />
            </button>
          ) : null}
          <i className="sx-field__ring" aria-hidden="true" />
        </label>
        {!query && !area ? (
          <div className="sx-try">
            <span className="sx-try__label">{t('try.label')}</span>
            <div className="sx-try__scroll">
              {TRY_QUERIES.map(w => (
                <button key={w} type="button" className="sx-try__q" onClick={() => setQ(w)}>
                  {w}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <ChipRow label={t('filters.evidence')} chips={evidence} filters={filters} onToggle={toggle} />
        <ChipRow label={t('filters.hypothesis')} note={t('filters.hypothesisNote')} chips={hypothesis} filters={filters} dotted onToggle={toggle} />
        <div className="sx-meta">
          <b className="sx-meta__n">{t('count', { n: hits.length })}</b>
          <span className="sx-meta__order">{query ? t('order.match') : t('order.popular')}</span>
          {nFilters ? (
            <button type="button" className="sx-meta__clear" onClick={() => setFilters({})}>
              {t('filters.clear')}
            </button>
          ) : null}
          {room ? (
            <span className="sx-meta__room">{t('room.note')}</span>
          ) : (
            <span ref={ballRef} className="sx-ball" data-private="1" data-testid="search-ball">
              <i key={bump} className={`sx-ball__glyph${bump ? ' is-bump' : ''}`} aria-hidden="true" />
              <span className="sx-ball__label">{t('ball.label')}</span>
              <b>{t('ball.faces', { n: faces })}</b>
            </span>
          )}
        </div>
      </div>
      <div
        className="sx__scroll"
        onPointerDown={e => {
          if (e.pointerType === 'touch' && document.activeElement === inputRef.current) inputRef.current?.blur()
        }}
      >
        {area && !room ? <AreaBanner tempo={area.tempo} genre={area.genre} /> : null}
        {body}
      </div>
    </div>
  )
}
