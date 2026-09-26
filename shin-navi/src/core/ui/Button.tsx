// Buttons. primary = the one hot action on screen; secondary = outlined, same weight of choice
// (e.g. "もう1ラウンド" must not look like a guilt button); ghost = quiet text action.
import { motion } from 'motion/react'
import type { CSSProperties, ReactNode, MouseEvent } from 'react'
import { Icon, type IconName } from './Icon'
import { SPRING } from './motion'
import './kit.css'

export type ButtonProps = {
  kind?: 'primary' | 'secondary' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  full?: boolean
  icon?: IconName
  disabled?: boolean
  children?: ReactNode
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void
  className?: string
  style?: CSSProperties
  testid?: string
  title?: string
  ariaLabel?: string
  type?: 'button' | 'submit'
}

export function Button({ kind = 'primary', size = 'md', full, icon, disabled, children, onClick, className, style, testid, title, ariaLabel, type = 'button' }: ButtonProps) {
  const cls = ['btn', `btn--${kind}`, `btn--${size}`, full ? 'btn--full' : '', className ?? ''].filter(Boolean).join(' ')
  return (
    <motion.button
      type={type}
      className={cls}
      style={style}
      disabled={disabled}
      onClick={onClick}
      data-testid={testid}
      title={title}
      aria-label={ariaLabel}
      whileTap={disabled ? undefined : { scale: 0.95 }}
      transition={SPRING.snappy}
    >
      {icon ? <Icon name={icon} size={size === 'sm' ? 16 : 20} strokeWidth={2} /> : null}
      {children != null ? <span className="btn__label">{children}</span> : null}
    </motion.button>
  )
}
