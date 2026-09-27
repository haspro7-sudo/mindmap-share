// "Add as a Navi pick" per card. The opener shows the toggle on its front (on by default); other
// song cards carry it on the evidence side (C-7 back face), so the choice lives outside the body.
import { useSyncExternalStore } from 'react'

const prefs = new Map<string, boolean>()
const subs = new Set<() => void>()

export function getNaviPick(cardId: string, fallback: boolean): boolean {
  return prefs.get(cardId) ?? fallback
}

export function setNaviPick(cardId: string, on: boolean): void {
  prefs.set(cardId, on)
  subs.forEach(fn => fn())
}

export function useNaviPick(cardId: string, fallback: boolean): boolean {
  return useSyncExternalStore(
    fn => {
      subs.add(fn)
      return () => subs.delete(fn)
    },
    () => getNaviPick(cardId, fallback),
    () => getNaviPick(cardId, fallback),
  )
}
