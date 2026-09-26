// STUB (contract) — docs/SPEC.md §5.2.
import type { GoalProgress, ManifestDiff, ShioriManifestV1 } from '../types';

export declare function diffManifests(oldM: ShioriManifestV1, newM: ShioriManifestV1): ManifestDiff;
export declare function upgradeProgress(
  oldM: ShioriManifestV1,
  newM: ShioriManifestV1,
  progress: readonly GoalProgress[],
): { progress: GoalProgress[]; newGoalIds: string[]; archivedGoalIds: string[] };
