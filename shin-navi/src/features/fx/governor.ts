// Quality governor (SPEC K-11). Reads the ticker's 30-frame average and moves the effect tier:
// above 19 ms → one tier down, below 13 ms for 3 s → one tier up; prefers-reduced-motion pins
// tier 0. Guards keep one slow moment from costing the whole night's sparkle:
// - a grace period while the entrance plays (mounting everything is not "the steady state"),
// - a cooldown (2 s) after each change so the next decision sees a fresh 30-frame window
//   (at 30 fps the window alone spans a second, plus the resize of the canvases),
// - the slow average must hold for `sustainMs` before a step down,
// - on 60 Hz screens (where 13 ms is unreachable) a tier that was lost to a hiccup is probed
//   again after `probeMs`, doubling the wait every time the probe fails.
export type Tier = 0 | 1 | 2

export type TierSpec = { auroraRes: number; blobs: number; curtains: number; specks: number; dust: number; streaks: number }
export const TIERS: Record<Tier, TierSpec> = {
  2: { auroraRes: 0.5, blobs: 3, curtains: 7, specks: 60, dust: 120, streaks: 6 },
  1: { auroraRes: 0.4, blobs: 2, curtains: 4, specks: 40, dust: 40, streaks: 3 },
  0: { auroraRes: 0, blobs: 0, curtains: 0, specks: 20, dust: 0, streaks: 0 },
}

export type GovernorOpts = {
  downMs?: number
  upMs?: number
  upHoldMs?: number
  graceMs?: number
  cooldownMs?: number
  sustainMs?: number
  /** first re-probe delay after a step down (0 disables probing) */
  probeMs?: number
  /** an average this low counts as "steady" for a probe (vsync-limited 60 Hz) */
  steadyMs?: number
}

export type Governor = {
  readonly tier: Tier
  update(now: number, avgMs: number, reduced: boolean): Tier
  reset(t?: Tier): void
}

export function createGovernor(opts: GovernorOpts = {}): Governor {
  const downMs = opts.downMs ?? 19
  const upMs = opts.upMs ?? 13
  const upHoldMs = opts.upHoldMs ?? 3000
  const graceMs = opts.graceMs ?? 3500
  const cooldownMs = opts.cooldownMs ?? 2000
  const sustainMs = opts.sustainMs ?? 1000
  const probeBase = opts.probeMs ?? 12000
  const steadyMs = opts.steadyMs ?? 17.6

  let tier: Tier = 2
  let started: number | null = null
  let lastChange = -Infinity
  let slowSince: number | null = null
  let goodSince: number | null = null
  let steadySince: number | null = null
  let probeWait = probeBase
  let droppedAt: number | null = null
  let probing = false

  const change = (now: number, next: Tier) => {
    tier = next
    lastChange = now
    slowSince = null
    goodSince = null
    steadySince = null
  }

  return {
    get tier() {
      return tier
    },
    update(now, avg, reduced) {
      if (reduced) {
        if (tier !== 0) change(now, 0)
        droppedAt = null
        probing = false
        return tier
      }
      if (started == null) started = now
      if (now - started < graceMs || now - lastChange < cooldownMs) return tier

      if (avg > downMs) {
        goodSince = null
        steadySince = null
        slowSince ??= now
        if (tier > 0 && now - slowSince >= sustainMs) {
          // a failed probe waits twice as long next time
          if (probing && droppedAt != null && now - lastChange < 6000) probeWait = Math.min(probeWait * 2, 320000)
          probing = false
          droppedAt = now
          change(now, (tier - 1) as Tier)
        }
        return tier
      }
      slowSince = null

      if (avg < upMs) {
        goodSince ??= now
        if (tier < 2 && now - goodSince >= upHoldMs) {
          change(now, (tier + 1) as Tier)
          probing = false
        }
        return tier
      }
      goodSince = null

      // 60 Hz probe: frames are steady at the vsync ceiling, long after the last drop
      if (probeBase > 0 && tier < 2 && droppedAt != null && avg <= steadyMs) {
        steadySince ??= now
        if (now - droppedAt >= probeWait && now - steadySince >= upHoldMs) {
          probing = true
          change(now, (tier + 1) as Tier)
        }
      } else steadySince = null
      return tier
    },
    reset(t: Tier = 2) {
      tier = t
      started = null
      lastChange = -Infinity
      slowSince = null
      goodSince = null
      steadySince = null
      probeWait = probeBase
      droppedAt = null
      probing = false
    },
  }
}
