// STUB (UI contract) — provides UiContext: toast host, confirm/prompt dialogs, envelope queue (EnvelopeReveal → SealedReader sheet).
import type { ReactNode } from 'react';

export interface UiProviderProps {
  children: ReactNode;
  onHide(): void;
  onLock(): void;
}
export declare function UiProvider(props: UiProviderProps): ReactNode;
