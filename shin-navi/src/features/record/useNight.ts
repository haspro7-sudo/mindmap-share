// Store-backed helpers for showing a night: tonight is named with tonight's facts (duet, finale,
// crossing…) so every place — the list, the sheet, the recap — shows the same name.
import { useMemo } from 'react'
import type { Night, TextRef } from '../../core/types'
import { useNavi } from '../../core/store'
import { factsFrom, nameOf } from './nightName'

export function useNightName(n: Night | undefined): TextRef | null {
  const nightId = useNavi(s => s.session.nightId)
  const sung = useNavi(s => s.room.sung)
  const pins = useNavi(s => s.col.pins)
  return useMemo(() => (n ? nameOf(n, n.id === nightId ? factsFrom(sung, pins, n.id) : undefined) : null), [n, nightId, sung, pins])
}
