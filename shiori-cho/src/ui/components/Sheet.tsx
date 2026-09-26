// STUB (UI contract) — bottom sheet modal (role="dialog", aria-modal, focus trap, Escape/backdrop closes, safe-area padding).
import type { ReactNode } from 'react';

export interface SheetProps {
  open: boolean;
  onClose(): void;
  title?: string;
  children: ReactNode;
  /** sticky footer area (buttons) */
  footer?: ReactNode;
}
export declare function Sheet(props: SheetProps): ReactNode;
