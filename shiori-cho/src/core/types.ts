/**
 * CONTRACT: shared types for しおり帳 (docs/SPEC.md §4.1, §5.1, §7.2).
 * Changing anything here affects every module. Keep additions backwards compatible.
 */

/** Byte arrays backed by a real ArrayBuffer (what WebCrypto accepts). */
export type Bytes = Uint8Array<ArrayBuffer>;

/** base64url (RFC 4648 §5), NO padding */
export type B64u = string;
export type SpoilerLevel = 0 | 1 | 2 | 3;
export type WorkKind = 'game' | 'voice' | 'cg' | 'comic' | 'other';
export type Engine = 'rpgmaker-mz' | 'rpgmaker-mv' | 'tyrano' | 'wolf' | 'renpy' | 'unity' | 'other';
export type CodeKind = 'b32' | 'kana';
export type SealedKind = 'letter' | 'afterword' | 'story' | 'profile' | 'returnCode';

export interface EncBox {
  /** exactly 12 bytes */
  iv: B64u;
  /** 16..65552 bytes: ciphertext||GCM tag */
  ct: B64u;
}
export interface KdfParams {
  alg: 'PBKDF2-SHA256';
  iterations: number;
  /** exactly 16 bytes */
  salt: B64u;
}

// ───────────────────────── Manifest (shiori.json, schema "shiori/1") ─────────────────────────

export interface ManifestWork {
  /** /^[a-z0-9][a-z0-9-]{3,39}$/ ; editor generates opaque "w-" + 10 lowercase base32 chars */
  id: string;
  /** 1..100 */
  title: string;
  /** 1..40 — default alias on import */
  safeTitle?: string;
  /** 0..60 */
  circle?: string;
  /** /^(RJ|VJ|BJ)(\d{6}|\d{8})$/ (already normalized) */
  storeCode?: string;
  kind: WorkKind;
  engine?: Engine;
  /** /^[0-9A-Za-z.+-]{1,20}$/ */
  version: string;
}
/** array order = story order */
export interface Checkpoint {
  id: string;
  /** 1..40 */
  label: string;
}
export interface Group {
  id: string;
  /** 1..20 */
  label: string;
}

export interface GoalCommon {
  /** /^[a-z0-9][a-z0-9_-]{0,39}$/ (goal/group/checkpoint/sealed ids share this pattern) */
  id: string;
  /** -> Group.id */
  group: string;
  /** 1..60, PUBLIC ("END 3", "？？？") */
  label: string;
  /** 1..120, PUBLIC */
  teaser?: string;
  /** spoiler level of this goal's PUBLIC text; file default 0 */
  spoiler: SpoilerLevel;
  /** 0..3 tiers, each 1..200, PUBLIC; tier order = 示唆, 方向, 答え */
  hints: string[];
  missable?: { before: string; warn: string };
}
export interface ManualGoal extends GoalCommon {
  unlock: { type: 'manual' };
}
export interface CodeGoal extends GoalCommon {
  unlock: { type: 'code'; codeKind: CodeKind; /** exactly 16 bytes */ tag: B64u };
  /** AES-GCM(JSON(GoalSecret)) */
  secret: EncBox;
}
export type Goal = ManualGoal | CodeGoal;

/** Decrypted content of CodeGoal.secret */
export interface GoalSecret {
  /** 1..60 */
  title: string;
  /** ≤500 */
  description?: string;
  /** ≤300 */
  unlockMessage?: string;
}

export interface AnyOfWrap {
  goal: string;
  iv: B64u;
  /** 48 bytes: wrapped 32-byte CEK + tag */
  ct: B64u;
}
export type SealedUnlock =
  | { mode: 'allOf'; goals: string[] }
  | { mode: 'anyOf'; goals: string[]; wraps: AnyOfWrap[] };

export interface SealedItem {
  id: string;
  /** 1..40 PUBLIC */
  label: string;
  /** 1..120 PUBLIC */
  teaser?: string;
  kind: SealedKind;
  unlock: SealedUnlock;
  /** AES-GCM(JSON(SealedPayload)) */
  box: EncBox;
}
/** Decrypted content of SealedItem.box (TEXT ONLY in v1) */
export interface SealedPayload {
  /** 1..60 */
  title: string;
  /** 0..20000, '\n' newlines, rendered as plain text */
  body: string;
  /** ≤40 */
  from?: string;
  returnCode?: { code: string; instruction: string };
  storeLink?: { storeCode: string; caption: string };
}
export interface ChangelogEntry {
  version: string;
  /** YYYY-MM-DD */
  date: string;
  /** ≤500 */
  notes: string;
}

export interface ShioriManifestV1 {
  schema: 'shiori/1';
  work: ManifestWork;
  /** a CLAIM, never verified */
  author: { kind: 'creator' | 'player'; name?: string };
  /** REQUIRED iff any CodeGoal or SealedItem exists */
  kdf?: KdfParams;
  checkpoints: Checkpoint[];
  groups: Group[];
  goals: Goal[];
  sealed: SealedItem[];
  changelog: ChangelogEntry[];
}

// ───────────────────────── Validation ─────────────────────────

export interface ValidationIssue {
  /** e.g. 'goals[3].hints[1]' ('' for the root) */
  path: string;
  /** machine-readable code, e.g. 'duplicateId', 'tooLong', 'schemaVersion' */
  code: string;
  messageJa: string;
  severity: 'error' | 'warning';
}
export type ValidateResult =
  | { ok: true; manifest: ShioriManifestV1; warnings: ValidationIssue[] }
  | { ok: false; errors: ValidationIssue[]; warnings: ValidationIssue[] };

// ───────────────────────── Codes (合言葉) ─────────────────────────

export type CodeError =
  | { kind: 'empty' }
  | { kind: 'charset'; char?: string }
  | { kind: 'mixed' }
  | { kind: 'length'; got: number; expected: number }
  | { kind: 'checksum' }
  | { kind: 'wordCount'; got: number; expected: number }
  /** index is 0-based; the message shows index+1 (「3語目『〇〇』が見つかりません」) */
  | { kind: 'unknownWord'; index: number; word: string };

export type ParsedCode =
  | {
      ok: true;
      kind: CodeKind;
      /** "b32:" + 9 chars | "kana:" + 15 hiragana */
      canonical: string;
      /** "XXX-XXX-XXX" | "ほたる・かえで・つばめ・こだま・すずめ" */
      display: string;
    }
  | { ok: false; kind?: CodeKind; error: CodeError };

// ───────────────────────── Player data (local only) ─────────────────────────

export type WorkStatus = 'backlog' | 'playing' | 'cleared' | 'completed' | 'paused';
export type CoverColor = 'paper' | 'sky' | 'leaf' | 'sun' | 'rose' | 'plum' | 'slate';
export type ManifestSource = 'bundled' | 'file' | 'paste' | 'quick' | 'player-edit';

export interface WorkRecord {
  /** crypto.randomUUID() */
  id: string;
  /** real title 1..100 */
  title: string;
  /** 1..40 */
  alias: string;
  /** normalized RJ/VJ/BJ */
  storeCode?: string;
  kind: WorkKind;
  /** default 'backlog' */
  status: WorkStatus;
  /** default '📘' */
  coverEmoji: string;
  /** default 'paper' */
  coverColor: CoverColor;
  /** default 1 */
  spoilerTolerance: SpoilerLevel;
  /** -> ManifestRecord.key (absent = "記録だけ") */
  manifestKey?: string;
  /** copy of manifest.work.id */
  manifestWorkId?: string;
  currentCheckpointId?: string;
  /** NEW badges after manifest update */
  newGoalIds: string[];
  createdAt: number;
  updatedAt: number;
  lastPlayedAt?: number;
}
export interface ManifestRecord {
  /** b64u(SHA-256(utf8(JSON.stringify(manifest)))) of the *validated* object */
  key: string;
  /** -> WorkRecord.id */
  workId: string;
  manifest: ShioriManifestV1;
  source: ManifestSource;
  importedAt: number;
}
/** exists only when done */
export interface GoalProgress {
  workId: string;
  goalId: string;
  via: 'manual' | 'code';
  doneAt: number;
  hintTierAtDone: 0 | 1 | 2 | 3;
  archived: boolean;
}
export interface Redemption {
  workId: string;
  goalId: string;
  canonical: string;
  redeemedAt: number;
  /** cache; valid only while masterSalt === manifest.kdf.salt; never exported */
  master?: B64u;
  masterSalt?: B64u;
}
export interface HintReveal {
  workId: string;
  goalId: string;
  tier: 1 | 2 | 3;
  updatedAt: number;
}
export interface Session {
  id: string;
  workId: string;
  startedAt: number;
  endedAt?: number;
  minutes?: number;
  checkpointId?: string;
  whereNote?: string;
  nextTodo?: string;
}
export interface Note {
  id: string;
  workId: string;
  goalId?: string;
  text: string;
  createdAt: number;
  updatedAt: number;
}
export interface PendingCode {
  id: string;
  canonical: string;
  manifestWorkIdHint?: string;
  receivedAt: number;
}
export interface SealedOpen {
  workId: string;
  sealedId: string;
  firstOpenedAt: number;
  seen: boolean;
}

export interface DiscreetSettings {
  aliasOnly: boolean;
  blurOnHide: boolean;
  hideStoreLinks: boolean;
  blurExtras: boolean;
}
export interface PinRecord {
  salt: B64u;
  iterations: number;
  hash: B64u;
}
export interface Settings {
  schemaVersion: 1;
  ageConfirmedAt?: number;
  onboardedAt?: number;
  discreet: DiscreetSettings;
  camouflageText: string;
  pin?: PinRecord;
  autoLockSec: 0 | 30 | 60 | 300;
  pinFailures: number;
  pinCooldownUntil?: number;
  lastBackupAt?: number;
  changesSinceBackup: number;
  backupReminderSnoozedUntil?: number;
  persist?: { requestedAt: number; granted: boolean };
  completionPromptedWorkIds: string[];
}
export const DEFAULT_SETTINGS: Settings = {
  schemaVersion: 1,
  discreet: { aliasOnly: true, blurOnHide: true, hideStoreLinks: true, blurExtras: false },
  camouflageText: '',
  autoLockSec: 60,
  pinFailures: 0,
  changesSinceBackup: 0,
  completionPromptedWorkIds: [],
};

// ───────────────────────── Creator drafts (DB 'shiori-studio') ─────────────────────────

export interface DraftGoal extends GoalCommon {
  unlockType: 'manual' | 'code';
  codeKind?: CodeKind;
  /** display form (required when unlockType === 'code') */
  code?: string;
  /** required when unlockType === 'code' */
  secret?: GoalSecret;
}
export interface DraftSealed {
  id: string;
  label: string;
  teaser?: string;
  kind: SealedKind;
  mode: 'allOf' | 'anyOf';
  goals: string[];
  payload: SealedPayload;
}
export interface StudioProject {
  format: 'shiori-studio-project';
  version: 1;
  id: string;
  createdAt: number;
  updatedAt: number;
  lastExportedAt?: number;
  /** https URL (or http://localhost) used in QR/はじめに.txt */
  appUrl: string;
  work: ManifestWork;
  authorName?: string;
  /** default 200000 */
  kdfIterations: number;
  /** generated at first build, then kept stable */
  kdfSalt?: B64u;
  checkpoints: Checkpoint[];
  groups: Group[];
  goals: DraftGoal[];
  sealed: DraftSealed[];
  changelog: ChangelogEntry[];
}

// ───────────────────────── Backup (docs/SPEC.md §5.5) ─────────────────────────

export interface BackupDataV1 {
  works: WorkRecord[];
  manifests: ManifestRecord[];
  progress: GoalProgress[];
  redemptions: Redemption[];
  hints: HintReveal[];
  sessions: Session[];
  notes: Note[];
  pending: PendingCode[];
  sealedOpens: SealedOpen[];
  settings: {
    discreet: DiscreetSettings;
    autoLockSec: Settings['autoLockSec'];
    camouflageText: string;
  };
}
export interface EncryptedJson {
  /** iterations 600000 for backups */
  kdf: KdfParams;
  iv: B64u;
  ct: B64u;
}
export type BackupFileV1 =
  | {
      format: 'shiori-backup';
      version: 1;
      exportedAt: number;
      appVersion: string;
      encrypted: false;
      data: BackupDataV1;
    }
  | {
      format: 'shiori-backup';
      version: 1;
      exportedAt: number;
      appVersion: string;
      encrypted: true;
      enc: EncryptedJson;
    };
export type ParseBackupError = 'json' | 'format' | 'version' | 'passphraseRequired' | 'passphrase' | 'schema';
export type ParseBackupResult =
  | { ok: true; data: BackupDataV1; encrypted: boolean; exportedAt: number }
  | { ok: false; error: ParseBackupError };
export interface MergeStats {
  worksAdded: number;
  worksUpdated: number;
  worksRemapped: number;
  progressAdded: number;
  sessionsAdded: number;
  notesAdded: number;
}

// ───────────────────────── Service-level results (CONTRACT for the UI) ─────────────────────────

export interface RedeemCandidate {
  manifestKey: string;
  manifest: ShioriManifestV1;
}
export type RedeemResult =
  | { status: 'invalid'; error: CodeError }
  | { status: 'matched'; manifestKey: string; goalId: string; canonical: string; master: Bytes }
  | { status: 'noMatch'; canonical: string };

export interface UnlockOutcome {
  status: 'unlocked' | 'already' | 'noMatch' | 'invalid' | 'pending';
  workId?: string;
  goalId?: string;
  secret?: GoalSecret;
  /** sealed ids newly opened by this action (to queue the envelope animation) */
  openedSealedIds: string[];
  canonical?: string;
  error?: CodeError;
}

export interface ManifestDiff {
  added: string[];
  removed: string[];
  kept: string[];
  kdfChanged: boolean;
}
export type ImportPreview =
  | { kind: 'invalid'; errors: ValidationIssue[] }
  | {
      kind: 'new';
      manifest: ShioriManifestV1;
      warnings: ValidationIssue[];
      stats: { goals: number; codeGoals: number; sealed: number };
    }
  | {
      kind: 'update';
      manifest: ShioriManifestV1;
      warnings: ValidationIssue[];
      stats: { goals: number; codeGoals: number; sealed: number };
      existing: WorkRecord;
      diff: ManifestDiff;
      alreadyImported: boolean;
    };

export interface ProgressGroupSummary {
  groupId: string;
  label: string;
  total: number;
  done: number;
  pct: number;
}
export interface ProgressSummary {
  total: number;
  done: number;
  pct: number;
  byGroup: ProgressGroupSummary[];
}
export interface MissableAlert {
  goalId: string;
  level: 'soon' | 'ahead';
  beforeCheckpointId: string;
  warn: string;
  spoiler: SpoilerLevel;
}

export interface QuickCounts {
  endings: number;
  cg: number;
  achievements: number;
  tracks: number;
  chapters: number;
}

/** One row of the private code sheet produced by buildManifest (never shipped to players). */
export interface CodeRow {
  goalId: string;
  /** public label */
  label: string;
  secretTitle: string;
  codeKind: CodeKind;
  display: string;
  canonical: string;
  /** buildUnlockUrl(project.appUrl, work.id, canonical) */
  unlockUrl: string;
}
export interface BuildResult {
  manifest: ShioriManifestV1;
  /** JSON.stringify(manifest, null, 2) */
  json: string;
  codes: CodeRow[];
  salt: B64u;
}
export interface SelfTestCheck {
  id: string;
  ok: boolean;
  messageJa: string;
}
export interface SelfTestReport {
  ok: boolean;
  checks: SelfTestCheck[];
}
export interface KitFile {
  path: string;
  content: string | Bytes;
}
