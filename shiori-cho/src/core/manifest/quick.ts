/**
 * かんたんしおり (docs/SPEC.md F6): a player-authored manifest generated from counts.
 */
import { CROCKFORD_ALPHABET } from '../codes/crockford';
import { randomBytes } from '../encoding';
import type { Rng } from '../encoding';
import { ShioriError } from '../errors';
import type { Checkpoint, Goal, Group, QuickCounts, ShioriManifestV1, WorkKind } from '../types';
import { MANIFEST_LIMITS, VERSION_RE } from './schema';
import { validateManifest } from './validate';

export const QUICK_LIMITS: Readonly<QuickCounts> = { endings: 50, cg: 200, achievements: 200, tracks: 100, chapters: 30 };

/** Form labels of each count (used in validation messages). */
export const QUICK_LABELS: Readonly<Record<keyof QuickCounts, string>> = {
  endings: 'エンディング',
  cg: '回想・CG',
  achievements: '実績',
  tracks: 'トラック',
  chapters: '章',
};

/** Goal groups in display order: count key, group, goal id prefix and label builder. */
const QUICK_GROUPS: ReadonlyArray<{
  key: Exclude<keyof QuickCounts, 'chapters'>;
  group: Group;
  idPrefix: string;
  label: (n: number) => string;
}> = [
  { key: 'endings', group: { id: 'endings', label: 'エンディング' }, idPrefix: 'end', label: (n) => `END ${n}` },
  { key: 'cg', group: { id: 'cg', label: '回想・CG' }, idPrefix: 'cg', label: (n) => `CG ${n}` },
  { key: 'achievements', group: { id: 'achievements', label: '実績' }, idPrefix: 'ach', label: (n) => `実績 ${n}` },
  { key: 'tracks', group: { id: 'tracks', label: 'トラック' }, idPrefix: 'track', label: (n) => `Track ${n}` },
];

const QUICK_TITLE_MAX = 100;
const COUNT_KEYS: ReadonlyArray<keyof QuickCounts> = ['endings', 'cg', 'achievements', 'tracks', 'chapters'];

/** "p-" + 10 lowercase Crockford base32 chars */
export function newPlayerWorkId(rng: Rng = randomBytes): string {
  const bytes = rng(10);
  let out = 'p-';
  for (let i = 0; i < 10; i++) {
    // 256 is a multiple of 32, so masking keeps the distribution uniform.
    out += CROCKFORD_ALPHABET[(bytes[i] ?? 0) & 31]!.toLowerCase();
  }
  return out;
}

function invalid(messageJa: string): never {
  throw new ShioriError('validation', messageJa);
}

/** Throws ShioriError('validation') with a Japanese message if the counts cannot make a quick shiori. */
export function checkQuickCounts(counts: QuickCounts): void {
  for (const key of COUNT_KEYS) {
    const v = counts[key];
    const max = QUICK_LIMITS[key];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > max) {
      invalid(`${QUICK_LABELS[key]}は0〜${max}の整数で入力してください`);
    }
  }
  const goalCount = counts.endings + counts.cg + counts.achievements + counts.tracks;
  if (goalCount === 0) invalid('エンディング・CG・実績・トラックのどれかを1以上にしてください');
  if (goalCount > MANIFEST_LIMITS.goals) {
    invalid(`エンディング・CG・実績・トラックの合計は${MANIFEST_LIMITS.goals}個までにしてください`);
  }
}

/** Player-authored manifest (author.kind 'player', no kdf). Groups with count 0 are omitted. Throws ShioriError('validation') if all counts are 0 or out of range. */
export function buildQuickManifest(args: {
  title: string;
  kind: WorkKind;
  workId: string;
  counts: QuickCounts;
  version?: string;
}): ShioriManifestV1 {
  const title = args.title.trim();
  if (title === '') invalid('タイトルを入力してください');
  if (title.length > QUICK_TITLE_MAX) invalid(`タイトルは${QUICK_TITLE_MAX}文字以内にしてください`);
  const version = args.version ?? '1.0.0';
  if (!VERSION_RE.test(version)) invalid('バージョンは半角英数字と「.」「+」「-」の20文字以内にしてください');
  checkQuickCounts(args.counts);

  const groups: Group[] = [];
  const goals: Goal[] = [];
  for (const spec of QUICK_GROUPS) {
    const count = args.counts[spec.key];
    if (count === 0) continue;
    groups.push({ ...spec.group });
    for (let n = 1; n <= count; n++) {
      goals.push({
        id: `${spec.idPrefix}-${n}`,
        group: spec.group.id,
        label: spec.label(n),
        spoiler: 0,
        hints: [],
        unlock: { type: 'manual' },
      });
    }
  }
  const checkpoints: Checkpoint[] = [];
  for (let n = 1; n <= args.counts.chapters; n++) checkpoints.push({ id: `ch-${n}`, label: `第${n}章` });

  const manifest: ShioriManifestV1 = {
    schema: 'shiori/1',
    work: { id: args.workId, title, kind: args.kind, version },
    author: { kind: 'player' },
    checkpoints,
    groups,
    goals,
    sealed: [],
    changelog: [],
  };

  // Safety net: the result must always be importable.
  const result = validateManifest(manifest);
  if (!result.ok) {
    const first = result.errors[0];
    invalid(
      first
        ? `かんたんしおりを作れませんでした（${first.path ? `${first.path}：` : ''}${first.messageJa}）`
        : 'かんたんしおりを作れませんでした',
    );
  }
  return result.manifest;
}
