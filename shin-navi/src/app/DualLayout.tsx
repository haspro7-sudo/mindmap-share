// Presentation layout (SPEC F-5, ?view=dual): the 390×844 phone scaled to the height on the
// left (≈0.86 at 1366×768), a 24 px glowing seam, and the room screen filling the rest.
// Below the 1366×768 design size (an XGA projector mirror at 1024×768, a 1280×720 laptop) the
// whole stage is laid out at 1366×768 and scaled down uniformly with letterboxing, instead of
// reflowing the room columns into something illegible (QA ROBUST#7).
import { useBox, LayoutProvider, DUAL_DESIGN, dualFit } from '../core/layout'
import { Seam } from '../features/stage'
import { PhoneShell } from './PhoneShell'
import { RoomShell } from './RoomShell'

const PHONE = { w: 390, h: 844 }

function DualStage() {
  const box = useBox()
  const pad = 20
  const scale = Math.max(0.4, Math.min(1, (box.h - pad * 2) / PHONE.h, (box.w * 0.42) / PHONE.w))
  const w = Math.round(PHONE.w * scale)
  const h = Math.round(PHONE.h * scale)
  return (
    <div className="dual" data-shell="dual">
      <div className="dual__phone-col" style={{ width: w + pad * 2 }}>
        <div className="dual__device" style={{ width: w, height: h }}>
          <div className="dual__screen" style={{ width: PHONE.w, height: PHONE.h, transform: `scale(${scale})` }}>
            <LayoutProvider view="phone" fixed={PHONE} scale={scale}>
              <PhoneShell />
            </LayoutProvider>
          </div>
        </div>
      </div>
      <div className="dual__seam">
        <Seam />
      </div>
      <div className="dual__room">
        <RoomShell inDual />
      </div>
    </div>
  )
}

export function DualLayout() {
  const box = useBox()
  const fit = dualFit(box.w, box.h)
  const scaled = fit < 1
  // One tree in both modes (a resize across the threshold must not remount the canvases).
  // Letterboxed, the stage keeps its 1366×768 layout and shrinks as one picture.
  return (
    <div className={`dual-fit${scaled ? ' is-scaled' : ''}`} data-fit={fit.toFixed(3)}>
      <div className="dual-fit__frame" style={scaled ? { width: Math.floor(DUAL_DESIGN.w * fit), height: Math.floor(DUAL_DESIGN.h * fit) } : undefined}>
        <div className="dual-fit__stage" style={scaled ? { width: DUAL_DESIGN.w, height: DUAL_DESIGN.h, transform: `scale(${fit})` } : undefined}>
          <LayoutProvider fixed={scaled ? DUAL_DESIGN : undefined} scale={fit}>
            <DualStage />
          </LayoutProvider>
        </div>
      </div>
    </div>
  )
}
