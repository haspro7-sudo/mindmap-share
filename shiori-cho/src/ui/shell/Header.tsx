// Global header: back button (non-top-level routes; goes back in history, else to a sensible parent),
// 「しおり帳」, and the 「隠す」 button (F2 AC3) on every screen.
import type { ReactNode } from 'react';
import { HideButton } from '../components/HideButton';
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
        <HideButton onHide={onHide} className="hdr-hide" />
      </div>
    </header>
  );
}
