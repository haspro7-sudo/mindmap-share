// The four doors (SPEC F-7): 探す / 歌う / 記録 / 注文. The record door is the mini mirror ball
// itself. This is the only element in the app with backdrop-filter.
import { motion } from 'motion/react'
import type { ReactNode } from 'react'
import { common } from '../i18n/common'
import { useNavi, naviApi } from '../core/store'
import type { Tab } from '../core/types'
import { Icon, type IconName } from '../core/ui/Icon'
import { SPRING } from '../core/ui/motion'
import { sound } from '../core/sound'

const ITEMS: { id: Tab; icon: IconName | null }[] = [
  { id: 'discover', icon: 'search' },
  { id: 'sing', icon: 'sing' },
  { id: 'record', icon: null },
  { id: 'order', icon: 'order' },
]

export function Dock({ ball }: { ball: ReactNode }) {
  const t = common.useT()
  const tab = useNavi(s => s.ui.tab)
  return (
    <nav className="dock" data-anchor="dock" aria-label={t('dock.label')}>
      {ITEMS.map(it => {
        const active = tab === it.id
        return (
          <motion.button
            key={it.id}
            type="button"
            className={`dock__item${active ? ' is-active' : ''}`}
            data-testid={`dock-${it.id}`}
            aria-current={active ? 'page' : undefined}
            whileTap={{ scale: 0.92 }}
            transition={SPRING.snappy}
            onClick={() => {
              if (!active) sound.play('tap')
              naviApi.getState().setTab(it.id)
            }}
          >
            <span className={`dock__icon${it.icon ? '' : ' dock__icon--ball'}`}>{it.icon ? <Icon name={it.icon} size={22} strokeWidth={active ? 2.2 : 1.8} /> : ball}</span>
            <span className="dock__label">{t(`dock.${it.id}`)}</span>
            {active ? <motion.span layoutId="dock-dot" className="dock__dot" transition={SPRING.snappy} /> : null}
          </motion.button>
        )
      })}
    </nav>
  )
}
