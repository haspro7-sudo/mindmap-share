// STUB (UI contract) — DLsite store link: hidden when discreet.hideStoreLinks; confirm dialog, then window.open(url, '_blank', 'noopener,noreferrer').
import type { ReactNode } from 'react';

export interface ExternalLinkButtonProps {
  storeCode: string;
  label?: string;
}
export declare function ExternalLinkButton(props: ExternalLinkButtonProps): ReactNode;
