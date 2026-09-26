// M9 record-wrap — PHASE-0 STUB (owned by M9 from phase 1). Public API per SPEC L/M9.
import { createElement as h, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { Night, SongId, TextRef } from '../../core/types'
import { PIN_IDS } from '../../core/types'
import { useNavi, naviApi } from '../../core/store'
import { selFaceStats } from '../../core/selectors'
import { StubBox } from '../../core/ui/StubBox'
import { Button } from '../../core/ui/Button'
import { common } from '../../i18n/common'
import '../../styles/stubs.css'

export function RecordScreen(p: { ball: ReactNode }): JSX.Element {
  const st = useNavi(useShallow(selFaceStats))
  const pins = useNavi(useShallow(s => s.col.pins.map(x => x.id)))
  return h(
    'div',
    { className: 'stub-record', 'data-testid': 'record-screen', 'data-anchor': 'record', 'data-private': '1' },
    h('div', { className: 'stub-record__ball' }, p.ball),
    h(
      'div',
      { className: 'stub-record__stats' },
      (['sketch', 'neon', 'mirror', 'prism'] as const).map(k => h('span', { key: k, className: `stub-record__stat is-${k}` }, h('b', null, st[k]), k)),
    ),
    h(
      'div',
      { className: 'stub-record__pins' },
      PIN_IDS.map(id => h('span', { key: id, className: `stub-pin${pins.includes(id) ? ' is-earned' : ''}`, 'data-testid': 'pin', 'data-id': id, 'data-earned': pins.includes(id) ? '1' : '0' })),
    ),
    h(StubBox, { name: 'RecordScreen', module: 'M9', quiet: true }),
  )
}

export function FaceDetailSheet(): JSX.Element {
  return h(StubBox, { name: 'FaceDetailSheet', module: 'M9', className: 'stub-sheetbody' })
}

export function NightSheet(): JSX.Element {
  return h(StubBox, { name: 'NightSheet', module: 'M9', className: 'stub-sheetbody' })
}

export function WallConstellation(p: { night: Night; width: number; height: number; draw?: boolean; publicOnly?: boolean }): JSX.Element {
  const pts = p.night.points
  const max = Math.max(1, ...pts.map(x => x.t))
  return h(
    'svg',
    { className: 'stub-constellation', width: p.width, height: p.height, viewBox: `0 0 ${p.width} ${p.height}`, 'aria-hidden': true },
    pts.map((pt, i) => h('circle', { key: i, cx: 8 + (pt.t / max) * (p.width - 16), cy: p.height - 8 - pt.heat * (p.height - 16), r: 3, fill: '#FFF6D8' })),
  )
}

export function WrapOverlay(p: { renderBall: (o: { flashSongIds: SongId[] }) => ReactNode }): JSX.Element {
  const t = common.useT()
  const gained = useNavi(useShallow(s => s.col.nights.find(n => n.id === s.session.nightId)?.facesGained ?? []))
  return h(
    'div',
    { className: 'stub-wrap', 'data-testid': 'wrap', 'data-anchor': 'wrap', 'data-private': '1' },
    p.renderBall({ flashSongIds: gained }),
    h(Button, { kind: 'primary', onClick: () => naviApi.getState().closeNight({ linked: false }), testid: 'wrap-nosave' }, t('close')),
    h(StubBox, { name: 'WrapOverlay', module: 'M9', quiet: true }),
  )
}

export function SurveySheet(): JSX.Element {
  return h(StubBox, { name: 'SurveySheet', module: 'M9', className: 'stub-sheetbody' })
}

export function nightName(_n: Night, _o: { weekday: number }): TextRef {
  return { key: 'common.tonight' }
}
