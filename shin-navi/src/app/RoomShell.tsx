// Room screen, tablet landscape (SPEC F-4, 1280×800 base): lane column left, the room ball
// centre, members / air / QR right. Columns 26/46/28 (28/44/28 at ≤1100 px, 30/45/25 in dual),
// decided by measuring this container. Nothing personal is shown here.
import type { CSSProperties } from 'react'
import { useNavi } from '../core/store'
import { selTonight } from '../core/selectors'
import { LayoutProvider, roomColumns, useBox } from '../core/layout'
import { BackgroundCanvas, SpeckCanvas } from '../features/fx'
import { MirrorBall } from '../features/ball'
import { StageLane, RoomBoard, RoomSidebar } from '../features/stage'
import { WallConstellation } from '../features/record'
import { StatusBar } from './StatusBar'
import { SheetHost } from './SheetHost'
import { Toasts } from './Toasts'
import { ROOM_SHEETS } from './slots'

const STATUS_H = 48

function RoomInner({ inDual }: { inDual: boolean }) {
  const box = useBox()
  const [a, b, c] = roomColumns(box.w, inDual)
  const tonight = useNavi(selTonight)
  const centreW = (box.w * b) / 100
  const bodyH = box.h - STATUS_H
  const ballMax = box.w <= 1100 || inDual ? 360 : 420
  const ball = Math.max(160, Math.round(Math.min(ballMax, centreW * 0.82, bodyH * 0.6)))
  const sideW = Math.max(160, Math.round((box.w * c) / 100 - 40))
  const vars = { '--lane-bottom': `${STATUS_H}px`, '--sheet-left': `${a}%`, '--room-ball': `${ball}px` } as CSSProperties
  return (
    <div className={`room-shell${inDual ? ' is-dual' : ''}`} data-shell="room" style={vars}>
      <div className="rs-bg">
        <BackgroundCanvas variant="room" />
      </div>
      <div className="rs-specks">
        <SpeckCanvas />
      </div>
      <div className="rs-status" style={{ height: STATUS_H }}>
        <StatusBar variant="room" minimal={inDual} />
      </div>
      <div className="rs-cols" style={{ gridTemplateColumns: `${a}fr ${b}fr ${c}fr` }}>
        <section className="rs-lane">
          <StageLane orientation="vertical" />
        </section>
        <section className="rs-centre">
          <div className="rs-ball" style={{ width: ball, height: ball, marginLeft: -ball / 2, marginTop: -ball / 2 }}>
            <MirrorBall variant="room" size={ball} />
          </div>
          <div className="rs-board">
            <RoomBoard />
          </div>
        </section>
        <section className="rs-side">
          <RoomSidebar constellation={<WallConstellation night={tonight} width={sideW} height={Math.round(sideW * 0.5)} publicOnly />} />
        </section>
      </div>
      {inDual ? null : (
        <>
          <div className="rs-toasts">
            <Toasts />
          </div>
          <SheetHost sheets={ROOM_SHEETS} />
        </>
      )}
    </div>
  )
}

export function RoomShell({ inDual = false }: { inDual?: boolean }) {
  return (
    <LayoutProvider view="room" className="room-host">
      <RoomInner inDual={inDual} />
    </LayoutProvider>
  )
}
