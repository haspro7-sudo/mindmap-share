/**
 * Progress summaries, missable alerts and spoiler visibility (docs/SPEC.md §5.2, F7, F8, F9).
 */
import type {
  GoalProgress,
  MissableAlert,
  ProgressGroupSummary,
  ProgressSummary,
  ShioriManifestV1,
  SpoilerLevel,
} from './types';

/** floor(100 * done / total), 0 for an empty total (never NaN). */
export function percent(done: number, total: number): number {
  if (!(total > 0) || !(done > 0)) return 0;
  return Math.min(100, Math.floor((100 * done) / total));
}

/** Goal ids that count as done: non-archived progress only. */
function doneGoalIds(progress: readonly GoalProgress[]): Set<string> {
  const ids = new Set<string>();
  for (const p of progress) if (!p.archived) ids.add(p.goalId);
  return ids;
}

/**
 * Overall and per-group done/total. Archived progress and progress for goals that are not in
 * the manifest are ignored. `byGroup` follows the manifest's group order.
 */
export function computeProgress(m: ShioriManifestV1, progress: readonly GoalProgress[]): ProgressSummary {
  const done = doneGoalIds(progress);
  const perGroup = new Map<string, { total: number; done: number }>();
  for (const g of m.groups) perGroup.set(g.id, { total: 0, done: 0 });

  let total = 0;
  let doneCount = 0;
  for (const goal of m.goals) {
    const isDone = done.has(goal.id);
    total++;
    if (isDone) doneCount++;
    const bucket = perGroup.get(goal.group);
    if (bucket) {
      bucket.total++;
      if (isDone) bucket.done++;
    }
  }

  const byGroup: ProgressGroupSummary[] = m.groups.map((g) => {
    const b = perGroup.get(g.id) ?? { total: 0, done: 0 };
    return { groupId: g.id, label: g.label, total: b.total, done: b.done, pct: percent(b.done, b.total) };
  });

  return { total, done: doneCount, pct: percent(doneCount, total), byGroup };
}

/**
 * Warnings for missable goals that are not done yet (archived progress counts as not done).
 * c = index of the current checkpoint (−1 if unset or unknown), b = index of `missable.before`.
 * An alert is emitted only when c < b; its level is 'soon' when b − c === 1, otherwise 'ahead'.
 * Alerts are returned in manifest goal order.
 */
export function missableAlerts(
  m: ShioriManifestV1,
  progress: readonly GoalProgress[],
  currentCheckpointId?: string,
): MissableAlert[] {
  const index = new Map<string, number>();
  m.checkpoints.forEach((cp, i) => {
    if (!index.has(cp.id)) index.set(cp.id, i);
  });
  const c = currentCheckpointId === undefined ? -1 : (index.get(currentCheckpointId) ?? -1);
  const done = doneGoalIds(progress);

  const alerts: MissableAlert[] = [];
  for (const goal of m.goals) {
    const missable = goal.missable;
    if (!missable || done.has(goal.id)) continue;
    const b = index.get(missable.before);
    if (b === undefined || c >= b) continue;
    alerts.push({
      goalId: goal.id,
      level: b - c === 1 ? 'soon' : 'ahead',
      beforeCheckpointId: missable.before,
      warn: missable.warn,
      spoiler: goal.spoiler,
    });
  }
  return alerts;
}

/** true when done with hintTierAtDone === 0 and not archived (ノーヒント badge). */
export function isNoHint(p: GoalProgress | undefined): boolean {
  return !!p && !p.archived && p.hintTierAtDone === 0;
}

/** Public text with `spoiler` is shown directly iff spoiler <= tolerance. */
export function isVisible(spoiler: SpoilerLevel, tolerance: SpoilerLevel): boolean {
  return spoiler <= tolerance;
}
