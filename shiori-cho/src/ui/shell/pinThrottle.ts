// PIN failure counter and cooldown (F3 AC3), shared by the lock screen and 設定 → 画面ロック (「いまのPIN」):
// after PIN_MAX_FAILURES wrong PINs, input is refused for PIN_COOLDOWN_MS. The state lives in settings
// (pinFailures, pinCooldownUntil), so it is the same counter on both screens and survives reloads.
//
// pinCooldownUntil is an absolute time. A value further ahead than one cooldown can only come from a clock
// that was ahead when it was stored (and was corrected since): it is treated as a fresh 30 s cooldown
// (`cooldownUntil`) and stored that way (`normalizedCooldownPatch`), so a clock change never locks the user
// out for longer than the specified 30 seconds.
import { PIN_COOLDOWN_MS, PIN_MAX_FAILURES } from '../../core/constants';
import { verifyPin } from '../../core/crypto/pin';
import type { Settings } from '../../core/types';

type ThrottleSettings = Pick<Settings, 'pin' | 'pinFailures' | 'pinCooldownUntil'>;
type Update = (patch: Partial<Settings>) => Promise<void>;

/** The effective end of the cooldown (0 when there is none), clamped to at most one cooldown from `now`. */
export function cooldownUntil(s: Pick<Settings, 'pinCooldownUntil'>, now: number = Date.now()): number {
  const raw = s.pinCooldownUntil ?? 0;
  if (!Number.isFinite(raw) || raw <= now) return 0;
  return raw - now > PIN_COOLDOWN_MS ? now + PIN_COOLDOWN_MS : raw;
}

/** A settings patch that stores the clamped cooldown when the stored one is out of range, else null. */
export function normalizedCooldownPatch(s: Pick<Settings, 'pinCooldownUntil'>, now: number = Date.now()): Partial<Settings> | null {
  const raw = s.pinCooldownUntil;
  if (raw === undefined) return null;
  if (!Number.isFinite(raw)) return { pinCooldownUntil: undefined };
  return raw - now > PIN_COOLDOWN_MS ? { pinCooldownUntil: now + PIN_COOLDOWN_MS } : null;
}

export type PinCheck =
  | { status: 'ok' }
  /** wrong PIN; `left` more failures start the cooldown */
  | { status: 'wrong'; left: number }
  /** refused because of a cooldown (`started`: this attempt was the one that started it) */
  | { status: 'cooldown'; until: number; started: boolean };

/**
 * Checks `value` against the stored PIN, honouring and updating the shared failure counter:
 * success resets it, a failure increments it, and the PIN_MAX_FAILURES-th failure starts the cooldown.
 * While a cooldown runs nothing is verified. Throws only if saving the counter fails.
 */
export async function checkPinThrottled(value: string, s: ThrottleSettings, update: Update, now: () => number = Date.now): Promise<PinCheck> {
  const until = cooldownUntil(s, now());
  if (until > 0) return { status: 'cooldown', until, started: false };
  const ok = s.pin !== undefined && (await verifyPin(value, s.pin));
  if (ok) {
    if ((s.pinFailures ?? 0) !== 0 || s.pinCooldownUntil !== undefined) await update({ pinFailures: 0, pinCooldownUntil: undefined });
    return { status: 'ok' };
  }
  const failures = (s.pinFailures ?? 0) + 1;
  if (failures >= PIN_MAX_FAILURES) {
    const next = now() + PIN_COOLDOWN_MS;
    await update({ pinFailures: 0, pinCooldownUntil: next });
    return { status: 'cooldown', until: next, started: true };
  }
  await update({ pinFailures: failures });
  return { status: 'wrong', left: PIN_MAX_FAILURES - failures };
}
