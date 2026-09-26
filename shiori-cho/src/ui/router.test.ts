// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { goBack, historyIndex, navigate, resetHistoryTrackingForTests, stampHistoryEntry } from './router';

/** A fresh page load of the app on `hash` (the tab may hold other sites' entries before it). */
function openAppAt(hash: string): void {
  window.history.replaceState(null, '', `${window.location.pathname}${hash}`);
  resetHistoryTrackingForTests();
  stampHistoryEntry();
}

function nextHashChange(): Promise<void> {
  return new Promise((resolve) => window.addEventListener('hashchange', () => resolve(), { once: true }));
}

beforeEach(() => {
  openAppAt('#/');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('goBack (header 「戻る」)', () => {
  it('opened directly on a sub-page (a deep link, a link from a circle’s page): goes to the fallback, never leaves the app', () => {
    openAppAt('#/w/x');
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    const lengthBefore = window.history.length;
    expect(historyIndex()).toBe(0);
    goBack({ name: 'home' });
    expect(back).not.toHaveBeenCalled();
    expect(window.location.hash).toBe('#/');
    expect(window.history.length).toBe(lengthBefore); // replaced, not pushed
  });

  it('after an in-app navigation: goes back in history', async () => {
    const changed = nextHashChange();
    navigate({ name: 'settings' });
    await changed;
    expect(historyIndex()).toBe(1);
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    goBack();
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('a replace keeps the entry’s in-app index (e.g. the deep-link clean-up)', async () => {
    const changed = nextHashChange();
    navigate({ name: 'settings' });
    await changed;
    navigate({ name: 'code' }, { replace: true });
    expect(window.location.hash).toBe('#/code');
    expect(historyIndex()).toBe(1);
  });

  it('stamping keeps whatever else the entry’s state holds', () => {
    window.history.replaceState({ other: 'kept' }, '', `${window.location.pathname}#/help`);
    resetHistoryTrackingForTests();
    expect(stampHistoryEntry()).toBe(0);
    expect(window.history.state).toEqual({ other: 'kept', shioriIdx: 0 });
    // already stamped: unchanged
    expect(stampHistoryEntry()).toBe(0);
  });
});
