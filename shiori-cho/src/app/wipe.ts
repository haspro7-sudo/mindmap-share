// App-level 全データを消す service, shared by 設定 → データ and the lock screen's 「PINを忘れた」 (F3 AC4, F15 AC6).
//
// wipeAllData({ studio }):
// 1. deletes the player database 'shiori' (this module's connections are closed first; see idbConnections),
//    and the creator database 'shiori-studio' when `studio` is true;
// 2. removes this tab's own sessionStorage entries (every key starting with 'shiori.': the code hand-off,
//    the library view, the camouflage flag, a stashed deep link…);
// 3. tells every other open window of the app (an installed PWA window next to a browser tab share the same
//    storage) over a BroadcastChannel, so they reload instead of showing — and writing back — data from
//    memory. `subscribeWiped` is the receiving side.
// A failure to delete a database is thrown (after nothing was broadcast), so the caller can show it.
import { DB_PLAYER, DB_STUDIO } from '../core/constants';
import { deleteIdbDatabase } from '../storage/idbRepo';
import { deleteIdbStudioDatabase } from '../storage/studioRepo';

export interface WipeOptions {
  /** also delete the サークル工房 database 'shiori-studio' */
  studio: boolean;
}

/** sessionStorage keys that belong to the app (see the module comment). */
export const APP_SESSION_KEY_PREFIX = 'shiori.';
const CHANNEL_NAME = 'shiori';

export interface WipedMessage {
  type: 'wiped';
  studio: boolean;
}

let channel: BroadcastChannel | null | undefined;

/**
 * One channel per page: a BroadcastChannel never receives its own messages, so the wiping page is not
 * told about its own wipe (it restarts by itself).
 */
function getChannel(): BroadcastChannel | null {
  if (channel !== undefined) return channel;
  try {
    channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL_NAME);
    // Node (tests) keeps the process alive for an open channel; browsers have no unref.
    (channel as unknown as { unref?: () => void } | null)?.unref?.();
  } catch {
    channel = null;
  }
  return channel;
}

/** Removes this tab's app entries from sessionStorage (ignores storage that is unavailable). */
export function clearAppSessionStorage(): void {
  let storage: Storage | null = null;
  try {
    storage = typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return;
  }
  if (!storage) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k !== null && k.startsWith(APP_SESSION_KEY_PREFIX)) keys.push(k);
    }
    for (const k of keys) storage.removeItem(k);
  } catch {
    // ignore: nothing sensitive is left beyond a few minutes (the hand-off expires)
  }
}

export async function wipeAllData(opts: WipeOptions): Promise<void> {
  await deleteIdbDatabase(DB_PLAYER);
  if (opts.studio) await deleteIdbStudioDatabase(DB_STUDIO);
  clearAppSessionStorage();
  const message: WipedMessage = { type: 'wiped', studio: opts.studio };
  try {
    getChannel()?.postMessage(message);
  } catch {
    // another window keeps its in-memory view until it reloads; nothing more can be done here
  }
}

/**
 * Calls `onWiped` when ANOTHER window of the app deleted the data (see wipeAllData). Returns the unsubscribe
 * function. A no-op where BroadcastChannel is unavailable.
 */
export function subscribeWiped(onWiped: (message: WipedMessage) => void): () => void {
  const ch = getChannel();
  if (!ch) return () => undefined;
  const listener = (e: MessageEvent<unknown>) => {
    const data = e.data as Partial<WipedMessage> | null;
    if (data && typeof data === 'object' && data.type === 'wiped') onWiped({ type: 'wiped', studio: data.studio === true });
  };
  ch.addEventListener('message', listener);
  return () => ch.removeEventListener('message', listener);
}

/** Test hook: forget the page channel (so a test can install a fake BroadcastChannel first). */
export function resetWipeChannelForTests(): void {
  channel?.close();
  channel = undefined;
}
