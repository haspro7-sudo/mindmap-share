// Emoji tile on a cover color (never an image; no thumbnails are ever fetched).
import type { ReactNode } from 'react';
import type { CoverColor } from '../../core/types';
import { coverColorVar } from '../format';
import './EmojiCover.css';

export interface EmojiCoverProps {
  emoji: string;
  color: CoverColor;
  /** px, default 48 */
  size?: number;
}

export function EmojiCover({ emoji, color, size = 48 }: EmojiCoverProps): ReactNode {
  return (
    <span
      className="ec"
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.24),
        background: coverColorVar(color),
        fontSize: Math.round(size * 0.52),
      }}
    >
      {emoji}
    </span>
  );
}
