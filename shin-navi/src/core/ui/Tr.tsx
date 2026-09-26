// Renders a TextRef in the current locale and re-renders on a locale switch.
import type { TextRef } from '../types'
import { useTr } from '../../i18n'

export function Tr({ text, prefix }: { text: TextRef; prefix?: string }) {
  const t = useTr()
  return (
    <>
      {prefix}
      {t(text)}
    </>
  )
}
