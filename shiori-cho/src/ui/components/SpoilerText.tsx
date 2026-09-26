// STUB (UI contract) — F8 AC1: public text gated by spoiler level vs tolerance; tap reveals for the current view only.
import type { ReactNode } from 'react';
import type { SpoilerLevel } from '../../core/types';

export interface SpoilerTextProps {
  text: string;
  spoiler: SpoilerLevel;
  tolerance: SpoilerLevel;
  as?: 'span' | 'p' | 'div';
  className?: string;
}
export declare function SpoilerText(props: SpoilerTextProps): ReactNode;
