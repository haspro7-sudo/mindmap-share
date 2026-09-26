// Bottom sheet modal (role="dialog", aria-modal, focus trap, Escape/backdrop closes, scroll lock,
// safe-area padding). On wide screens it becomes a centered panel (max 560 px).
// The sheet covers the header, so it carries its own 「隠す」 (F2 AC3: hiding is one tap from every screen)
// whenever it is rendered inside the app's UiProvider.
import { useContext, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { UiContext } from '../context';
import { HideButton } from './HideButton';
import { useFocusTrap, useOverlayLayer, useScrollLock } from './overlay';
import { useHtmlFlag } from './toastLift';
import './Sheet.css';

export interface SheetProps {
  open: boolean;
  onClose(): void;
  title?: string;
  children: ReactNode;
  /** sticky footer area (buttons) */
  footer?: ReactNode;
}

export function Sheet(props: SheetProps): ReactNode {
  const { open, onClose, title, children, footer } = props;
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const ui = useContext(UiContext);

  useOverlayLayer(open, onClose);
  useScrollLock(open);
  useFocusTrap(panelRef, open);
  // toasts drop back to their normal place while a sheet covers sticky bottom bars (UiProvider.css)
  useHtmlFlag('sheet-open', open);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="sheet-root">
      <div className="sheet-backdrop" aria-hidden="true" onClick={onClose} />
      <div
        ref={panelRef}
        className="sheet-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : 'シート'}
        tabIndex={-1}
      >
        <div className="sheet-grip" aria-hidden="true" />
        <div className="sheet-head">
          {title ? (
            <h2 id={titleId} className="sheet-title">
              {title}
            </h2>
          ) : (
            <span className="spacer" />
          )}
          {ui ? <HideButton onHide={() => ui.hide()} className="btn-ghost sheet-hide" /> : null}
          <button type="button" className="icon-btn sheet-close" onClick={onClose} aria-label="閉じる">
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
            </svg>
          </button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer ? <div className="sheet-footer">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
