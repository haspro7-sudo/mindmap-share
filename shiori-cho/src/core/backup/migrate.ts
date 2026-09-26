// Backup file migrations (docs/SPEC.md §5.5). Each step maps version n to n + 1 until the current version.

/** The backup file version this app writes and reads. */
export const BACKUP_VERSION = 1;

/** Upper bound on migration steps, so a faulty step can never loop forever. */
const MAX_MIGRATION_STEPS = 16;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Returns the file upgraded by exactly one version, or undefined when there is nothing to do: the file is
 * current, from a newer app, or not recognizable. Steps must not mutate their input.
 *
 * To support an older format, add one case, e.g. `case 0: return v0ToV1(file);`.
 */
function migrateOneStep(file: unknown): Record<string, unknown> | undefined {
  if (!isRecord(file)) return undefined;
  switch (file.version) {
    case BACKUP_VERSION:
      return undefined;
    default:
      // Newer or unknown: returned unchanged, and parseBackup reports 'version' or 'format'.
      return undefined;
  }
}

/** Maps older backup file versions to the V1 file shape. Unknown/newer versions are returned unchanged (caller reports 'version'). */
export function migrateBackup(raw: unknown): unknown {
  let file = raw;
  for (let i = 0; i < MAX_MIGRATION_STEPS; i++) {
    const next = migrateOneStep(file);
    if (next === undefined) return file;
    file = next;
  }
  return file;
}
