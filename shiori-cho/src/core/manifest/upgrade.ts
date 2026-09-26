/**
 * Manifest updates (docs/SPEC.md §5.2, F5 AC4). Pure: inputs are never mutated.
 */
import type { GoalProgress, ManifestDiff, ShioriManifestV1 } from '../types';

function goalIds(m: ShioriManifestV1): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const g of m.goals) {
    if (!seen.has(g.id)) {
      seen.add(g.id);
      out.push(g.id);
    }
  }
  return out;
}

/**
 * added: goal ids in newM but not oldM (newM order); removed: in oldM but not newM (oldM order);
 * kept: in both (newM order). kdfChanged: kdf added/removed, or its salt or iterations differ.
 */
export function diffManifests(oldM: ShioriManifestV1, newM: ShioriManifestV1): ManifestDiff {
  const oldIds = goalIds(oldM);
  const newIds = goalIds(newM);
  const oldSet = new Set(oldIds);
  const newSet = new Set(newIds);
  const a = oldM.kdf;
  const b = newM.kdf;
  const kdfChanged = a === undefined || b === undefined ? a !== b : a.salt !== b.salt || a.iterations !== b.iterations;
  return {
    added: newIds.filter((id) => !oldSet.has(id)),
    removed: oldIds.filter((id) => !newSet.has(id)),
    kept: newIds.filter((id) => oldSet.has(id)),
    kdfChanged,
  };
}

/**
 * Carries progress over by goal id: progress for goals missing from newM becomes archived,
 * progress for goals present in newM is un-archived. newGoalIds = goals added by newM.
 * archivedGoalIds = goal ids whose progress is archived in the returned list (in progress order).
 */
export function upgradeProgress(
  oldM: ShioriManifestV1,
  newM: ShioriManifestV1,
  progress: readonly GoalProgress[],
): { progress: GoalProgress[]; newGoalIds: string[]; archivedGoalIds: string[] } {
  const present = new Set(goalIds(newM));
  const archivedGoalIds: string[] = [];
  const archivedSeen = new Set<string>();
  const next = progress.map((p): GoalProgress => {
    const archived = !present.has(p.goalId);
    if (archived && !archivedSeen.has(p.goalId)) {
      archivedSeen.add(p.goalId);
      archivedGoalIds.push(p.goalId);
    }
    return { ...p, archived };
  });
  return { progress: next, newGoalIds: diffManifests(oldM, newM).added, archivedGoalIds };
}
