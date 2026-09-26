/**
 * zod 4 schemas for backup files (docs/SPEC.md §5.5, F15).
 *
 * The data schema enforces what each record must satisfy on its own: required fields, primitive types, enum
 * values, tier and spoiler ranges, and finite, non-negative timestamps. Manifests are checked with the shiori/1
 * manifest schema, and store codes and manifest work ids with their contract patterns. The rules between records
 * (validateManifest's cross-checks, true manifest keys, one work per manifestWorkId, one open session, …) are
 * enforced by normalizeBackupData (integrity.ts), which the restore service runs before `replaceAll()`.
 *
 * Free text the player typed (titles, aliases, notes, session notes, the camouflage text) is only
 * bounded in size. The UI's input rules are not applied again, so a restore never fails because of a
 * pasted tab character or an emoji-heavy title.
 *
 * Unknown keys are stripped (zod default). This also drops Redemption.master/masterSalt.
 */
import { z } from 'zod';
import { BACKUP_FORMAT } from '../constants';
import { BACKUP_ITERATIONS_MAX, BACKUP_SALT_BYTES } from '../crypto/backupCrypto';
import { GCM_IV_BYTES, GCM_TAG_BYTES } from '../crypto/primitives';
import { b64uDecode } from '../encoding';
import { STORE_CODE_RE } from '../manifest/payloadSchemas';
import { WORK_ID_RE, WORK_KINDS, manifestSchema } from '../manifest/schema';
import type {
  BackupDataV1,
  BackupFileV1,
  EncryptedJson,
  GoalProgress,
  HintReveal,
  ManifestRecord,
  Note,
  PendingCode,
  Redemption,
  SealedOpen,
  Session,
  WorkRecord,
} from '../types';

/** Size caps for backup fields. They are generous on purpose: they bound the data, not the UI input. */
export const BACKUP_LIMITS = {
  /** record ids, goal/sealed/checkpoint ids, manifest keys */
  id: 200,
  /** titles, aliases, session notes, canonical codes */
  shortText: 1_000,
  /** WorkRecord.coverEmoji (one emoji can be a long ZWJ sequence) */
  emoji: 64,
  /** Note.text, Settings.camouflageText */
  longText: 100_000,
  /** BackupFileV1.appVersion */
  appVersion: 100,
} as const;

export const WORK_STATUSES = ['backlog', 'playing', 'cleared', 'completed', 'paused'] as const;
export const COVER_COLORS = ['paper', 'sky', 'leaf', 'sun', 'rose', 'plum', 'slate'] as const;
export const MANIFEST_SOURCES = ['bundled', 'file', 'paste', 'quick', 'player-edit'] as const;

// ───────────────────────── Building blocks ─────────────────────────

const idString = z.string().min(1).max(BACKUP_LIMITS.id);
const shortText = z.string().max(BACKUP_LIMITS.shortText);
const longText = z.string().max(BACKUP_LIMITS.longText);
/** epoch ms (zod 4 numbers are always finite) */
const timestamp = z.number().nonnegative();

/** base64url string whose decoded length is within [min, max] bytes. */
function b64uLength(min: number, max: number) {
  return z.string().refine((s) => {
    try {
      const n = b64uDecode(s).length;
      return n >= min && n <= max;
    } catch {
      return false;
    }
  });
}

// ───────────────────────── Records ─────────────────────────

export const workRecordSchema: z.ZodType<WorkRecord> = z.object({
  id: idString,
  title: shortText.min(1),
  alias: shortText.min(1),
  storeCode: z.string().regex(STORE_CODE_RE).optional(),
  kind: z.enum(WORK_KINDS),
  status: z.enum(WORK_STATUSES),
  coverEmoji: z.string().max(BACKUP_LIMITS.emoji),
  coverColor: z.enum(COVER_COLORS),
  spoilerTolerance: z.literal([0, 1, 2, 3]),
  manifestKey: idString.optional(),
  manifestWorkId: z.string().regex(WORK_ID_RE).optional(),
  currentCheckpointId: idString.optional(),
  newGoalIds: z.array(idString),
  createdAt: timestamp,
  updatedAt: timestamp,
  lastPlayedAt: timestamp.optional(),
});

export const manifestRecordSchema: z.ZodType<ManifestRecord> = z.object({
  key: idString,
  workId: idString,
  manifest: manifestSchema,
  source: z.enum(MANIFEST_SOURCES),
  importedAt: timestamp,
});

export const goalProgressSchema: z.ZodType<GoalProgress> = z.object({
  workId: idString,
  goalId: idString,
  via: z.enum(['manual', 'code']),
  doneAt: timestamp,
  hintTierAtDone: z.literal([0, 1, 2, 3]),
  archived: z.boolean(),
});

/** master/masterSalt are deliberately absent, so parsing strips them. */
export const redemptionSchema: z.ZodType<Redemption> = z.object({
  workId: idString,
  goalId: idString,
  canonical: shortText.min(1),
  redeemedAt: timestamp,
});

export const hintRevealSchema: z.ZodType<HintReveal> = z.object({
  workId: idString,
  goalId: idString,
  tier: z.literal([1, 2, 3]),
  updatedAt: timestamp,
});

export const sessionSchema: z.ZodType<Session> = z.object({
  id: idString,
  workId: idString,
  startedAt: timestamp,
  endedAt: timestamp.optional(),
  minutes: z.number().nonnegative().optional(),
  checkpointId: idString.optional(),
  whereNote: shortText.optional(),
  nextTodo: shortText.optional(),
});

export const noteSchema: z.ZodType<Note> = z.object({
  id: idString,
  workId: idString,
  goalId: idString.optional(),
  text: longText,
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const pendingCodeSchema: z.ZodType<PendingCode> = z.object({
  id: idString,
  canonical: shortText.min(1),
  manifestWorkIdHint: shortText.optional(),
  receivedAt: timestamp,
});

export const sealedOpenSchema: z.ZodType<SealedOpen> = z.object({
  workId: idString,
  sealedId: idString,
  firstOpenedAt: timestamp,
  seen: z.boolean(),
});

/** Only these three settings travel in a backup (never the PIN, the age flag or other local state). */
export const backupSettingsSchema: z.ZodType<BackupDataV1['settings']> = z.object({
  discreet: z.object({
    aliasOnly: z.boolean(),
    blurOnHide: z.boolean(),
    hideStoreLinks: z.boolean(),
    blurExtras: z.boolean(),
  }),
  autoLockSec: z.literal([0, 30, 60, 300]),
  camouflageText: longText,
});

export const backupDataSchema: z.ZodType<BackupDataV1> = z.object({
  works: z.array(workRecordSchema),
  manifests: z.array(manifestRecordSchema),
  progress: z.array(goalProgressSchema),
  redemptions: z.array(redemptionSchema),
  hints: z.array(hintRevealSchema),
  sessions: z.array(sessionSchema),
  notes: z.array(noteSchema),
  pending: z.array(pendingCodeSchema),
  sealedOpens: z.array(sealedOpenSchema),
  settings: backupSettingsSchema,
});

// ───────────────────────── File envelope ─────────────────────────

/** Shape of the passphrase envelope. decryptJson checks it again; this gives 'schema' instead of 'passphrase'. */
export const encryptedJsonSchema: z.ZodType<EncryptedJson> = z.object({
  kdf: z.object({
    alg: z.literal('PBKDF2-SHA256'),
    iterations: z.number().int().min(1).max(BACKUP_ITERATIONS_MAX),
    salt: b64uLength(BACKUP_SALT_BYTES, BACKUP_SALT_BYTES),
  }),
  iv: b64uLength(GCM_IV_BYTES, GCM_IV_BYTES),
  ct: b64uLength(GCM_TAG_BYTES, Number.MAX_SAFE_INTEGER),
});

const fileHeaderShape = {
  format: z.literal(BACKUP_FORMAT),
  version: z.literal(1),
  exportedAt: timestamp,
  appVersion: z.string().max(BACKUP_LIMITS.appVersion),
};

export const plainBackupFileSchema = z.object({
  ...fileHeaderShape,
  encrypted: z.literal(false),
  data: backupDataSchema,
});

export const encryptedBackupFileSchema = z.object({
  ...fileHeaderShape,
  encrypted: z.literal(true),
  enc: encryptedJsonSchema,
});

export const backupFileSchema: z.ZodType<BackupFileV1> = z.discriminatedUnion('encrypted', [
  plainBackupFileSchema,
  encryptedBackupFileSchema,
]);
