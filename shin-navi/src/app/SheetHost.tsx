// Maps ui.sheet → the sheet component supplied by the shell. Sheets rise from under the lane.
import { useEffect, useRef, type ComponentType, type ReactNode } from 'react'
import type { SheetId } from '../core/types'
import { useNavi, naviApi } from '../core/store'
import { Sheet } from '../core/ui/Sheet'
import { sound } from '../core/sound'

export type SheetDef = { C: ComponentType; full?: boolean; private?: boolean; title?: () => ReactNode }

export function SheetHost({ sheets }: { sheets: Partial<Record<SheetId, SheetDef>> }) {
  const sheet = useNavi(s => s.ui.sheet)
  const current = sheet?.id ?? null
  const known = current != null && !!sheets[current]
  // Every openSheet() call creates a new sheet object: remount the content so it never shows stale args.
  const seq = useRef<{ obj: unknown; n: number }>({ obj: null, n: 0 })
  if (sheet !== seq.current.obj) seq.current = { obj: sheet, n: seq.current.n + 1 }

  useEffect(() => {
    if (!known) return
    sound.play('open')
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [current, known])

  const close = () => {
    sound.play('close')
    naviApi.getState().closeSheet()
  }

  return (
    <>
      {(Object.keys(sheets) as SheetId[]).map(id => {
        const def = sheets[id]!
        const open = current === id
        return (
          <Sheet key={id} id={id} open={open} onClose={close} full={def.full} private={def.private} title={def.title?.()}>
            {open ? <def.C key={seq.current.n} /> : null}
          </Sheet>
        )
      })}
    </>
  )
}
