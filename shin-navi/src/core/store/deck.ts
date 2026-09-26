// Deck slice: the hand of discovery cards.
import type { StateCreator } from 'zustand'
import type { DeckSlice, NaviState } from './types'
import { freshDeck } from './initial'
import { bus } from '../events'
import { performCardAction, performUndo } from '../actions'

export const createDeckSlice: StateCreator<NaviState, [], [], DeckSlice> = (set, _get, api) => ({
  deck: freshDeck(),

  dealCards(cards, mode, cause) {
    set(s => {
      const existing = new Set(s.deck.cards.map(c => c.id))
      const fresh = cards.filter(c => !existing.has(c.id))
      let next = s.deck.cards
      switch (mode) {
        case 'append':
          next = [...next, ...fresh]
          break
        case 'top':
          next = [...fresh, ...next]
          break
        case 'at1':
          next = next.length ? [next[0], ...fresh, ...next.slice(1)] : fresh
          break
        case 'replace':
          next = cards
          break
      }
      const replaced = mode === 'replace' || mode === 'top'
      return {
        deck: {
          ...s.deck,
          cards: next,
          flippedId: replaced ? null : s.deck.flippedId,
          primary: replaced ? null : s.deck.primary,
          redeal: mode === 'replace' && cause ? { at: Date.now(), cause } : s.deck.redeal,
        },
      }
    })
    if (mode === 'replace' && cause) bus.emit({ type: 'deck/redeal', cause })
  },

  act(cardId, a, arg) {
    performCardAction(api, cardId, a, arg)
  },

  undo() {
    performUndo(api)
  },

  flip(cardId) {
    set(s => ({ deck: { ...s.deck, flippedId: cardId } }))
  },

  setPrimary(primary) {
    set(s => ({ deck: { ...s.deck, primary } }))
  },

  select(cardId, songId) {
    set(s => ({ deck: { ...s.deck, selection: { ...s.deck.selection, [cardId]: songId } } }))
  },

  noteOffer(p) {
    set(s => ({ deck: { ...s.deck, offers: { ...s.deck.offers, ...p } } }))
  },

  dropCard(cardId) {
    set(s => ({ deck: { ...s.deck, cards: s.deck.cards.filter(c => c.id !== cardId), flippedId: s.deck.flippedId === cardId ? null : s.deck.flippedId } }))
  },
})
