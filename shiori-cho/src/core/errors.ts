export type ShioriErrorCode =
  | 'encoding'
  | 'crypto'
  | 'decrypt'
  | 'validation'
  | 'notFound'
  | 'conflict'
  | 'io'
  | 'internal';

/** Error carrying a machine code and a user-facing Japanese message. */
export class ShioriError extends Error {
  readonly code: ShioriErrorCode;
  readonly messageJa: string;

  constructor(code: ShioriErrorCode, messageJa: string, options?: { cause?: unknown }) {
    super(`${code}: ${messageJa}`, options);
    this.name = 'ShioriError';
    this.code = code;
    this.messageJa = messageJa;
  }
}

export function isShioriError(e: unknown): e is ShioriError {
  return e instanceof ShioriError;
}
