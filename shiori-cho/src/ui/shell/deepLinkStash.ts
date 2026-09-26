// Deep links (#/u/<manifestWorkId>/<code>, F11) are taken out of the address bar at once, even while the
// age gate, onboarding, the PIN lock or the camouflage is shown (F11 AC1, §9 Privacy): the shell stashes
// the link here and replaces the history entry with '#/code', then the app frame processes the stash once
// it is visible (UnlockLanding) and clears it.
// sessionStorage keeps the stash across a reload of the same tab (never across tabs, and it holds only the
// work id and the code, never a title); it expires after a while like the code hand-off.

export interface StashedDeepLink {
  manifestWorkId: string;
  code: string;
}

const KEY = 'shiori.deeplink';
/** A link that was never processed (e.g. the tab stayed on the lock screen) is dropped after this. */
const MAX_AGE_MS = 30 * 60_000;
const MAX_CHARS = 200;

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function writeDeepLinkStash(link: StashedDeepLink, now: number = Date.now()): void {
  try {
    storage()?.setItem(
      KEY,
      JSON.stringify({ manifestWorkId: link.manifestWorkId.slice(0, MAX_CHARS), code: link.code.slice(0, MAX_CHARS), at: now }),
    );
  } catch {
    // storage unavailable: the in-memory copy in the shell still works for this page load
  }
}

export function readDeepLinkStash(now: number = Date.now()): StashedDeepLink | null {
  let raw: string | null = null;
  try {
    raw = storage()?.getItem(KEY) ?? null;
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { manifestWorkId?: unknown; code?: unknown; at?: unknown } | null;
    if (!v || typeof v !== 'object') return null;
    if (typeof v.manifestWorkId !== 'string' || typeof v.code !== 'string' || typeof v.at !== 'number') return null;
    if (v.manifestWorkId === '' || v.code === '') return null;
    if (now - v.at > MAX_AGE_MS || v.at - now > MAX_AGE_MS) return null;
    return { manifestWorkId: v.manifestWorkId.slice(0, MAX_CHARS), code: v.code.slice(0, MAX_CHARS) };
  } catch {
    return null;
  }
}

export function clearDeepLinkStash(): void {
  try {
    storage()?.removeItem(KEY);
  } catch {
    // ignore
  }
}
