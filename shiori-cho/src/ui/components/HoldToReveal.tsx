// STUB (UI contract) — F8 AC2: 600 ms press-and-hold with a progress ring; keyboard/assistive activation opens a confirm dialog instead.
import type { ReactNode } from 'react';

export interface HoldToRevealProps {
  /** button text, e.g. 「ヒント1を見る（長押し）」 */
  label: string;
  onReveal(): void;
  disabled?: boolean;
  /** when set, a confirm dialog is ALWAYS shown after the hold (used for the 答え tier) */
  confirm?: { title: string; body?: string; okLabel?: string };
  holdMs?: number;
}
export declare function HoldToReveal(props: HoldToRevealProps): ReactNode;
