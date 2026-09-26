import { describe, expect, it } from 'vitest';
import { PIN_COOLDOWN_MS, PIN_MAX_FAILURES } from '../../core/constants';
import { hashPin } from '../../core/crypto/pin';
import type { Settings } from '../../core/types';
import { checkPinThrottled, cooldownUntil, normalizedCooldownPatch } from './pinThrottle';

const NOW = 1_800_000_000_000;

describe('cooldownUntil (F3 AC3)', () => {
  it('is 0 without a cooldown or once it is over', () => {
    expect(cooldownUntil({}, NOW)).toBe(0);
    expect(cooldownUntil({ pinCooldownUntil: NOW - 1 }, NOW)).toBe(0);
    expect(cooldownUntil({ pinCooldownUntil: NOW }, NOW)).toBe(0);
  });

  it('keeps a normal cooldown as stored', () => {
    expect(cooldownUntil({ pinCooldownUntil: NOW + 12_000 }, NOW)).toBe(NOW + 12_000);
    expect(cooldownUntil({ pinCooldownUntil: NOW + PIN_COOLDOWN_MS }, NOW)).toBe(NOW + PIN_COOLDOWN_MS);
  });

  it('clamps a cooldown stored under a clock that was ahead to one cooldown from now', () => {
    const aDayAhead = NOW + 86_400_000 + PIN_COOLDOWN_MS;
    expect(cooldownUntil({ pinCooldownUntil: aDayAhead }, NOW)).toBe(NOW + PIN_COOLDOWN_MS);
  });

  it('normalizedCooldownPatch stores the clamped value only when needed', () => {
    expect(normalizedCooldownPatch({}, NOW)).toBeNull();
    expect(normalizedCooldownPatch({ pinCooldownUntil: NOW + 5_000 }, NOW)).toBeNull();
    expect(normalizedCooldownPatch({ pinCooldownUntil: NOW + 86_400_000 }, NOW)).toEqual({ pinCooldownUntil: NOW + PIN_COOLDOWN_MS });
    expect(normalizedCooldownPatch({ pinCooldownUntil: Number.NaN }, NOW)).toEqual({ pinCooldownUntil: undefined });
  });
});

describe('checkPinThrottled (lock screen and 設定 share it)', () => {
  type Throttle = Pick<Settings, 'pin' | 'pinFailures' | 'pinCooldownUntil'>;
  async function state(extra: Partial<Throttle> = {}) {
    let s: Throttle = { pin: await hashPin('1357', { iterations: 1000 }), pinFailures: 0, ...extra };
    const update = async (patch: Partial<Settings>) => {
      s = { ...s, ...patch } as Throttle;
    };
    return { get: () => s, update };
  }

  it('counts wrong PINs and starts the cooldown at the limit', async () => {
    const st = await state();
    for (let i = 1; i < PIN_MAX_FAILURES; i++) {
      expect(await checkPinThrottled('0000', st.get(), st.update, () => NOW)).toEqual({ status: 'wrong', left: PIN_MAX_FAILURES - i });
      expect(st.get().pinFailures).toBe(i);
    }
    expect(await checkPinThrottled('0000', st.get(), st.update, () => NOW)).toEqual({
      status: 'cooldown',
      until: NOW + PIN_COOLDOWN_MS,
      started: true,
    });
    expect(st.get()).toMatchObject({ pinFailures: 0, pinCooldownUntil: NOW + PIN_COOLDOWN_MS });
  });

  it('refuses everything during the cooldown, even the right PIN', async () => {
    const st = await state({ pinCooldownUntil: NOW + 10_000 });
    expect(await checkPinThrottled('1357', st.get(), st.update, () => NOW)).toEqual({ status: 'cooldown', until: NOW + 10_000, started: false });
    expect(await checkPinThrottled('1357', st.get(), st.update, () => NOW + 10_001)).toEqual({ status: 'ok' });
  });

  it('a right PIN resets the counter and a finished cooldown', async () => {
    const st = await state({ pinFailures: 3, pinCooldownUntil: NOW - 1 });
    expect(await checkPinThrottled('1357', st.get(), st.update, () => NOW)).toEqual({ status: 'ok' });
    expect(st.get().pinFailures).toBe(0);
    expect(st.get().pinCooldownUntil).toBeUndefined();
  });
});
