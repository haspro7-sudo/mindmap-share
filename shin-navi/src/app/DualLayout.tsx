// Presentation layout (SPEC F-5, ?view=dual): the 390×844 phone scaled to the height on the
// left (≈0.86 at 1366×768), a 24 px glowing seam, and the room screen filling the rest.
import { useBox, LayoutProvider } from '../core/layout'
import { Seam } from '../features/stage'
import { PhoneShell } from './PhoneShell'
import { RoomShell } from './RoomShell'

const PHONE = { w: 390, h: 844 }

export function DualLayout() {
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
