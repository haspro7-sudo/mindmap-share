// Night page (SPEC D-9, F-1 S12 night): that night's stamp and name, its wall of light drawn
// again, its melody, and the songs I sang (roommates' songs are never mixed into mine).
import { motion } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Night } from '../../core/types'
import { useNavi } from '../../core/store'
import { sound } from '../../core/sound'
import { Icon } from '../../core/ui/Icon'
import { SongTitle } from '../../core/ui/SongTitle'
import { SPRING } from '../../core/ui/motion'
import { SONG_BY_ID } from '../../data/songs'
import { useLocale, useTr, varText } from '../../i18n'
import { FaceSwatch, StampArt } from './parts'
import { WallConstellation } from './WallConstellation'
import { useNightName } from './useNight'
import { MelodyNotes } from './Melody'
import { R } from './strings'

export function NightSheet(): JSX.Element {
  const arg = useNavi(s => s.ui.sheet?.arg as { nightId?: string } | undefined)
  const night = useNavi(s => s.col.nights.find(n => n.id === arg?.nightId))
  if (!night) return <div className="rc-ns" />
  return <NightBody night={night} />
}

function NightBody({ night }: { night: Night }) {
  const t = R.useT()
  const tr = useTr()
  const l = useLocale()
  const faces = useNavi(s => s.col.faces)
  const name = useNightName(night)!
  const box = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(340)
  const [playKey, setPlayKey] = useState(0)
  const stopRef = useRef<(() => void) | null>(null)
  useLayoutEffect(() => {
    if (box.current?.clientWidth) setW(box.current.clientWidth)
  }, [])
  useEffect(() => () => stopRef.current?.(), [])

  const mine = night.points.filter(p => p.by === 'me')
  const songs = [...new Set(mine.map(p => p.songId))]
  const play = () => {
    stopRef.current?.()
    stopRef.current = sound.playMelody(night.melody)
    setPlayKey(k => k + 1)
  }

  return (
    <div className="rc-ns" data-testid="night-detail" data-night={night.id}>
      <div className="rc-ns__head">
        <motion.div initial={{ scale: 0.6, opacity: 0, rotate: -20 }} animate={{ scale: 1, opacity: 1, rotate: 0 }} transition={SPRING.soft}>
          <StampArt night={night} size={84} />
        </motion.div>
        <div className="rc-ns__title">
          <span className="rc-ns__date">
            {t('night.date', { date: varText({ date: night.startedAt }, l) })}
            {night.seeded ? <span className="rc-badge is-demo">{t('nights.demo')}</span> : null}
          </span>
          <b className="rc-ns__name">{tr(name)}</b>
        </div>
      </div>

      <div className="rc-ns__wall" ref={box}>
        <WallConstellation night={night} width={w} height={Math.round(Math.min(190, w * 0.52))} draw />
      </div>

      {night.melody.length ? (
        <div className="rc-ns__melody">
          <MelodyNotes notes={night.melody} playKey={playKey} palette={night.palette} />
          <button type="button" className="rc-ghost-btn" data-testid="night-melody-play" onClick={play}>
            <Icon name="speaker" size={18} />
            {t('night.play')} · {t('night.notes', { n: night.melody.length })}
          </button>
        </div>
      ) : null}

      <h4 className="rc-sub">{t('night.mine')}</h4>
      {songs.length ? (
        <ul className="rc-ns__songs">
          {songs.map(id => (
            <li key={id} className="rc-ns__song">
              <FaceSwatch state={faces[id]?.state ?? 'dark'} songId={id} size={26} marks={faces[id]?.marks} />
              <span className="rc-ns__songtxt">
                <SongTitle songId={id} variant="chip" />
                <span className="rc-ns__artist">{SONG_BY_ID[id]?.artist}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rc-empty is-small">{t('night.none')}</p>
      )}

      {night.facesGained.length ? (
        <>
          <h4 className="rc-sub">
            {t('night.faces')} <span className="rc-sub__n">{t('nights.faces', { n: night.facesGained.length })}</span>
          </h4>
          <div className="rc-ns__tiles">
            {night.facesGained.slice(0, 40).map(id => (
              <FaceSwatch key={id} state={faces[id]?.state ?? 'sketch'} songId={id} size={22} />
            ))}
          </div>
        </>
      ) : null}
    </div>
  )
}
