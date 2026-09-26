// Planning-lens anchor (SPEC H-2): marks an element with data-anchor so PolicyLens can frame it.
import type { HTMLAttributes, ReactNode } from 'react'

export type AnchorProps = HTMLAttributes<HTMLDivElement> & { id: string; children?: ReactNode; private?: boolean }

export function Anchor({ id, children, private: priv, ...rest }: AnchorProps) {
  return (
    <div {...rest} data-anchor={id} data-private={priv ? '1' : undefined}>
      {children}
    </div>
  )
}
