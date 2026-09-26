// F8 AC1: public text gated by spoiler level vs tolerance; tap reveals for the current view only.
// While hidden, the real text is NOT in the DOM (not even blurred): only a neutral placeholder button.
import { useState } from 'react';
import type { ReactNode } from 'react';
import { isVisible } from '../../core/progress';
import type { SpoilerLevel } from '../../core/types';
import './SpoilerText.css';

export interface SpoilerTextProps {
  text: string;
  spoiler: SpoilerLevel;
  tolerance: SpoilerLevel;
  as?: 'span' | 'p' | 'div';
  className?: string;
}

export const SPOILER_PLACEHOLDER = 'ネタバレを含むかもしれません（タップで表示）';

export function SpoilerText({ text, spoiler, tolerance, as = 'span', className }: SpoilerTextProps): ReactNode {
  const [revealed, setRevealed] = useState(false);
  const Tag = as;
  if (revealed || isVisible(spoiler, tolerance)) {
    return <Tag className={className}>{text}</Tag>;
  }
  return (
    <Tag className={className ? `${className} spt-wrap` : 'spt-wrap'}>
      <button type="button" className="spt-btn" onClick={() => setRevealed(true)}>
        <span className="spt-blur" aria-hidden="true" />
        <span className="spt-label">{SPOILER_PLACEHOLDER}</span>
      </button>
    </Tag>
  );
}
