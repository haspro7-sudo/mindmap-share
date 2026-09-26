// STUB (UI contract) — progress visuals (role="progressbar" with aria-valuenow).
import type { ReactNode } from 'react';

export interface ProgressBarProps {
  /** 0..100 */
  pct: number;
  label?: string;
  compact?: boolean;
}
export declare function ProgressBar(props: ProgressBarProps): ReactNode;

export interface ProgressRingProps {
  /** 0..100 */
  pct: number;
  /** px, default 88 */
  size?: number;
  /** text under the % inside the ring, e.g. 「5 / 8」 */
  caption?: string;
}
export declare function ProgressRing(props: ProgressRingProps): ReactNode;
