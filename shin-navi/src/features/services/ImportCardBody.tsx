// Import card body (SPEC C-8 #8, stitch frame): the subscription favourites that can be sung here
// as translucent silver discs, only on this phone (lock, data-private). Tap a disc, pick a sung
// version (original preselected), and "save to My Songs" — that moment the disc turns into the
// song's colour and flies to its face on the ball. "Show just this song to the room" puts the
// title on the shared screen for ten seconds. Nothing is ever saved automatically.
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CardBodyComponent, CardBodyProps, SongId, VersionId } from '../../core/types'
import { naviApi, useNavi } from '../../core/store'
import { bus } from '../../core/events'
import { useBox } from '../../core/layout'
import { sound } from '../../core/sound'
import { SongTitle } from '../../core/ui/SongTitle'
import { Icon } from '../../core/ui/Icon'
import { SONG_BY_ID } from '../../data/songs'
import { useTr } from '../../i18n'
import { Disc } from './Disc'
import { versionsFor } from './menu'
import { justLaunched, launchDisc } from './importActions'
import { ShowRoomButton } from './ShowRoomButton'
import { S } from './strings'
import './services.css'

function ImportBody({ card, active, setPrimary }: CardBodyProps) {
  const t = S.useT()
  const tr = useTr()
  const box = useBox()
  const small = box.h < 760 || box.w < 375
  const reduced = useNavi(s => s.ui.reduced)
  const imports = useNavi(s => s.col.imports)
  const saved = useNavi(s => s.col.saved)
  const showing = useNavi(s => (s.room.prompt?.kind === 'show' ? s.room.prompt.songIds[0] ?? null : null))
  const root = useRef<HTMLDivElement>(null)

  // the card's candidates, in the order the director dealt them
  const ids = useMemo(() => {
    const dealt = card.options?.length ? card.options : card.songId ? [card.songId] : []
    // a card dealt without candidates shows the whole shelf that is still waiting
    const list = (dealt.length ? dealt : naviApi.getState().col.imports.filter(i => i.status !== 'saved').map(i => i.songId)).filter(id => SONG_BY_ID[id])
    return list.slice(0, 6)
  }, [card.id])
  const isSaved = (id: SongId) => saved.some(x => x.songId === id && x.from === 'import')
  const firstOpen = ids.find(id => !isSaved(id)) ?? ids[0]
  const [sel, setSel] = useState<SongId | undefined>(firstOpen)
  const [vers, setVers] = useState<Record<SongId, VersionId>>({})
  const [flash, setFlash] = useState<Record<SongId, number>>({})
  const cand = sel ? imports.find(i => i.songId === sel) : undefined
  const versions = versionsFor(cand?.versions ?? (sel ? SONG_BY_ID[sel]?.versions ?? ['original'] : ['original']))
  const version: VersionId = (sel && vers[sel]) || 'original'
  const selSaved = !!sel && isSaved(sel)

  const allSaved = ids.length > 0 && ids.every(isSaved)
  useEffect(() => {
    if (!sel) return
    // once every candidate is in My Songs, the big button just closes the card
    if (allSaved) {
      setPrimary({ action: 'decline', label: S.ref('import.close'), enabled: true })
      return
    }
    setPrimary({
      action: 'save',
      label: selSaved ? S.ref('import.saved') : S.ref('import.save'),
      enabled: !selSaved,
      arg: { songId: sel, version, flightLaunched: true },
    })
  }, [card.id, sel, version, selSaved, allSaved])

  const discEl = (id: SongId) => root.current?.querySelector(`[data-song-id="${CSS.escape(id)}"]`)

  // the save may come from the action bar or an upward flick: throw this card's disc then
  useEffect(
    () =>
      bus.on('card/acted', e => {
        if (e.card.id !== card.id || e.action !== 'save') return
        const id = e.arg?.songId
        if (!id) return
        if (!justLaunched(id)) launchDisc(id, discEl(id))
        setFlash(f => ({ ...f, [id]: (f[id] ?? 0) + 1 }))
        // move on to the next candidate still waiting
        window.setTimeout(() => {
          const st = naviApi.getState()
          const next = ids.find(x => x !== id && !st.col.saved.some(v => v.songId === x && v.from === 'import'))
          if (next) setSel(next)
        }, reduced ? 200 : 650)
      }),
    [card.id, ids, reduced],
  )

  const pick = (id: SongId) => {
    if (id === sel) return
    setSel(id)
    sound.play('tap')
  }
  const pickVersion = (v: VersionId) => {
    if (!sel) return
    setVers(m => ({ ...m, [sel]: v }))
    sound.play('tap')
  }
  const openAll = () => naviApi.getState().openSheet('import', { cardId: card.id })

  const discSize = small ? 40 : 46
  const song = sel ? SONG_BY_ID[sel] : undefined
  return (
    <div className={`imp${small ? ' is-small' : ''}`} ref={root} data-private="1" data-active={active ? '1' : '0'}>
      <div className="imp__lead" data-testid="card-reason">
        <span className="imp__leadtext">{t('import.lead', { n: ids.length })}</span>
        <span className="imp__src">{t('import.src')}</span>
      </div>
      <div className="imp__shelf" role="group" aria-label={tr(card.reason.text)}>
        {ids.map(id => (
          <Disc
            key={id}
            songId={id}
            size={discSize}
            selected={id === sel}
            saved={isSaved(id)}
            flash={flash[id]}
            showing={showing === id}
            reduced={reduced}
            label={SONG_BY_ID[id]?.title}
            onClick={() => pick(id)}
          />
        ))}
      </div>
      <AnimatePresence mode="wait" initial={false}>
        {song ? (
          <motion.div key={song.id} className="imp__now" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }}>
            <SongTitle songId={song.id} variant="chip" className="imp__title" />
            <span className="imp__artist">{song.artist}</span>
          </motion.div>
        ) : null}
      </AnimatePresence>
      {selSaved ? (
        <div className="imp__vers">
          <span className="imp__savedtag">
            <Icon name="sparkle" size={13} strokeWidth={2} />
            {t('import.saved')}
            <em>{tr({ key: `vocab.version.${saved.find(x => x.songId === sel)?.version ?? 'original'}` })}</em>
          </span>
        </div>
      ) : (
        <div className="imp__vers" role="radiogroup" aria-label={t('import.version')}>
          {versions.map(v => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={v === version}
              className={`imp-ver${v === version ? ' is-on' : ''}`}
              data-testid="import-version"
              data-version={v}
              disabled={selSaved}
              onClick={() => pickVersion(v)}
            >
              {v === version ? <i className="imp-ver__dot" aria-hidden="true" /> : null}
              {tr({ key: `vocab.version.${v}` })}
            </button>
          ))}
        </div>
      )}
      {!small ? (
        <p className="imp__priv">
          <Icon name="lock" size={11} strokeWidth={2.2} />
          {t('import.private')}
          <i aria-hidden="true" />
          {t('import.noAutoShort')}
        </p>
      ) : null}
      <div className="imp__foot">
        <ShowRoomButton songId={sel} cardId={card.id} />
        <button type="button" className="imp-all" data-testid="import-all" onClick={openAll} aria-label={t('import.all')} title={t('import.all')}>
          <svg width="26" height="18" viewBox="0 0 26 18" aria-hidden="true">
            <circle cx="8" cy="9" r="7" fill="none" stroke="currentColor" strokeWidth="1.4" opacity="0.5" />
            <circle cx="13" cy="9" r="7" fill="none" stroke="currentColor" strokeWidth="1.4" opacity="0.75" />
            <circle cx="18" cy="9" r="7" fill="rgba(255,255,255,0.12)" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="18" cy="9" r="1.8" fill="currentColor" />
          </svg>
        </button>
      </div>
    </div>
  )
}

export const ImportCardBody: CardBodyComponent = p => <ImportBody {...p} />
