// Quality governor (SPEC K-11). Reads the ticker's 30-frame average and moves the effect tier:
// above 19 ms → one tier down, below 13 ms for 3 s → one tier up; prefers-reduced-motion pins
// tier 0. Guards keep one slow moment (or a slow page that is not our fault) from costing the
// whole night's sparkle:
// - a grace period while the entrance plays (mounting everything is not "the steady state"),
// - a cooldown (2 s) after each change so the next decision sees a fresh 30-frame window,
// - the slow average must hold for `sustainMs` before a step down,
// - every step down is judged `verifyMs` later: when it did not make frames measurably faster
//   (medians; less than max(1.5 ms, 10 %)), the frames were slow for reasons outside the effects (another
//   layer, another process). The tier is given back and that step is not retried for a while
//   (15 s, doubling) unless frames get clearly worse than when it was tried,
// - a step up that has to be taken back within 6 s doubles the wait before the next one,
// - on 60 Hz screens (where 13 ms is unreachable) a tier that was lost to a hiccup is probed
//   again after `probeMs` (8 s × the same back-off).
export type Tier = 0 | 1 | 2

export type TierSpec = { auroraRes: number; blobs: number; curtains: number; specks: number; dust: number; streaks: number }
export const TIERS: Record<Tier, TierSpec> = {
  2: { auroraRes: 0.5, blobs: 3, curtains: 7, specks: 60, dust: 120, streaks: 6 },
  1: { auroraRes: 0.4, blobs: 2, curtains: 4, specks: 40, dust: 60, streaks: 3 },
  0: { auroraRes: 0, blobs: 0, curtains: 0, specks: 20, dust: 0, streaks: 0 },
}

export type GovernorOpts = {
  downMs?: number
  upMs?: number
  upHoldMs?: number
  graceMs?: number
  cooldownMs?: number
  sustainMs?: number
  /** how long after a step down its effect is judged */
  verifyMs?: number
  /** a step down must win at least max(minGainMs, before · minGainRatio) */
  minGainMs?: number
  minGainRatio?: number
  /** first hold after a step that bought nothing (doubles each time, ≤ 5 min) */
  holdMs?: number
  /** during a hold, frames this much slower than when the step was tried allow a new try */
  worseMs?: number
  /** first re-probe delay after a step down (0 disables probing) */
  probeMs?: number
  /** an average this low counts as "steady" for a probe (vsync-limited 60 Hz) */
  steadyMs?: number
}

export type GovernorEvent = { at: number; from: Tier; to: Tier; why: 'slow' | 'fast' | 'probe' | 'blameless' | 'reduced' }

export type Governor = {
  readonly tier: Tier
  update(now: number, avgMs: number, reduced: boolean): Tier
  reset(t?: Tier): void
  /** recent tier changes, newest last (debug / tests) */
  readonly log: readonly GovernorEvent[]
}

export function createGovernor(opts: GovernorOpts = {}): Governor {
  const downMs = opts.downMs ?? 19
  const upMs = opts.upMs ?? 13
  const upHoldMs = opts.upHoldMs ?? 3000
  const graceMs = opts.graceMs ?? 3500
  const cooldownMs = opts.cooldownMs ?? 2000
  const sustainMs = opts.sustainMs ?? 1000
  const verifyMs = opts.verifyMs ?? 2500
  const minGainMs = opts.minGainMs ?? 1.5
  const minGainRatio = opts.minGainRatio ?? 0.1
  const holdBase = opts.holdMs ?? 15000
  const worseMs = opts.worseMs ?? 4
  const probeBase = opts.probeMs ?? 8000
  const steadyMs = opts.steadyMs ?? 17.6

  let tier: Tier = 2
  let started: number | null = null
  let lastChange = -Infinity
  let slowSince: number | null = null
  let goodSince: number | null = null
  let steadySince: number | null = null
  let verify: { from: Tier; before: number; at: number } | null = null
  let hold: { until: number; ambient: number; tier: Tier } | null = null
  let holdWait = holdBase
  let lastUp = -Infinity
  let penalty = 1
  let droppedAt: number | null = null
  const log: GovernorEvent[] = []
  // recent samples: decisions compare medians, so one spike from another process decides nothing
  const hist: { t: number; v: number }[] = []
  const median = (from: number, to: number, fallback: number) => {
    const v = hist.filter(h => h.t >= from && h.t <= to).map(h => h.v)
    if (!v.length) return fallback
    v.sort((a, b) => a - b)
    return v[v.length >> 1]
  }

  const change = (now: number, next: Tier, why: GovernorEvent['why']) => {
    if (next !== tier) {
      log.push({ at: now, from: tier, to: next, why })
      if (log.length > 32) log.shift()
    }
    tier = next
    lastChange = now
    slowSince = null
    goodSince = null
    steadySince = null
  }
  const up = (now: number, why: GovernorEvent['why']) => {
    lastUp = now
    change(now, (tier + 1) as Tier, why)
  }

  return {
    get tier() {
      return tier
    },
    get log() {
      return log
    },
    update(now, avg, reduced) {
      if (reduced) {
        if (tier !== 0) change(now, 0, 'reduced')
        verify = null
        hold = null
        droppedAt = null
        return tier
      }
      if (started == null) started = now
      hist.push({ t: now, v: avg })
      while (hist.length && hist[0].t < now - 6000) hist.shift()
      if (now - started < graceMs) return tier

      // judge the last step down: did it buy frames?
      if (verify && now >= verify.at) {
        const v = verify
        verify = null
        const after = median(now - 1250, now, avg)
        if (v.before - after < Math.max(minGainMs, v.before * minGainRatio)) {
          hold = { until: now + holdWait, ambient: v.before, tier: v.from }
          holdWait = Math.min(holdWait * 2, 300000)
          change(now, v.from, 'blameless')
          return tier
        }
      }
      // nothing else moves while a step waits for its verdict
      if (verify) return tier
      if (hold && now >= hold.until) hold = null
      if (now - lastChange < cooldownMs) return tier

      if (avg > downMs) {
        goodSince = null
        steadySince = null
        slowSince ??= now
        const held = hold != null && tier <= hold.tier && avg <= hold.ambient + worseMs
        if (tier > 0 && !held && now - slowSince >= sustainMs) {
          // a promotion that fails fast doubles the wait before the next one
          if (now - lastUp < 6000) penalty = Math.min(penalty * 2, 32)
          verify = { from: tier, before: median(slowSince, now, avg), at: now + Math.max(verifyMs, cooldownMs) }
          droppedAt = now
          change(now, (tier - 1) as Tier, 'slow')
        }
        return tier
      }
      slowSince = null

      if (avg < upMs) {
        goodSince ??= now
        if (tier < 2 && now - goodSince >= upHoldMs * penalty) up(now, 'fast')
        return tier
      }
      goodSince = null

      // 60 Hz probe: frames are steady at the vsync ceiling, long after the last drop
      if (probeBase > 0 && tier < 2 && droppedAt != null && avg <= steadyMs) {
        steadySince ??= now
        if (now - droppedAt >= probeBase * penalty && now - steadySince >= upHoldMs) up(now, 'probe')
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
      verify = null
      hold = null
      holdWait = holdBase
      hist.length = 0
      lastUp = -Infinity
      penalty = 1
      droppedAt = null
      log.length = 0
    },
  }
}
