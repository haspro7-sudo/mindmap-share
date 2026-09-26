// F14 AC2: renders note text with `||…||` spans blurred until tapped (plain text only).
// An unclosed `||` is shown literally (parseSpoilerSpans). Each revealed span stays visible for this view.
import { useState } from 'react';
import type { ReactNode } from 'react';
import { parseSpoilerSpans } from '../../core/notes';
import './SpoilerNote.css';

export interface SpoilerNoteProps {
  text: string;
  className?: string;
}

export function SpoilerNote({ text, className }: SpoilerNoteProps): ReactNode {
  const [revealed, setRevealed] = useState<ReadonlySet<number>>(() => new Set());
  const spans = parseSpoilerSpans(text);
  return (
    <div className={className ? `spn ${className}` : 'spn'}>
      {spans.map((span, i) => {
        if (!span.spoiler) return <span key={i}>{span.text}</span>;
        if (revealed.has(i)) {
          return (
            <span key={i} className="spn-open">
              {span.text}
            </span>
          );
        }
        return (
          <button
            key={i}
            type="button"
            className="spn-hidden"
            aria-label="伏せ字（タップで表示）"
            onClick={() => setRevealed((prev) => new Set(prev).add(i))}
          >
            <span className="spn-hidden-text" aria-hidden="true">
              {span.text}
            </span>
          </button>
        );
      })}
    </div>
  );
}
