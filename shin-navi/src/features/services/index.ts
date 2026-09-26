// M10 services — PHASE-0 STUB (owned by M10 from phase 1). Public API per SPEC L/M10.
import { createElement as h, useEffect } from 'react'
import type { CardBodyComponent, TextRef } from '../../core/types'
import { useNavi, naviApi } from '../../core/store'
import { StubBox } from '../../core/ui/StubBox'
import { Button } from '../../core/ui/Button'
import { common } from '../../i18n/common'
import { Tr } from '../../core/ui/Tr'
import '../../styles/stubs.css'

export const MENU: { id: string; kind: 'drink' | 'food' | 'water' | 'rest'; name: TextRef; hue: number }[] = [
  { id: 'highball', kind: 'drink', name: { key: 'services.menu.highball' }, hue: 38 },
  { id: 'oolong', kind: 'drink', name: { key: 'services.menu.oolong' }, hue: 28 },
  { id: 'ginger', kind: 'drink', name: { key: 'services.menu.ginger' }, hue: 48 },
  { id: 'cola', kind: 'drink', name: { key: 'services.menu.cola' }, hue: 10 },
  { id: 'fries', kind: 'food', name: { key: 'services.menu.fries' }, hue: 45 },
  { id: 'karaage', kind: 'food', name: { key: 'services.menu.karaage' }, hue: 30 },
  { id: 'water', kind: 'water', name: { key: 'services.menu.water' }, hue: 195 },
  { id: 'rest', kind: 'rest', name: { key: 'services.menu.rest' }, hue: 260 },
]

export function OrderScreen(): JSX.Element {
  const closed = useNavi(s => s.orders.closed)
  return h(
    'div',
    { className: 'stub-screen', 'data-anchor': 'order' },
    closed ? h('div', { 'data-testid': 'order-closed', className: 'stub-note' }, h(Tr, { text: { key: 'core.orderClosed' } })) : null,
    h(StubBox, { name: 'OrderScreen', module: 'M10', className: 'stub-screen__box' }),
  )
}

function CoasterBody({ card, setPrimary }: Parameters<CardBodyComponent>[0]) {
  useEffect(() => {
    setPrimary({ action: 'order', label: { key: 'common.dock.order' }, enabled: true, arg: { menuId: 'highball' } })
  }, [card.id])
  return h(StubBox, { name: 'CoasterCardBody', module: 'M10', className: 'stub-body' }, h('div', { className: 'stub-body__reason', 'data-testid': 'card-reason' }, h(Tr, { text: card.reason.text })))
}
export const CoasterCardBody: CardBodyComponent = p => h(CoasterBody, p)

export function ImportSheet(): JSX.Element {
  return h(StubBox, { name: 'ImportSheet', module: 'M10', className: 'stub-sheetbody' })
}

function ImportBody({ card, setPrimary }: Parameters<CardBodyComponent>[0]) {
  useEffect(() => {
    setPrimary({ action: 'save', label: { key: 'common.reserve' }, enabled: !!card.songId, arg: { songId: card.songId, version: 'original' } })
  }, [card.id])
  return h(StubBox, { name: 'ImportCardBody', module: 'M10', className: 'stub-body' }, h('div', { className: 'stub-body__reason', 'data-testid': 'card-reason' }, h(Tr, { text: card.reason.text })))
}
export const ImportCardBody: CardBodyComponent = p => h(ImportBody, p)

export function EntryScreen(): JSX.Element {
  const t = common.useT()
  return h(
    'div',
    { className: 'stub-entry', 'data-anchor': 'entry-ota' },
    h('div', { className: 'stub-entry__brand' }, t('brand')),
    h(Button, { kind: 'primary', size: 'lg', onClick: () => naviApi.getState().setOverlay(null) }, t('dock.discover')),
    h(StubBox, { name: 'EntryScreen', module: 'M10', quiet: true }),
  )
}
