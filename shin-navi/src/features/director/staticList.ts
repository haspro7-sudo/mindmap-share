// The "申告式（従来型）" list for the comparison split (SPEC H-5): a fixed top-5 per declared
// situation. It depends on the companion type only — never on who is in the room or what just
// happened — which is exactly what the split view contrasts with the dealer.
import type { Companion, SongId } from '../../core/types'
import { STATIC_LISTS } from '../../data/tables'

export function staticList(c: Companion, n = 5): SongId[] {
  return (STATIC_LISTS[c] ?? STATIC_LISTS.friends).slice(0, n)
}
