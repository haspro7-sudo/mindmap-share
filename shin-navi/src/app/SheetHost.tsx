// Maps ui.sheet → the sheet component supplied by the shell. Sheets rise from under the lane.
import { useEffect, type ComponentType, type ReactNode } from 'react'
import type { SheetId } from '../core/types'
import { useNavi, naviApi } from '../core/store'
import { Sheet } from '../core/ui/Sheet'
import { sound } from '../core/sound'

export type SheetDef = { C: ComponentType; full?: boolean; private?: boolean; title?: () => ReactNode }

export function SheetHost({ sheets }: { sheets: Partial<Record<SheetId, SheetDef>> }) {
  const current = useNavi(s => s.ui.sheet?.id ?? null)
  const known = current != null && !!sheets[current]

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
            {open ? <def.C /> : null}
          </Sheet>
        )
      })}
    </>
  )
}
