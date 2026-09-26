// Global header: back button (non-top-level routes; goes back in history, else to a sensible parent),
// 「しおり帳」, and the 「隠す」 button (F2 AC3) on every screen.
import type { ReactNode } from 'react';
import { goBack, useRoute } from '../router';
import { BrandMark } from './BrandMark';
import { isTopLevel, parentRoute } from './navigation';
import './Header.css';

export function Header({ onHide }: { onHide(): void }): ReactNode {
  const route = useRoute();
  const showBack = !isTopLevel(route);
  return (
    <header className="hdr">
      <div className="hdr-inner">
        {showBack ? (
          <button type="button" className="icon-btn hdr-back" onClick={() => goBack(parentRoute(route))} aria-label="戻る">
            <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
              <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        ) : null}
        <a className={`hdr-title${showBack ? '' : ' is-top'}`} href="#/">
          <BrandMark size={24} />
          <span>しおり帳</span>
        </a>
        <span className="spacer" />
        <button type="button" className="btn btn-sm hdr-hide" onClick={onHide}>
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
      </div>
    </header>
  );
}
