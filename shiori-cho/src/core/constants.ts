/** Domain strings and limits shared across modules (docs/SPEC.md). */

export const APP_NAME_JA = 'しおり帳';
export const APP_NAME_EN = 'Shiori Companion';
export const APP_VERSION = '0.1.0';

export const MANIFEST_SCHEMA = 'shiori/1';
export const MANIFEST_FILE_NAME = 'shiori.json';
export const STUDIO_PROJECT_FORMAT = 'shiori-studio-project';
export const BACKUP_FORMAT = 'shiori-backup';
export const BACKUP_AAD = 'shiori-backup/1';

export const MAX_MANIFEST_BYTES = 512 * 1024;
export const MAX_ISSUES_SHOWN = 20;

export const KDF_ITERATIONS_DEFAULT = 200_000;
export const KDF_ITERATIONS_MIN = 100_000;
export const KDF_ITERATIONS_MAX = 2_000_000;
export const KDF_ITERATIONS_WARN_BELOW = 150_000;
export const PIN_ITERATIONS = 200_000;
export const BACKUP_ITERATIONS = 600_000;

export const PIN_MAX_FAILURES = 5;
export const PIN_COOLDOWN_MS = 30_000;

export const SESSION_MAX_MINUTES = 720;
export const UNDO_TOAST_MS = 5_000;
export const HOLD_TO_REVEAL_MS = 600;
export const BACKUP_REMINDER_CHANGES = 20;
export const BACKUP_REMINDER_DAYS = 30;
export const BACKUP_REMINDER_SNOOZE_DAYS = 7;

export const NOTE_MAX_CHARS = 5_000;

/** Domain-separation prefixes for key derivation (docs/SPEC.md §4.3). */
export const DS = {
  tag: 'shiori/1|tag|',
  goal: 'shiori/1|goal|',
  seal: 'shiori/1|seal|',
  wrap: 'shiori/1|wrap|',
} as const;

export const DISCLAIMER_JA = 'しおり帳はDLsite及び各サークルとは関係のない非公式ツールです。';
export const NOT_DRM_JA = '合言葉による封印はネタバレ防止のしくみで、コピー防止（DRM）ではありません。';

/** IndexedDB names */
export const DB_PLAYER = 'shiori';
export const DB_STUDIO = 'shiori-studio';
