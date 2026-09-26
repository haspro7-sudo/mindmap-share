// Backup files (docs/SPEC.md §5.5, F15): export, parse (migrate, decrypt, validate), file name, messages.
import { BACKUP_AAD, BACKUP_FORMAT, BACKUP_ITERATIONS } from '../constants';
import { decryptJson, encryptJson } from '../crypto/backupCrypto';
import { ShioriError } from '../errors';
import type { BackupDataV1, BackupFileV1, ParseBackupError, ParseBackupResult, Redemption } from '../types';
import { BACKUP_VERSION, migrateBackup } from './migrate';
import { backupDataSchema, encryptedBackupFileSchema, plainBackupFileSchema } from './schema';

/** Minimum passphrase length, counted in characters (code points) of the NFC form. */
export const BACKUP_PASSPHRASE_MIN_CHARS = 8;

const MSG_PASSPHRASE_SHORT = `パスフレーズは${BACKUP_PASSPHRASE_MIN_CHARS}文字以上にしてください`;
const MSG_EXPORT_FAILED = 'バックアップを作成できませんでした';

/** Characters (code points) of the NFC form, so 「😀」 counts as one and a kana passphrase counts naturally. */
export function passphraseLength(passphrase: string): number {
  return Array.from(passphrase.normalize('NFC')).length;
}

/** True when the passphrase is long enough for an encrypted backup. */
export function isValidBackupPassphrase(passphrase: string): boolean {
  return passphraseLength(passphrase) >= BACKUP_PASSPHRASE_MIN_CHARS;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function withoutMaster(r: Redemption): Redemption {
  const { master: _master, masterSalt: _masterSalt, ...rest } = r;
  return rest;
}

/**
 * The data exactly as it may leave the device: Redemption.master/masterSalt are removed, and settings are
 * reduced to discreet/autoLockSec/camouflageText (never the PIN or the age flag), whatever the caller passed.
 */
export function sanitizeBackupData(data: BackupDataV1): BackupDataV1 {
  const { discreet, autoLockSec, camouflageText } = data.settings;
  return {
    works: data.works,
    manifests: data.manifests,
    progress: data.progress,
    redemptions: data.redemptions.map(withoutMaster),
    hints: data.hints,
    sessions: data.sessions,
    notes: data.notes,
    pending: data.pending,
    sealedOpens: data.sealedOpens,
    settings: {
      discreet: {
        aliasOnly: discreet.aliasOnly,
        blurOnHide: discreet.blurOnHide,
        hideStoreLinks: discreet.hideStoreLinks,
        blurExtras: discreet.blurExtras,
      },
      autoLockSec,
      camouflageText,
    },
  };
}

/**
 * Serializes a backup file (JSON, 2-space indent). An empty or absent passphrase gives a plain file.
 * Throws ShioriError('validation') when the passphrase is shorter than 8 characters.
 */
export async function exportBackup(
  data: BackupDataV1,
  opts: { passphrase?: string; appVersion: string; now: number; iterations?: number },
): Promise<string> {
  const { passphrase } = opts;
  const encrypt = passphrase !== undefined && passphrase !== '';
  if (encrypt && !isValidBackupPassphrase(passphrase)) throw new ShioriError('validation', MSG_PASSPHRASE_SHORT);
  if (!Number.isFinite(opts.now) || opts.now < 0) throw new ShioriError('internal', MSG_EXPORT_FAILED);

  const clean = sanitizeBackupData(data);
  const header: Pick<BackupFileV1, 'format' | 'version' | 'exportedAt' | 'appVersion'> = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: opts.now,
    appVersion: opts.appVersion,
  };
  const file: BackupFileV1 = encrypt
    ? {
        ...header,
        encrypted: true,
        enc: await encryptJson(clean, passphrase, { aad: BACKUP_AAD, iterations: opts.iterations ?? BACKUP_ITERATIONS }),
      }
    : { ...header, encrypted: false, data: clean };
  return JSON.stringify(file, null, 2);
}

/** JSON.parse that tolerates a leading BOM; undefined on any failure (valid JSON never parses to undefined). */
function parseJson(text: string): unknown {
  if (typeof text !== 'string') return undefined;
  try {
    return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) as unknown;
  } catch {
    return undefined;
  }
}

function fail(error: ParseBackupError): ParseBackupResult {
  return { ok: false, error };
}

/**
 * Parses (and decrypts, migrates, validates) a backup file. The checks run in this order:
 * 'json' → 'format' → migrate → 'version' → envelope 'schema' → 'passphraseRequired' → 'passphrase' → data 'schema'.
 * A passphrase given for a plain file is ignored. The returned data never contains cached masters.
 */
export async function parseBackup(text: string, passphrase?: string): Promise<ParseBackupResult> {
  const raw = parseJson(text);
  if (raw === undefined) return fail('json');
  if (!isRecord(raw) || raw.format !== BACKUP_FORMAT) return fail('format');

  const file = migrateBackup(raw);
  if (!isRecord(file)) return fail('format');
  const { version } = file;
  if (typeof version === 'number' && version > BACKUP_VERSION) return fail('version');
  if (version !== BACKUP_VERSION) return fail('format');

  if (file.encrypted === true) {
    const envelope = encryptedBackupFileSchema.safeParse(file);
    if (!envelope.success) return fail('schema');
    if (passphrase === undefined || passphrase === '') return fail('passphraseRequired');
    let decrypted: unknown;
    try {
      decrypted = await decryptJson(envelope.data.enc, passphrase, BACKUP_AAD);
    } catch {
      return fail('passphrase');
    }
    const data = backupDataSchema.safeParse(decrypted);
    if (!data.success) return fail('schema');
    return { ok: true, data: sanitizeBackupData(data.data), encrypted: true, exportedAt: envelope.data.exportedAt };
  }

  const plain = plainBackupFileSchema.safeParse(file);
  if (!plain.success) return fail('schema');
  return { ok: true, data: sanitizeBackupData(plain.data.data), encrypted: false, exportedAt: plain.data.exportedAt };
}

/** Cheap check before asking for a passphrase: a shiori backup whose `encrypted` is true. False on bad JSON. */
export function isEncryptedBackupText(text: string): boolean {
  const raw = parseJson(text);
  if (!isRecord(raw) || raw.format !== BACKUP_FORMAT) return false;
  const file = migrateBackup(raw);
  return isRecord(file) && file.encrypted === true;
}

/** 'shiori-backup-YYYYMMDD.json' (local date) */
export function backupFileName(now: number): string {
  const d = new Date(now);
  if (Number.isNaN(d.getTime())) return 'shiori-backup.json';
  const y = String(d.getFullYear()).padStart(4, '0');
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `shiori-backup-${y}${m}${day}.json`;
}

export function backupErrorMessageJa(e: ParseBackupError): string {
  switch (e) {
    case 'json':
      return 'ファイルを読み取れませんでした。壊れているか、バックアップファイルではないようです';
    case 'format':
      return 'しおり帳のバックアップファイルではないようです';
    case 'version':
      return '新しいバージョンのバックアップです。アプリを更新してください';
    case 'passphraseRequired':
      return 'このバックアップは暗号化されています。パスフレーズを入力してください';
    case 'passphrase':
      return 'パスフレーズが違います';
    case 'schema':
      return 'バックアップの内容が壊れているため、読み込めませんでした';
    default: {
      const unknownError: never = e;
      void unknownError;
      return 'バックアップを読み込めませんでした';
    }
  }
}
