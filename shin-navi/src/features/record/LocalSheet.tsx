// A bottom sheet owned by the record tab (the ball legend, settings). It reuses the shared Sheet
// look and gestures, but lives in local state instead of ui.sheet, and is portalled into the
// phone shell so it rises from under the lane like every other sheet (not inside the scroller).
import { useEffect, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Sheet } from '../../core/ui/Sheet'
import { sound } from '../../core/sound'

export function LocalSheet(p: { id: string; open: boolean; onClose(): void; title: ReactNode; anchor: RefObject<HTMLElement>; children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null)
  // a passive effect: the anchor (an ancestor) has its ref attached by then
  useEffect(() => {
    if (!host) setHost((p.anchor.current?.closest('[data-shell="phone"]') as HTMLElement | null) ?? null)
  }, [p.open])
  useEffect(() => {
    if (!p.open) return
    sound.play('open')
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') p.onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [p.open])
  const close = () => {
    sound.play('close')
    p.onClose()
  }
  const sheet = (
    <Sheet id={p.id} open={p.open} onClose={close} title={p.title} private>
      {p.children}
    </Sheet>
  )
  return host ? createPortal(sheet, host) : sheet
}
