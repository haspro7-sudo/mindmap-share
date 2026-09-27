// S8 bring-in sheet (SPEC F-1, C-8 #8, E-12). The whole shelf of subscription favourites that
// can be sung here (demo data), only on this phone. Pick a disc, pick the sung version, save it
// to My Songs (the disc takes its colour and flies to the ball), or show just its title on the
// room screen for ten seconds. Saving is always an explicit tap; nothing is saved on its own.
import { AnimatePresence, motion } from 'motion/react'
import { useMemo, useRef, useState } from 'react'
import type { SongId, VersionId } from '../../core/types'
import { naviApi, useNavi } from '../../core/store'
import { sound } from '../../core/sound'
import { SongTitle } from '../../core/ui/SongTitle'
import { Icon } from '../../core/ui/Icon'
import { SPRING } from '../../core/ui/motion'
import { SONG_BY_ID } from '../../data/songs'
import { useTr } from '../../i18n'
import { Disc } from './Disc'
import { versionsFor } from './menu'
import { saveCandidate, showToRoom, SHOW_MS } from './importActions'
import { S } from './strings'
import './services.css'

export function ImportSheet(): JSX.Element {
  const t = S.useT()
  const tr = useTr()
  const reduced = useNavi(s => s.ui.reduced)
  const imports = useNavi(s => s.col.imports)
  const saved = useNavi(s => s.col.saved)
  const arg = useNavi(s => s.ui.sheet?.arg) as { cardId?: string; songId?: SongId } | undefined
  const showing = useNavi(s => (s.room.prompt?.kind === 'show' ? s.room.prompt.songIds[0] ?? null : null))
  const busy = useNavi(s => !!s.room.prompt && s.room.prompt.kind !== 'show')
  const live = useNavi(s => s.session.phase === 'live')
  const root = useRef<HTMLDivElement>(null)

  const ids = useMemo(() => imports.map(i => i.songId).filter(id => SONG_BY_ID[id]), [imports])
  const isSaved = (id: SongId) => saved.some(x => x.songId === id && x.from === 'import')
  const [sel, setSel] = useState<SongId | undefined>(() => arg?.songId ?? ids.find(id => !isSaved(id)) ?? ids[0])
  const [vers, setVers] = useState<Record<SongId, VersionId>>({})
  const [flash, setFlash] = useState<Record<SongId, number>>({})
  const cand = sel ? imports.find(i => i.songId === sel) : undefined
  const versions = versionsFor(cand?.versions ?? ['original'])
  const version: VersionId = (sel && vers[sel]) || 'original'
  const selSaved = !!sel && isSaved(sel)
  const savedCount = saved.length
  const allSaved = ids.length > 0 && ids.every(isSaved)
  const song = sel ? SONG_BY_ID[sel] : undefined
  const showingSel = !!sel && showing === sel

  const discEl = (id: SongId) => root.current?.querySelector(`[data-song-id="${CSS.escape(id)}"]`)

  const save = () => {
    if (!sel || selSaved) return
    const id = sel
    saveCandidate(naviApi, id, version, discEl(id), arg?.cardId)
    setFlash(f => ({ ...f, [id]: (f[id] ?? 0) + 1 }))
    window.setTimeout(() => {
      const st = naviApi.getState()
      const next = ids.find(x => x !== id && !st.col.saved.some(v => v.songId === x && v.from === 'import'))
      if (next) setSel(next)
    }, reduced ? 200 : 700)
  }

  return (
    <div className="imps" ref={root} data-private="1" data-testid="import-sheet">
      <header className="imps__head">
        <div className="svc-eyebrow">BRING-IN · SUBSCRIPTION (DEMO)</div>
        <div className="imps__titlerow">
          <h2 className="imps__title">{t('import.title')}</h2>
          <span className="imps__lock">
            <Icon name="lock" size={13} strokeWidth={2} />
            {t('import.private')}
          </span>
        </div>
        <p className="imps__lead">
          {t('import.lead', { n: ids.length })}
          <span className="imps__src">{t('import.src')}</span>
        </p>
      </header>

      <div className="imps__shelf">
        {ids.map(id => (
          <div key={id} className={`imps__slot${id === sel ? ' is-sel' : ''}`}>
            <Disc
              songId={id}
              size={54}
              rise
              selected={id === sel}
              saved={isSaved(id)}
              flash={flash[id]}
              showing={showing === id}
              reduced={reduced}
              label={SONG_BY_ID[id]?.title}
              onClick={() => {
                if (id !== sel) sound.play('tap')
                setSel(id)
              }}
            />
            <span className="imps__slotname">
              <SongTitle songId={id} variant="chip" />
            </span>
            <span className={`imps__slotstate${isSaved(id) ? ' is-saved' : ''}`}>{isSaved(id) ? t('import.savedShort') : t('import.candidate')}</span>
          </div>
        ))}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {song ? (
          <motion.section key={song.id} className="imps__detail" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }}>
            <div className="imps__now">
              <SongTitle songId={song.id} variant="chip" className="imps__nowtitle" />
              <span className="imps__artist">{song.artist}</span>
            </div>
            <div className="imps__k">{t('import.version')}</div>
            <div className="imp__vers imps__vers" role="radiogroup" aria-label={t('import.version')}>
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
                  onClick={() => {
                    setVers(m => ({ ...m, [song.id]: v }))
                    sound.play('tap')
                  }}
                >
                  {v === version ? <i className="imp-ver__dot" aria-hidden="true" /> : null}
                  {tr({ key: `vocab.version.${v}` })}
                </button>
              ))}
            </div>
            <motion.button
              type="button"
              className={`imps__save${selSaved ? ' is-done' : ''}`}
              data-testid="import-save"
              disabled={selSaved}
              whileTap={selSaved ? undefined : { scale: 0.96 }}
              transition={SPRING.snappy}
              onClick={save}
            >
              <span className="imps__saveglow" aria-hidden="true" />
              <Icon name={selSaved ? 'sparkle' : 'plus'} size={18} strokeWidth={2.2} />
              {selSaved ? t('import.saved') : t('import.save')}
            </motion.button>
            <button
              type="button"
              className={`imp-show imps__show${showingSel ? ' is-on' : ''}`}
              data-testid="import-show"
              disabled={!live || busy || (!!showing && !showingSel)}
              onClick={() => sel && showToRoom(naviApi, sel, arg?.cardId)}
            >
              <span className="imp-show__icon" aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="1.5" y="2.5" width="13" height="8.5" rx="1.6" />
                  <path d="M5.5 14h5M8 11v3" />
                </svg>
              </span>
              <span className="imp-show__text">{showingSel ? t('import.showing') : busy ? t('import.showBusy') : t('import.show')}</span>
              {showingSel ? <span key={showing} className="imp-show__bar" style={{ animationDuration: `${SHOW_MS}ms` }} aria-hidden="true" /> : null}
            </button>
          </motion.section>
        ) : (
          <p key="empty" className="imps__empty">{t('import.pickOne')}</p>
        )}
      </AnimatePresence>

      <footer className="imps__foot">
        {allSaved ? <p className="imps__done">{t('import.done')}</p> : null}
        <p>{t('import.noAuto')}</p>
        <p>{t('import.next')}</p>
        {savedCount ? <p className="imps__count">{t('import.count', { n: savedCount })}</p> : null}
      </footer>
    </div>
  )
}
