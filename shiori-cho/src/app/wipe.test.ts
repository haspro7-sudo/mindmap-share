// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as idb from '../storage/idbRepo';
import * as studio from '../storage/studioRepo';
import { clearAppSessionStorage, resetWipeChannelForTests, subscribeWiped, wipeAllData } from './wipe';

vi.mock('../storage/idbRepo', () => ({ deleteIdbDatabase: vi.fn(async () => undefined) }));
vi.mock('../storage/studioRepo', () => ({ deleteIdbStudioDatabase: vi.fn(async () => undefined) }));

/** Minimal in-process BroadcastChannel: delivers to every OTHER instance with the same name. */
class FakeChannel {
  static all: FakeChannel[] = [];
  listeners = new Set<(e: MessageEvent) => void>();
  readonly name: string;
  constructor(name: string) {
    this.name = name;
    FakeChannel.all.push(this);
  }
  postMessage(data: unknown) {
    for (const c of FakeChannel.all) {
      if (c !== this && c.name === this.name) for (const l of c.listeners) l({ data } as MessageEvent);
    }
  }
  addEventListener(_type: 'message', l: (e: MessageEvent) => void) {
    this.listeners.add(l);
  }
  removeEventListener(_type: 'message', l: (e: MessageEvent) => void) {
    this.listeners.delete(l);
  }
  close() {
    FakeChannel.all = FakeChannel.all.filter((c) => c !== this);
  }
}

beforeEach(() => {
  vi.mocked(idb.deleteIdbDatabase).mockClear();
  vi.mocked(studio.deleteIdbStudioDatabase).mockClear();
  window.sessionStorage.clear();
  FakeChannel.all = [];
  vi.stubGlobal('BroadcastChannel', FakeChannel);
  resetWipeChannelForTests();
});

afterEach(() => {
  resetWipeChannelForTests();
  vi.unstubAllGlobals();
});

describe('wipeAllData', () => {
  it('deletes the player DB only, unless the studio is asked for', async () => {
    await wipeAllData({ studio: false });
    expect(vi.mocked(idb.deleteIdbDatabase).mock.calls.map((c) => c[0])).toEqual(['shiori']);
    expect(studio.deleteIdbStudioDatabase).not.toHaveBeenCalled();

    await wipeAllData({ studio: true });
    expect(vi.mocked(studio.deleteIdbStudioDatabase).mock.calls.map((c) => c[0])).toEqual(['shiori-studio']);
  });

  it("clears the app's sessionStorage keys and keeps others", async () => {
    window.sessionStorage.setItem('shiori.codeHandoff', '{"code":"ST4-RMA-P1X"}');
    window.sessionStorage.setItem('shiori.home.view', '{}');
    window.sessionStorage.setItem('other.site', 'keep');
    await wipeAllData({ studio: false });
    expect(window.sessionStorage.getItem('shiori.codeHandoff')).toBeNull();
    expect(window.sessionStorage.getItem('shiori.home.view')).toBeNull();
    expect(window.sessionStorage.getItem('other.site')).toBe('keep');
  });

  it('tells other windows (not itself) so they reload', async () => {
    const onWiped = vi.fn();
    const unsubscribe = subscribeWiped(onWiped);
    // another window of the app
    const other = new FakeChannel('shiori');
    const otherGot = vi.fn();
    other.addEventListener('message', (e) => otherGot(e.data));

    await wipeAllData({ studio: true });
    expect(otherGot).toHaveBeenCalledWith({ type: 'wiped', studio: true });
    expect(onWiped).not.toHaveBeenCalled(); // the wiping page restarts by itself

    other.postMessage({ type: 'wiped', studio: false });
    expect(onWiped).toHaveBeenCalledWith({ type: 'wiped', studio: false });
    other.postMessage({ type: 'something-else' });
    expect(onWiped).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('throws when a database cannot be deleted, and broadcasts nothing', async () => {
    vi.mocked(idb.deleteIdbDatabase).mockRejectedValueOnce(new Error('blocked'));
    const other = new FakeChannel('shiori');
    const otherGot = vi.fn();
    other.addEventListener('message', otherGot);
    await expect(wipeAllData({ studio: true })).rejects.toThrow('blocked');
    expect(studio.deleteIdbStudioDatabase).not.toHaveBeenCalled();
    expect(otherGot).not.toHaveBeenCalled();
  });

  it('clearAppSessionStorage tolerates an empty storage', () => {
    expect(() => clearAppSessionStorage()).not.toThrow();
  });
});
