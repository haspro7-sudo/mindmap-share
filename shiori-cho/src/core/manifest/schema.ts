/**
 * zod 4 schemas for the shiori/1 manifest and studio project files (docs/SPEC.md §4.1–4.2, §5.1).
 *
 * Structural checks live here: types, string lengths, patterns, collection sizes, the byte length of
 * every base64url binary field and the kdf iteration range. Cross-reference checks (duplicate ids,
 * dangling references, kdf presence, tag uniqueness, sealed conditions) live in validate.ts.
 * Unknown keys are stripped (zod default). Custom issues carry `params.code` for messagesJa.ts.
 */
import { z } from 'zod';
import { KDF_ITERATIONS_DEFAULT, KDF_ITERATIONS_MAX, KDF_ITERATIONS_MIN } from '../constants';
import { b64uDecode } from '../encoding';
import type { EncBox, Goal, ShioriManifestV1, StudioProject } from '../types';
import { STORE_CODE_RE, goalSecretSchema, multiline, sealedPayloadSchema, text } from './payloadSchemas';

// ───────────────────────── Patterns & enums ─────────────────────────

/** ManifestWork.id */
export const WORK_ID_RE = /^[a-z0-9][a-z0-9-]{3,39}$/;
/** checkpoint / group / goal / sealed ids */
export const ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
/** ManifestWork.version and ChangelogEntry.version */
export const VERSION_RE = /^[0-9A-Za-z.+-]{1,20}$/;
/** ChangelogEntry.date (YYYY-MM-DD) */
export const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export const WORK_KINDS = ['game', 'voice', 'cg', 'comic', 'other'] as const;
export const ENGINES = ['rpgmaker-mz', 'rpgmaker-mv', 'tyrano', 'wolf', 'renpy', 'unity', 'other'] as const;
export const CODE_KINDS = ['b32', 'kana'] as const;
export const SEALED_KINDS = ['letter', 'afterword', 'story', 'profile', 'returnCode'] as const;
export const AUTHOR_KINDS = ['creator', 'player'] as const;

/** Collection size limits of a shiori/1 manifest. */
export const MANIFEST_LIMITS = {
  checkpoints: 50,
  groupsMin: 1,
  groups: 20,
  goals: 500,
  sealed: 50,
  changelog: 100,
  hints: 3,
  sealedGoals: 50,
} as const;

/** Decoded byte-length limits of binary (base64url) fields, with the issue code used when violated. */
export const BINARY_LIMITS = {
  salt: { min: 16, max: 16, code: 'saltLength' },
  iv: { min: 12, max: 12, code: 'ivLength' },
  tag: { min: 16, max: 16, code: 'tagLength' },
  ct: { min: 16, max: 65552, code: 'ctLength' },
  wrap: { min: 48, max: 48, code: 'wrapLength' },
} as const;
export type BinaryKind = keyof typeof BINARY_LIMITS;

// ───────────────────────── Shared building blocks ─────────────────────────

const idSchema = z.string().regex(ID_RE);
const spoilerSchema = z.literal([0, 1, 2, 3]).default(0);

/** base64url string whose decoded length is within BINARY_LIMITS[kind]. */
export function b64uBytes(kind: BinaryKind) {
  const lim = BINARY_LIMITS[kind];
  return z.string().superRefine((s, ctx) => {
    let n: number;
    try {
      n = b64uDecode(s).length;
    } catch {
      ctx.addIssue({ code: 'custom', message: 'invalid base64url', params: { code: 'invalidBase64' } });
      return;
    }
    if (n < lim.min || n > lim.max) {
      ctx.addIssue({
        code: 'custom',
        message: `${kind}: ${n} bytes`,
        params: { code: lim.code, actual: n, min: lim.min, max: lim.max },
      });
    }
  });
}

/** Array of goal ids, 1..50, unique (duplicates reported at their index as 'duplicateRef'). */
const goalRefsSchema = z
  .array(idSchema)
  .min(1)
  .max(MANIFEST_LIMITS.sealedGoals)
  .superRefine((ids, ctx) => {
    const seen = new Set<string>();
    ids.forEach((id, i) => {
      if (seen.has(id)) {
        ctx.addIssue({ code: 'custom', path: [i], message: 'duplicate goal reference', params: { code: 'duplicateRef', id } });
      }
      seen.add(id);
    });
  });

export const encBoxSchema = z.object({
  iv: b64uBytes('iv'),
  ct: b64uBytes('ct'),
});

export const kdfSchema = z.object({
  alg: z.literal('PBKDF2-SHA256'),
  iterations: z
    .number()
    .refine((n) => Number.isInteger(n) && n >= KDF_ITERATIONS_MIN && n <= KDF_ITERATIONS_MAX, {
      params: { code: 'kdfIterations' },
    }),
  salt: b64uBytes('salt'),
});

export const workSchema = z.object({
  id: z.string().regex(WORK_ID_RE),
  title: text(1, 100),
  safeTitle: text(1, 40).optional(),
  circle: text(0, 60).optional(),
  storeCode: z.string().regex(STORE_CODE_RE).optional(),
  kind: z.enum(WORK_KINDS),
  engine: z.enum(ENGINES).optional(),
  version: z.string().regex(VERSION_RE),
});

const authorSchema = z.object({
  kind: z.enum(AUTHOR_KINDS),
  name: text(0, 60).optional(),
});

const checkpointSchema = z.object({ id: idSchema, label: text(1, 40) });
const groupSchema = z.object({ id: idSchema, label: text(1, 20) });
const missableSchema = z.object({ before: idSchema, warn: text(1, 120) });

const manualUnlockSchema = z.object({ type: z.literal('manual') });
const codeUnlockSchema = z.object({
  type: z.literal('code'),
  codeKind: z.enum(CODE_KINDS),
  tag: b64uBytes('tag'),
});

/**
 * The discriminator of a goal is nested (`unlock.type`), which zod's discriminatedUnion cannot express.
 * The goal is parsed as one object whose `secret` is validated only for code goals (and stripped from
 * manual goals), then transformed into the typed `Goal` union. This keeps error paths exact.
 */
const goalObjectSchema = z
  .object({
    id: idSchema,
    group: idSchema,
    label: text(1, 60),
    teaser: text(1, 120).optional(),
    spoiler: spoilerSchema,
    hints: z.array(text(1, 200)).max(MANIFEST_LIMITS.hints).default([]),
    missable: missableSchema.optional(),
    unlock: z.discriminatedUnion('type', [manualUnlockSchema, codeUnlockSchema]),
    secret: z.unknown().optional(),
  })
  .superRefine((g, ctx) => {
    // Runs only when `unlock` parsed at the type level (zod skips refinements after aborting issues).
    if (typeof g.unlock !== 'object' || g.unlock === null || g.unlock.type !== 'code') return;
    if (g.secret === undefined) {
      ctx.addIssue({ code: 'custom', path: ['secret'], message: 'required', params: { code: 'required' } });
      return;
    }
    const r = encBoxSchema.safeParse(g.secret, { reportInput: true });
    if (r.success) return;
    for (const iss of r.error.issues) {
      const path = ['secret', ...iss.path];
      if (iss.code === 'invalid_type' && 'input' in iss && iss.input === undefined) {
        ctx.addIssue({ code: 'custom', path, message: 'required', params: { code: 'required' } });
      } else {
        const { input: _input, ...rest } = iss;
        ctx.addIssue({ ...rest, path });
      }
    }
  });

export const goalSchema = goalObjectSchema.transform((g): Goal => {
  const common = {
    id: g.id,
    group: g.group,
    label: g.label,
    ...(g.teaser !== undefined ? { teaser: g.teaser } : {}),
    spoiler: g.spoiler,
    hints: g.hints,
    ...(g.missable !== undefined ? { missable: g.missable } : {}),
  };
  if (g.unlock.type === 'code') {
    // Already validated by the refinement above; parse again to get the stripped output.
    const secret: EncBox = encBoxSchema.parse(g.secret);
    return { ...common, unlock: g.unlock, secret };
  }
  return { ...common, unlock: g.unlock };
});

const anyOfWrapSchema = z.object({
  goal: idSchema,
  iv: b64uBytes('iv'),
  ct: b64uBytes('wrap'),
});

const sealedUnlockSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('allOf'), goals: goalRefsSchema }),
  z.object({
    mode: z.literal('anyOf'),
    goals: goalRefsSchema,
    wraps: z.array(anyOfWrapSchema).min(1).max(MANIFEST_LIMITS.sealedGoals),
  }),
]);

export const sealedItemSchema = z.object({
  id: idSchema,
  label: text(1, 40),
  teaser: text(1, 120).optional(),
  kind: z.enum(SEALED_KINDS),
  unlock: sealedUnlockSchema,
  box: encBoxSchema,
});

const changelogEntrySchema = z.object({
  version: z.string().regex(VERSION_RE),
  date: z.string().regex(DATE_RE),
  notes: multiline(0, 500),
});

// ───────────────────────── Manifest ─────────────────────────

/** Structural schema for ShioriManifestV1 (cross-reference checks live in validate.ts). */
export const manifestSchema: z.ZodType<ShioriManifestV1> = z.object({
  schema: z.literal('shiori/1'),
  work: workSchema,
  author: authorSchema,
  kdf: kdfSchema.optional(),
  checkpoints: z.array(checkpointSchema).max(MANIFEST_LIMITS.checkpoints).default([]),
  groups: z.array(groupSchema).min(MANIFEST_LIMITS.groupsMin).max(MANIFEST_LIMITS.groups),
  goals: z.array(goalSchema).max(MANIFEST_LIMITS.goals),
  sealed: z.array(sealedItemSchema).max(MANIFEST_LIMITS.sealed).default([]),
  changelog: z.array(changelogEntrySchema).max(MANIFEST_LIMITS.changelog).default([]),
});

// ───────────────────────── Studio project (drafts) ─────────────────────────
// Drafts may be incomplete while the creator edits them: ids and labels may be empty and are not
// pattern-checked (buildManifest + validateManifest + lintProject catch that before export).
// Maximum lengths, collection sizes, enums and number types are still enforced.

const draftId = text(0, 40);

const draftWorkSchema = z.object({
  id: text(0, 40),
  title: text(0, 100),
  safeTitle: text(0, 40).optional(),
  circle: text(0, 60).optional(),
  storeCode: text(0, 20).optional(),
  kind: z.enum(WORK_KINDS),
  engine: z.enum(ENGINES).optional(),
  version: text(0, 20),
});

const draftGoalSchema = z.object({
  id: draftId,
  group: draftId,
  label: text(0, 60),
  teaser: text(0, 120).optional(),
  spoiler: spoilerSchema,
  hints: z.array(text(0, 200)).max(MANIFEST_LIMITS.hints).default([]),
  missable: z.object({ before: draftId, warn: text(0, 120) }).optional(),
  unlockType: z.enum(['manual', 'code']),
  codeKind: z.enum(CODE_KINDS).optional(),
  code: text(0, 60).optional(),
  secret: goalSecretSchema.optional(),
});

const draftSealedSchema = z.object({
  id: draftId,
  label: text(0, 40),
  teaser: text(0, 120).optional(),
  kind: z.enum(SEALED_KINDS),
  mode: z.enum(['allOf', 'anyOf']),
  goals: z.array(draftId).max(MANIFEST_LIMITS.sealedGoals).default([]),
  payload: sealedPayloadSchema,
});

const timestampSchema = z.number().nonnegative();

/** Schema for StudioProject files ('shiori-studio-project', version 1). */
export const studioProjectSchema: z.ZodType<StudioProject> = z.object({
  format: z.literal('shiori-studio-project'),
  version: z.literal(1),
  id: text(1, 100),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  lastExportedAt: timestampSchema.optional(),
  appUrl: text(0, 2000),
  work: draftWorkSchema,
  authorName: text(0, 60).optional(),
  kdfIterations: z.number().int().min(1).max(KDF_ITERATIONS_MAX).default(KDF_ITERATIONS_DEFAULT),
  kdfSalt: b64uBytes('salt').optional(),
  checkpoints: z.array(z.object({ id: draftId, label: text(0, 40) })).max(MANIFEST_LIMITS.checkpoints).default([]),
  groups: z.array(z.object({ id: draftId, label: text(0, 20) })).max(MANIFEST_LIMITS.groups).default([]),
  goals: z.array(draftGoalSchema).max(MANIFEST_LIMITS.goals).default([]),
  sealed: z.array(draftSealedSchema).max(MANIFEST_LIMITS.sealed).default([]),
  changelog: z
    .array(z.object({ version: text(0, 20), date: text(0, 10), notes: multiline(0, 500) }))
    .max(MANIFEST_LIMITS.changelog)
    .default([]),
});
