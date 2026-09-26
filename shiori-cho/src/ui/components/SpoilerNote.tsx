// STUB (UI contract) — F14 AC2: renders note text with `||…||` spans blurred until tapped (plain text only).
import type { ReactNode } from 'react';

export interface SpoilerNoteProps {
  text: string;
  className?: string;
}
export declare function SpoilerNote(props: SpoilerNoteProps): ReactNode;
