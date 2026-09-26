// STUB (contract) — docs/SPEC.md §5.2.
import type { GoalProgress, MissableAlert, ProgressSummary, ShioriManifestV1, SpoilerLevel } from './types';

export declare function computeProgress(m: ShioriManifestV1, progress: readonly GoalProgress[]): ProgressSummary;
export declare function missableAlerts(m: ShioriManifestV1, progress: readonly GoalProgress[], currentCheckpointId?: string): MissableAlert[];
/** true when done with hintTierAtDone === 0 and not archived */
export declare function isNoHint(p: GoalProgress | undefined): boolean;
/** public text with `spoiler` is shown directly iff spoiler <= tolerance */
export declare function isVisible(spoiler: SpoilerLevel, tolerance: SpoilerLevel): boolean;
