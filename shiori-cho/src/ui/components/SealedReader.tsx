// STUB (UI contract) — F12 AC3: reads (decrypts) a sealed item via app/unlock.readSealed and renders it as plain text:
// title, body (pre-wrap), `from` signature for letters, returnCode (large monospace + コピー + instruction),
// storeLink (button hidden when hideStoreLinks; confirm before opening), blurExtras support.
import type { ReactNode } from 'react';

export interface SealedReaderProps {
  workId: string;
  sealedId: string;
}
export declare function SealedReader(props: SealedReaderProps): ReactNode;
