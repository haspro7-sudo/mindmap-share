// The 「隠す」 button (F2 AC3): switches to the camouflage notepad in one tap. The header shows it on every
// screen, and every modal layer that covers the header (sheets, dialogs, the envelope reveal) shows its own,
// so hiding is always a single action.
import type { ReactNode } from 'react';

export function HideButton({ onHide, className = '' }: { onHide(): void; className?: string }): ReactNode {
  return (
    <button type="button" className={`btn btn-sm hide-btn ${className}`.trim()} onClick={onHide}>
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
        <path
          d="M3 3l18 18M10.6 5.1A10.4 10.4 0 0 1 12 5c5 0 9 4.5 10 7-.4 1-1.2 2.3-2.4 3.6M6.4 6.4C4.3 7.8 2.7 9.9 2 12c1 2.5 5 7 10 7 1.8 0 3.4-.5 4.8-1.3M9.9 9.9a3 3 0 0 0 4.2 4.2"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span>隠す</span>
    </button>
  );
}
