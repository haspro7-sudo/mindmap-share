/**
 * Shared zod building blocks + post-decrypt payload schemas (docs/SPEC.md §4.1, §4.2).
 * Used by crypto/shiori.ts (to validate decrypted payloads) and manifest/schema.ts.
 */
import { z } from 'zod';

// Control characters other than '\n' (and, for single-line fields, '\n' too) are rejected,
// as are bidi override / isolate characters (U+202A–202E, U+2066–2069).
// eslint-disable-next-line no-control-regex
const CONTROL_MULTILINE = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/;
// eslint-disable-next-line no-control-regex
const CONTROL_SINGLELINE = /[\u0000-\u001F\u007F-\u009F]/;
const BIDI = /[\u202A-\u202E\u2066-\u2069]/;

export const CONTROL_CHAR_CODE = 'controlChar';
export const BIDI_CHAR_CODE = 'bidiChar';

/** Single-line text with length bounds (inclusive), no control or bidi characters. */
export function text(min: number, max: number) {
  return z
    .string()
    .min(min)
    .max(max)
    .refine((s) => !CONTROL_SINGLELINE.test(s), { params: { code: CONTROL_CHAR_CODE } })
    .refine((s) => !BIDI.test(s), { params: { code: BIDI_CHAR_CODE } });
}

/** Multi-line text ('\n' allowed) with length bounds (inclusive), no other control or bidi characters. */
export function multiline(min: number, max: number) {
  return z
    .string()
    .min(min)
    .max(max)
    .refine((s) => !CONTROL_MULTILINE.test(s), { params: { code: CONTROL_CHAR_CODE } })
    .refine((s) => !BIDI.test(s), { params: { code: BIDI_CHAR_CODE } });
}

export const STORE_CODE_RE = /^(RJ|VJ|BJ)(\d{6}|\d{8})$/;

export const goalSecretSchema = z.object({
  title: text(1, 60),
  description: multiline(0, 500).optional(),
  unlockMessage: multiline(0, 300).optional(),
});

export const sealedPayloadSchema = z.object({
  title: text(1, 60),
  body: multiline(0, 20000),
  from: text(0, 40).optional(),
  returnCode: z
    .object({
      code: text(1, 40),
      instruction: multiline(1, 200),
    })
    .optional(),
  storeLink: z
    .object({
      storeCode: z.string().regex(STORE_CODE_RE),
      caption: text(1, 60),
    })
    .optional(),
});
