// One shell, twelve silhouettes (SPEC C-7). The shell draws the frame (clip + rim + static
// glow + frame ornaments), the kind label and the evidence side ("the back"); a card body
// fills the front. Glow is a pre-drawn stroke layer whose opacity is the only thing that moves.
import { memo, type CSSProperties, type ReactNode, type UIEvent } from 'react'
import { motion, type MotionValue } from 'motion/react'
import type { CardFrame, DeckCard, Reason, Source, SongId } from '../../core/types'
import { useNavi } from '../../core/store'
import { Chip } from '../../core/ui/Chip'
import { SongTitle } from '../../core/ui/SongTitle'
import { SONG_BY_ID, decadeOf } from '../../data/songs'
import { palette } from '../../lib/art'
import { rangeFit } from '../../engine/reading'
import { useTr } from '../../i18n'
import { FRAMES, framePath, glyphOf, kindAccent, kindCode, kindKey, teaserKey } from './frames'
import { KindGlyph } from './KindGlyph'
import { getNaviPick, setNaviPick, useNaviPick } from './naviPick'
import { S, type CardsKey } from './strings'

// ---------------------------------------------------------------- source glyphs

/** Where a reason comes from, as a glyph (never the kanji of the internal framework). */
export function SourceGlyph({ source, size = 14 }: { source: Source; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true, className: 'src-glyph', 'data-source': source }
  switch (source) {
    case 'dare':
      return (
        <svg {...common}>
          <circle cx="8" cy="5.2" r="2.6" />
          <path d="M3 14c.6-3 2.6-4.6 5-4.6s4.4 1.6 5 4.6" />
        </svg>
      )
    case 'tsunagu':
      return (
        <svg {...common}>
          <circle cx="3.6" cy="11.6" r="1.8" fill="currentColor" stroke="none" />
          <circle cx="12.4" cy="4.4" r="1.8" fill="currentColor" stroke="none" />
          <path d="M4.9 10.4L11.1 5.6" />
        </svg>
      )
    case 'yomu':
      return (
        <svg {...common}>
          <path d="M1.5 9c1.6-3.6 3.3-3.6 4.9 0s3.3 3.6 4.9 0 2.4-2.6 3.2-1.4" />
        </svg>
      )
    case 'hou':
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6" />
          <circle cx="8" cy="8" r="3.6" strokeDasharray="1.4 1.3" />
          <path d="M8 6.2v3.6M6.2 8h3.6" />
        </svg>
      )
    case 'ren':
      return (
        <svg {...common}>
          <circle cx="5" cy="8" r="2.8" />
          <path d="M7.8 8H14.5M12.2 8v2.4M14.5 8v1.8" />
        </svg>
      )
    case 'voice':
      return (
        <svg {...common}>
          <path d="M5 2v5.2a3 3 0 0 0 6 0V2" />
          <path d="M8 10.2V15" />
        </svg>
      )
  }
}

/** The reason line: source glyph, the reason, and the cause when an event inserted the card. */
export function ReasonLine({ reason, testid = 'card-reason', className }: { reason: Reason; testid?: string; className?: string }) {
  const t = useTr()
  return (
    <div className={`reason ${className ?? ''}`} data-testid={testid}>
      <span className="reason__glyph">
        <SourceGlyph source={reason.source} />
      </span>
      <span className="reason__text">
        {t(reason.text)}
        {reason.cause ? <span className="reason__cause">{t(reason.cause)}</span> : null}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------- kind label

export function KindLabel({ card, align }: { card: DeckCard; align: 'left' | 'center' }) {
  const t = S.useT()
  return (
    <div className={`cs__label cs__label--${align}`} data-code={kindCode(card)}>
      <KindGlyph id={glyphOf(card)} size={14} />
      <span className="cs__kname">{t(kindKey(card))}</span>
    </div>
  )
}

/** The teaser on a peeking edge: glyph + what kind of card is next (never its content). */
function PeekTag({ card, scale }: { card: DeckCard; scale: number }) {
  const t = S.useT()
  const text = t(teaserKey(card), card.from ? { name: { member: card.from } } : undefined)
  return (
    <span className="cs__peektag" style={{ ['--pk' as string]: (1 / (scale || 1)).toFixed(3) } as CSSProperties} data-testid="peek-teaser">
      <KindGlyph id={glyphOf(card)} size={13} />
      <span className="cs__peektext">{text}</span>
    </span>
  )
}

// ---------------------------------------------------------------- frame ornaments

function Ornaments({ frame, w, h, card }: { frame: CardFrame; w: number; h: number; card: DeckCard }) {
  const members = useNavi(s => s.room.members)
  switch (frame) {
    case 'passport':
      return (
        <svg className="cs__orn" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
          <rect x="11" y="11" width={w - 22} height={h - 22} rx="3" className="orn-visa" />
          <rect x="15" y="15" width={w - 30} height={h - 30} rx="2" className="orn-visa orn-visa--thin" />
        </svg>
      )
    case 'medallion': {
      const r = Math.min(w, h) / 2
      return (
        <svg className="cs__orn" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
          <circle cx={w / 2} cy={h / 2} r={r - 9} className="orn-line" />
          <circle cx={w / 2} cy={h / 2} r={r - 30} className="orn-line orn-line--faint" />
        </svg>
      )
    }
    case 'arch': {
      const R = w / 2
      const i = 9
      return (
        <svg className="cs__orn" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
          <path d={`M${i},${h - 14} V${R} A${R - i},${R - i} 0 0 1 ${w - i},${R} V${h - 14}`} className="orn-line" />
          <path d={`M${i + 9},${h - 20} V${R} A${R - i - 9},${R - i - 9} 0 0 1 ${w - i - 9},${R} V${h - 20}`} className="orn-line orn-line--faint" />
        </svg>
      )
    }
    case 'ticket': {
      const px = w * 0.75
      const from = card.from ? members[card.from]?.color : undefined
      return (
        <>
          <div className="cs__stub" style={{ left: px, ['--from' as string]: from ?? '#FF3DA8' } as CSSProperties}>
            <span className="cs__stublight" />
          </div>
          <svg className="cs__orn" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
            <path d={`M${px},12 V${h - 12}`} className="orn-perf" />
          </svg>
        </>
      )
    }
    case 'stitch': {
      const T = 18
      const i = 9
      return (
        <>
          <svg className="cs__orn" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
            <rect x={i} y={T + i} width={w - i * 2} height={h - T - i * 2} rx="11" className="orn-stitch" />
          </svg>
          <span className="cs__key" style={{ left: w - 22 - 60 }} aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <rect x="3.5" y="7" width="9" height="7" rx="1.6" />
              <path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" />
            </svg>
          </span>
        </>
      )
    }
    case 'coaster':
      return (
        <svg className="cs__orn" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
          <circle cx={w * 0.56} cy={h * 0.47} r={Math.min(w, h) * 0.36} className="orn-ring" />
          <circle cx={w * 0.53} cy={h * 0.5} r={Math.min(w, h) * 0.33} className="orn-ring orn-ring--b" />
        </svg>
      )
    case 'triptych': {
      const sw = w * 0.28
      const cr = (w - 2 * sw) / 2
      const sr = sw / 2
      const syc = cr * 0.62 + sr
      const i = 8
      return (
        <svg className="cs__orn" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
          <path d={`M${sw + i},${h - 12} V${cr} A${cr - i},${cr - i} 0 0 1 ${w - sw - i},${cr} V${h - 12}`} className="orn-gold" />
          <path d={`M${i},${h - 12} V${syc} A${sr - i},${sr - i} 0 0 1 ${sw - i},${syc} V${h - 12}`} className="orn-gold orn-gold--faint" />
          <path d={`M${w - sw + i},${h - 12} V${syc} A${sr - i},${sr - i} 0 0 1 ${w - i},${syc} V${h - 12}`} className="orn-gold orn-gold--faint" />
        </svg>
      )
    }
    case 'pill':
      return (
        <svg className="cs__orn" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
          <rect x="7" y="7" width={w - 14} height={h - 14} rx={(h - 14) / 2} className="orn-line orn-line--faint" />
        </svg>
      )
    case 'constellation':
      return (
        <svg className="cs__orn" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
          {STARS.map((s, k) => (
            <circle key={k} cx={s[0] * w} cy={s[1] * h} r={s[2]} className="orn-star" />
          ))}
        </svg>
      )
    case 'facet':
      return (
        <svg className="cs__orn" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
          <path d={`M${w * 0.08},${h * 0.2} L${w * 0.62},${h * 0.9}`} className="orn-sheen" />
          <path d={`M${w * 0.3},${h * 0.06} L${w * 0.84},${h * 0.72}`} className="orn-sheen orn-sheen--b" />
        </svg>
      )
    default:
      return null
  }
}

const STARS: [number, number, number][] = [
  [0.08, 0.14, 1.2],
  [0.93, 0.1, 1],
  [0.18, 0.86, 1.1],
  [0.86, 0.8, 1.3],
  [0.52, 0.05, 0.9],
  [0.04, 0.52, 0.8],
  [0.97, 0.46, 0.9],
  [0.66, 0.95, 0.8],
]

// ---------------------------------------------------------------- the back (evidence side)

function keyLabel(shift: number): string {
  if (shift === 0) return '0'
  return shift < 0 ? `${String.fromCharCode(0x266d)}${-shift}` : `${String.fromCharCode(0x266f)}${shift}`
}

/** Mechanism / privacy fine print that stays off the card front (card-front contract). */
function fineKeys(card: DeckCard): CardsKey[] {
  switch (card.kind) {
    case 'song':
      return ['fine.navi']
    case 'ask':
      return ['fine.ask']
    case 'link':
      return ['fine.link']
    case 'import':
      return ['fine.import']
    case 'voice':
      return ['fine.voice']
    case 'invite':
      return card.variant === 'twin' ? ['fine.twin'] : card.variant === 'duet' ? ['fine.duet'] : ['fine.request']
    default:
      return []
  }
}

function BackNaviToggle({ card }: { card: DeckCard }) {
  const t = S.useT()
  const on = useNaviPick(card.id, card.variant === 'opener')
  return (
    <motion.button
      type="button"
      role="switch"
      aria-checked={on}
      className={`navi-toggle navi-toggle--back${on ? ' is-on' : ''}`}
      data-testid="navi-toggle"
      data-anchor="navi-tag"
      onClick={() => setNaviPick(card.id, !getNaviPick(card.id, card.variant === 'opener'))}
      whileTap={{ scale: 0.95 }}
    >
      <span className="navi-toggle__knob" aria-hidden="true" />
      <span className="navi-toggle__text">{t('naviToggle')}</span>
    </motion.button>
  )
}

export function CardBack({ card, songId }: { card: DeckCard; songId?: SongId }) {
  const t = S.useT()
  const trr = useTr()
  const voice = useNavi(s => s.col.voices[s.col.voices.length - 1] ?? null)
  // the dealer's rule id is planner vocabulary: only with the planning lens on (SPEC 裁定7)
  const lens = useNavi(s => s.ui.lens)
  const song = songId ? SONG_BY_ID[songId] : undefined
  const fit = song && voice?.range ? rangeFit(song, voice.range) : null
  const vocab = (k: string) => trr({ key: `vocab.${k}` })
  const fine = fineKeys(card)
  const naviHere = card.kind === 'song' && card.variant !== 'opener' && !!song?.reservable
  return (
    <div className="cback">
      <div className="cback__why">
        <div className="cback__h">{t('back.why')}</div>
        <div className="cback__src">
          <SourceGlyph source={card.reason.source} size={13} />
          <span>{t(`source.${card.reason.source}` as Parameters<typeof t>[0])}</span>
        </div>
        <div className="cback__reason">
          {trr(card.reason.text)}
          {card.reason.cause ? <span className="cback__cause">{trr(card.reason.cause)}</span> : null}
        </div>
        {lens ? (
          <div className="cback__rule" data-testid="card-rule">
            {t('back.rule', { rule: card.rule })}
          </div>
        ) : null}
      </div>
      {naviHere ? <BackNaviToggle card={card} /> : null}
      {fine.length ? (
        <div className="cback__sec cback__fine" data-testid="card-fine">
          <div className="cback__k">{t('back.how')}</div>
          {fine.map(k => (
            <p key={k} className="cback__fineline">
              {t(k)}
            </p>
          ))}
        </div>
      ) : null}
      {song ? (
        <>
          <div className="cback__song">
            <SongTitle songId={song.id} variant="chip" />
            <span className="cback__artist">{song.artist}</span>
          </div>
          <div className="cback__sec">
            <div className="cback__k">{t('back.evidence')}</div>
            <div className="cback__chips">
              <Chip size="sm">{vocab(`genre.${song.genre}`)}</Chip>
              <Chip size="sm">{t('decade', { d: decadeOf(song).replace('s', '') })}</Chip>
              <Chip size="sm">{vocab(`tempo.${song.tempo}`)}</Chip>
              <Chip size="sm">{vocab(`lang.${song.lang}`)}</Chip>
            </div>
          </div>
          <div className="cback__sec">
            <div className="cback__k cback__k--hyp">{t('back.hypothesis')}</div>
            <div className="cback__chips">
              {song.tags.hypothesis.slice(0, 4).map(v => (
                <Chip key={v} size="sm" dotted>
                  {vocab(`vibe.${v}`)}
                </Chip>
              ))}
            </div>
          </div>
          <dl className="cback__facts">
            <dt>{t('back.versions')}</dt>
            <dd>{song.versions.map(v => vocab(`version.${v}`)).join(' / ')}</dd>
            <dt>{t('back.lang')}</dt>
            <dd>{vocab(`lang.${song.lang}`)}</dd>
            <dt>{t('back.reservable')}</dt>
            <dd className={song.reservable ? 'is-ok' : 'is-no'}>{song.reservable ? t('back.canReserve') : t('back.cannotReserve')}</dd>
            {fit ? (
              <>
                <dt>{t('back.key')}</dt>
                <dd>{fit.shift === 0 ? t('back.keyOriginal') : t('back.keyValue', { k: keyLabel(fit.shift) })}</dd>
              </>
            ) : null}
          </dl>
        </>
      ) : null}
      <div className="cback__foot">{t('back.tapBack')}</div>
    </div>
  )
}

// ---------------------------------------------------------------- the shell

export type CardShellProps = {
  card: DeckCard
  frame: CardFrame
  w: number
  h: number
  small?: boolean
  role: 'top' | 'peek' | 'token'
  /** evidence side showing */
  flipped?: boolean
  /** body (front) */
  children?: ReactNode
  /** layers above the body inside the silhouette (drag hints, mist) */
  overlay?: ReactNode
  /** glow layer opacity (a MotionValue while dragging) */
  glow?: MotionValue<number> | number
  /** song for the back side (selection or card song) */
  backSong?: SongId
  className?: string
  /** peeks: the pose scale, so the teaser can counter-scale and stay >= 12 px */
  peekScale?: number
}

/** Focus inside a body (a chip, a button) must never scroll the clipped face (DEMO#6). */
function unscroll(e: UIEvent<HTMLDivElement>) {
  const el = e.currentTarget
  if (el.scrollTop || el.scrollLeft) {
    el.scrollTop = 0
    el.scrollLeft = 0
  }
}

function ShellImpl({ card, frame, w, h, small, role, flipped = false, children, overlay, glow, backSong, className, peekScale = 1 }: CardShellProps) {
  const spec = FRAMES[frame]
  const d = framePath(frame, w, h)
  const accent = kindAccent(card)
  const k = small ? 0.88 : 1
  const songish = !!card.songId && (card.kind === 'song' || card.kind === 'ask')
  const pal = card.songId ? palette(card.songId, SONG_BY_ID[card.songId]?.energy ?? 0.5) : null
  const vars = {
    width: w,
    height: h,
    '--accent': accent,
    '--cs-pt': `${Math.round(spec.pad[0] * k)}px`,
    '--cs-px': `${Math.round(spec.pad[1] * k)}px`,
    '--cs-pb': `${Math.round(spec.pad[2] * k)}px`,
    '--cs-stub': spec.stub ? `${Math.round(w * spec.stub)}px` : '0px',
    '--pal-a': pal?.a,
    '--pal-b': pal?.b,
    '--pal-deep': pal?.deep,
  } as CSSProperties
  const clip = { clipPath: `path('${d}')`, WebkitClipPath: `path('${d}')` } as CSSProperties
  const peek = role === 'peek'
  const bgStyle = peek && pal && songish ? ({ background: pal.bg } as CSSProperties) : undefined
  return (
    <div className={`cs cs--${frame} cs--${role} ${flipped ? 'is-flipped' : ''} ${className ?? ''}`} style={vars} data-frame={frame}>
      {role === 'top' ? <div className="cs__shadow" aria-hidden="true" /> : null}
      <motion.svg className="cs__glow" width={w + 40} height={h + 40} viewBox={`-20 -20 ${w + 40} ${h + 40}`} aria-hidden="true" style={{ opacity: glow ?? (peek ? 0.55 : 0.6) }}>
        <path d={d} className="glow-3" />
        <path d={d} className="glow-2" />
        <path d={d} className="glow-1" />
      </motion.svg>
      <div className="cs__flip">
        <div className="cs__side cs__side--front">
          <div className="cs__face" style={clip} onScroll={unscroll}>
            <div className="cs__bg" style={bgStyle} />
            {peek ? <div className="cs__tint" aria-hidden="true" /> : null}
            {role === 'top' ? <div className="cs__sheen" aria-hidden="true" /> : null}
            {role !== 'token' ? (
              <>
                {!peek ? <div className="cs__body">{children}</div> : null}
                <Ornaments frame={frame} w={w} h={h} card={card} />
                {peek ? <PeekTag card={card} scale={peekScale} /> : <KindLabel card={card} align={spec.labelAlign} />}
                {overlay}
              </>
            ) : (
              children
            )}
          </div>
          <svg className="cs__rim" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
            <path d={d} />
          </svg>
        </div>
        {role === 'top' ? (
          <div className="cs__side cs__side--back" aria-hidden={!flipped}>
            <div className="cs__face cs__face--back" style={clip}>
              <div className="cs__bg cs__bg--back" />
              {flipped ? <CardBack card={card} songId={backSong} /> : null}
            </div>
            <svg className="cs__rim" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
              <path d={d} />
            </svg>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export const CardShell = memo(ShellImpl)
