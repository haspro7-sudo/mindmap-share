// STUB (UI contract) — F10: large code input with live format feedback via parseCode (no KDF here).
import type { ReactNode } from 'react';

export interface CodeInputProps {
  value: string;
  onChange(value: string): void;
  onSubmit(): void;
  busy?: boolean;
  autoFocus?: boolean;
  /** id for <label htmlFor> */
  id?: string;
}
export declare function CodeInput(props: CodeInputProps): ReactNode;
