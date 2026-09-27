// Voice log (SPEC D-11): one colour orb per voice check, newest first, with the reading's type
// name ("this time") and the date. The note is always there: a voice changes with the song and
// the day — never a fixed label.
import type { CSSProperties } from 'react'
import type { VoiceReading } from '../../core/types'
import { useLocale, useTr, varText } from '../../i18n'
import { VoiceOrb } from '../../core/ui/VoiceOrb'
import { R } from './strings'

const TYPE_COLOR: Record<VoiceReading['type'], string> = { clear: '#7FE7FF', power: '#FF5A36', groove: '#C6FF3D', emotional: '#C77DFF' }

export function VoiceLog({ voices }: { voices: VoiceReading[] }) {
  const t = R.useT()
  const tr = useTr()
  const l = useLocale()
  const list = [...voices].reverse()
  return (
    <div className="rc-voice">
      <div className="rc-voice__row">
        {list.map((v, i) => (
          <div key={`${v.nightId}-${v.at}-${i}`} className={`rc-voice__item${i === 0 ? ' is-latest' : ''}`} style={{ ['--vc' as string]: TYPE_COLOR[v.type] }}>
            <VoiceOrb reading={v} size={i === 0 ? 64 : 48} />
            <span className="rc-voice__type">{tr({ key: `vocab.voice.${v.type}` })}</span>
            <span className="rc-voice__date">{varText({ date: v.at }, l)}</span>
          </div>
        ))}
      </div>
      {list[0] ? (
        <>
          <p className="rc-voice__was">{t('voice.was', { type: tr({ key: `vocab.voice.${list[0].type}` }) })}</p>
          <div className="rc-voice__bars">
            {(
              [
                ['power', list[0].power, '#FF4D4D'],
                ['care', list[0].care, '#4D8BFF'],
                ['bright', list[0].brightness, '#FFD84D'],
              ] as const
            ).map(([k, v, c]) => (
              <span key={k} className="rc-voice__bar" style={{ ['--bc' as string]: c } as CSSProperties}>
                <span className="rc-voice__bk">{t(`voice.${k}`)}</span>
                <span className="rc-voice__track">
                  <i style={{ transform: `scaleX(${Math.max(0.04, Math.min(1, v)).toFixed(3)})` }} />
                </span>
              </span>
            ))}
          </div>
        </>
      ) : null}
      <p className="rc-voice__note">{t('voice.note')}</p>
    </div>
  )
}
