// Shared, React-free helpers of the サークル工房 editor (docs/SPEC.md F16, §6): the tab props contract,
// labels, id helpers, reference-keeping renames/removals and small formatting helpers.
import { isShioriError } from '../../../core/errors';
import { ID_RE } from '../../../core/manifest/schema';
import type {
  DraftGoal,
  DraftSealed,
  Engine,
  GoalSecret,
  SealedPayload,
  Settings,
  SpoilerLevel,
  StudioProject,
  ValidationIssue,
} from '../../../core/types';
import { displayTitle } from '../../format';

/**
 * Applies a change to the project being edited. Edits (the default) bump `updatedAt`, which also makes the
 * last 点検 stale; `{ edit: false }` is for bookkeeping that is not an edit (kdfSalt after a check,
 * lastExportedAt after an export). `{ immediate: true }` saves right away instead of debouncing.
 */
export type ProjectUpdater = (
  fn: (p: StudioProject) => StudioProject,
  opts?: { edit?: boolean; immediate?: boolean },
) => void;

export interface StudioTabProps {
  project: StudioProject;
  update: ProjectUpdater;
}

export const MSG_RELEASED_CODES = '発売済みの作品では合言葉を変えないでください';
export const MSG_SECRET_BANNER = '工房のデータには合言葉などの秘密が含まれます';
export const UNTITLED = '（無題）';
export const NO_SAFE_TITLE = '（表示名なし）';
export const ID_PATTERN_HELP = '半角の英小文字・数字・「-」「_」で40文字まで（先頭は英小文字か数字）';
export const MSG_ID_INVALID = `IDは${ID_PATTERN_HELP}にしてください`;
export const MSG_ID_TAKEN = 'このIDはすでに使われています';

export const ENGINE_ORDER: readonly Engine[] = ['rpgmaker-mz', 'rpgmaker-mv', 'tyrano', 'wolf', 'renpy', 'unity', 'other'];
export const ENGINE_LABEL: Record<Engine, string> = {
  'rpgmaker-mz': 'RPGツクールMZ',
  'rpgmaker-mv': 'RPGツクールMV',
  tyrano: 'ティラノスクリプト',
  wolf: 'WOLF RPGエディター',
  renpy: "Ren'Py",
  unity: 'Unity',
  other: 'その他',
};

/** Spoiler level of a goal's PUBLIC text, as the creator sees it (players pick their own tolerance). */
export const STUDIO_SPOILER_LABEL: Record<SpoilerLevel, string> = {
  0: '0: ネタバレなし',
  1: '1: 少しだけ（項目名程度）',
  2: '2: 展開に触れる',
  3: '3: 核心に触れる',
};
export const SPOILER_LEVELS: readonly SpoilerLevel[] = [0, 1, 2, 3];

/** Hint tiers in order (docs/SPEC.md §4.1: 示唆, 方向, 答え). */
export const HINT_TIERS = ['示唆', '方向', '答え'] as const;

export function isValidId(id: string): boolean {
  return ID_RE.test(id);
}

/** `${prefix}${n}` with the smallest n ≥ 1 that is not taken. */
export function uniqueId(prefix: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  for (let n = 1; ; n++) {
    const id = `${prefix}${n}`;
    if (!set.has(id)) return id;
  }
}

/** Validates a new id for an item of a collection (null = OK). */
export function idError(next: string, current: string, taken: readonly string[]): string | null {
  if (next === current) return null;
  if (!isValidId(next)) return MSG_ID_INVALID;
  if (taken.includes(next)) return MSG_ID_TAKEN;
  return null;
}

export function moveItem<T>(arr: readonly T[], index: number, delta: number): T[] {
  const to = index + delta;
  if (index < 0 || index >= arr.length || to < 0 || to >= arr.length) return [...arr];
  const out = [...arr];
  const [item] = out.splice(index, 1);
  out.splice(to, 0, item as T);
  return out;
}

export function replaceAt<T>(arr: readonly T[], index: number, item: T): T[] {
  return arr.map((v, i) => (i === index ? item : v));
}

export function removeAt<T>(arr: readonly T[], index: number): T[] {
  return arr.filter((_, i) => i !== index);
}

/**
 * Stable React keys for a list of id'd items: the id, with a counter for duplicates (an imported project may
 * contain duplicate ids until the creator fixes them).
 */
export function itemKeys(items: ReadonlyArray<{ id: string }>): string[] {
  const seen = new Map<string, number>();
  return items.map((it) => {
    const n = seen.get(it.id) ?? 0;
    seen.set(it.id, n + 1);
    return n === 0 ? `id:${it.id}` : `id:${it.id}#${n}`;
  });
}

/** Issues whose path is `prefix` or below it ('goals[2]' matches 'goals[2].hints[0]'). */
export function issuesUnder(issues: readonly ValidationIssue[], prefix: string): ValidationIssue[] {
  return issues.filter((i) => i.path === prefix || i.path.startsWith(`${prefix}.`) || i.path.startsWith(`${prefix}[`));
}

export function countErrors(issues: readonly ValidationIssue[]): number {
  return issues.filter((i) => i.severity === 'error').length;
}

// ───────────────────────── renames and removals that keep references ─────────────────────────

export function renameCheckpoint(p: StudioProject, from: string, to: string): StudioProject {
  return {
    ...p,
    checkpoints: p.checkpoints.map((c) => (c.id === from ? { ...c, id: to } : c)),
    goals: p.goals.map((g) => (g.missable?.before === from ? { ...g, missable: { ...g.missable, before: to } } : g)),
  };
}

export function renameGroup(p: StudioProject, from: string, to: string): StudioProject {
  return {
    ...p,
    groups: p.groups.map((g) => (g.id === from ? { ...g, id: to } : g)),
    goals: p.goals.map((g) => (g.group === from ? { ...g, group: to } : g)),
  };
}

export function renameGoal(p: StudioProject, index: number, to: string): StudioProject {
  const from = p.goals[index]?.id;
  if (from === undefined) return p;
  return {
    ...p,
    goals: p.goals.map((g, i) => (i === index ? { ...g, id: to } : g)),
    sealed: p.sealed.map((s) => (s.goals.includes(from) ? { ...s, goals: s.goals.map((id) => (id === from ? to : id)) } : s)),
  };
}

/** Removes a goal and drops it from every sealed condition. */
export function removeGoal(p: StudioProject, index: number): StudioProject {
  const id = p.goals[index]?.id;
  if (id === undefined) return p;
  const stillUsed = p.goals.some((g, i) => i !== index && g.id === id);
  return {
    ...p,
    goals: removeAt(p.goals, index),
    sealed: stillUsed ? p.sealed : p.sealed.map((s) => (s.goals.includes(id) ? { ...s, goals: s.goals.filter((g) => g !== id) } : s)),
  };
}

export function codeGoalsOf(p: StudioProject): DraftGoal[] {
  return p.goals.filter((g) => g.unlockType === 'code');
}

/** Sealed items whose condition uses the goal id. */
export function sealedUsingGoal(p: StudioProject, goalId: string): DraftSealed[] {
  return p.sealed.filter((s) => s.goals.includes(goalId));
}

// ───────────────────────── drafts ─────────────────────────

/**
 * The goal secret after an edit: undefined while every field is empty (so an untouched code goal stays a
 * valid draft), otherwise the fields with empty optional ones dropped.
 */
export function nextSecret(prev: GoalSecret | undefined, patch: Partial<GoalSecret>): GoalSecret | undefined {
  const merged = { title: '', ...prev, ...patch };
  const blank = (s: string | undefined) => s === undefined || s === '';
  if (blank(merged.title) && blank(merged.description) && blank(merged.unlockMessage)) return undefined;
  const out: GoalSecret = { title: merged.title };
  if (!blank(merged.description)) out.description = merged.description;
  if (!blank(merged.unlockMessage)) out.unlockMessage = merged.unlockMessage;
  return out;
}

/** payload.returnCode after an edit: undefined while both fields are empty. */
export function nextReturnCode(
  prev: SealedPayload['returnCode'],
  patch: Partial<NonNullable<SealedPayload['returnCode']>>,
): SealedPayload['returnCode'] {
  const merged = { code: '', instruction: '', ...prev, ...patch };
  return merged.code === '' && merged.instruction === '' ? undefined : merged;
}

/** payload.storeLink after an edit: undefined while both fields are empty. */
export function nextStoreLink(
  prev: SealedPayload['storeLink'],
  patch: Partial<NonNullable<SealedPayload['storeLink']>>,
): SealedPayload['storeLink'] {
  const merged = { storeCode: '', caption: '', ...prev, ...patch };
  return merged.storeCode === '' && merged.caption === '' ? undefined : merged;
}

/** Optional text field value: undefined when empty. */
export function optionalText(v: string): string | undefined {
  return v === '' ? undefined : v;
}

// ───────────────────────── projects ─────────────────────────

/** Default app URL for new projects (docs/SPEC.md §7.3): VITE_APP_URL, else this page's URL without the hash. */
export function defaultAppUrl(): string {
  const env = (import.meta.env as Record<string, unknown> | undefined)?.VITE_APP_URL;
  if (typeof env === 'string' && env.trim() !== '') return env.trim();
  if (typeof location === 'undefined') return '';
  return `${location.origin}${location.pathname}`;
}

/** A copy of a project under a new local id (timestamps set to `now`). */
export function cloneProject(p: StudioProject, now: number, patch: Partial<StudioProject> = {}): StudioProject {
  const copy = structuredClone(p);
  return { ...copy, id: globalThis.crypto.randomUUID(), createdAt: now, updatedAt: now, ...patch };
}

export function projectStats(p: StudioProject): { goals: number; codeGoals: number; sealed: number } {
  return { goals: p.goals.length, codeGoals: codeGoalsOf(p).length, sealed: p.sealed.length };
}

/**
 * The name shown for a project in lists and headers: the real title, or the safeTitle (表示名) while
 * おしのびモード shows aliases only (docs/SPEC.md F2 AC2).
 */
export function projectDisplayTitle(p: StudioProject, settings: Pick<Settings, 'discreet'>): string {
  const untitled = p.work.title.trim() === '';
  const title = untitled ? UNTITLED : p.work.title;
  // Without a safeTitle the real title is never shown in おしのびモード (a brand-new project is just 「（無題）」).
  const alias = (p.work.safeTitle ?? '').trim() !== '' ? (p.work.safeTitle as string) : untitled ? UNTITLED : NO_SAFE_TITLE;
  return displayTitle({ title, alias }, settings);
}

/** 'YYYY-MM-DD' in local time. */
export function todayYmd(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function errorMessageJa(e: unknown, fallback = 'うまく処理できませんでした。もう一度お試しください'): string {
  return isShioriError(e) ? e.messageJa : fallback;
}

/** 12345 → '12,345' */
export function formatNumber(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Which editor tab an issue path belongs to (for 「該当のタブへ」 links in the 点検 report). */
export function tabForPath(path: string): 'work' | 'structure' | 'goals' | 'extras' | null {
  if (path.startsWith('goals')) return 'goals';
  if (path.startsWith('sealed')) return 'extras';
  if (path.startsWith('checkpoints') || path.startsWith('groups')) return 'structure';
  if (path.startsWith('work') || path.startsWith('appUrl') || path.startsWith('kdf') || path.startsWith('changelog')) {
    return 'work';
  }
  return null;
}
