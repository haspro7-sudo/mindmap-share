// Placeholder used by the phase-0 feature stubs: a dim, labelled slot that shows where a
// module's real component will live. Labels are component identifiers, not UI copy.
import type { CSSProperties, ReactNode } from 'react'
import './kit.css'

export type StubBoxProps = {
  name: string
  module: string
  testid?: string
  className?: string
  style?: CSSProperties
  children?: ReactNode
  /** extra data-* attributes required by the test contract */
  data?: Record<string, string | number | undefined>
  quiet?: boolean
}

export function StubBox({ name, module, testid, className, style, children, data, quiet }: StubBoxProps) {
  const attrs: Record<string, string | number | undefined> = {}
  if (data) for (const [k, v] of Object.entries(data)) attrs[`data-${k}`] = v
  return (
    <div className={`stub-box${quiet ? ' stub-box--quiet' : ''}${className ? ` ${className}` : ''}`} style={style} data-testid={testid} data-stub={name} {...attrs}>
      {children}
      <span className="stub-box__tag">
        {name}
        <i>{module}</i>
      </span>
    </div>
  )
}
