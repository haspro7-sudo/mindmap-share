// STUB (UI contract) — emoji tile on a cover color (never an image; no thumbnails are ever fetched).
import type { ReactNode } from 'react';
import type { CoverColor } from '../../core/types';

export interface EmojiCoverProps {
  emoji: string;
  color: CoverColor;
  /** px, default 48 */
  size?: number;
}
export declare function EmojiCover(props: EmojiCoverProps): ReactNode;
