/** Display helpers shared by screens (pure functions of records + settings). */
import type { CoverColor, Settings, SpoilerLevel, WorkKind, WorkRecord, WorkStatus } from '../core/types';

export const STATUS_LABEL: Record<WorkStatus, string> = {
  backlog: '積み',
  playing: 'プレイ中',
  cleared: 'クリア',
  completed: 'コンプ',
  paused: '保留',
};
export const STATUS_ORDER: readonly WorkStatus[] = ['backlog', 'playing', 'cleared', 'completed', 'paused'];

export const KIND_LABEL: Record<WorkKind, string> = {
  game: 'ゲーム',
  voice: '音声',
  cg: 'CG集',
  comic: '漫画',
  other: 'その他',
};
export const KIND_ORDER: readonly WorkKind[] = ['game', 'voice', 'cg', 'comic', 'other'];

export const COVER_COLORS: readonly CoverColor[] = ['paper', 'sky', 'leaf', 'sun', 'rose', 'plum', 'slate'];
export const COVER_EMOJIS: readonly string[] = ['📘', '📗', '📕', '📙', '🎧', '🖼️', '🌙', '⭐', '🌸', '🍵', '🐈', '🔖'];

export const SPOILER_LABEL: Record<SpoilerLevel, string> = {
  0: '0: 項目名も伏せる',
  1: '1: 項目名だけ見せる（おすすめ）',
  2: '2: 条件の方向性まで見せる',
  3: '3: すべて表示',
};

/** The title to show in lists/headers: alias when おしのびモード is on. */
export function displayTitle(work: Pick<WorkRecord, 'alias' | 'title'>, settings: Pick<Settings, 'discreet'>): string {
  return settings.discreet.aliasOnly ? work.alias : work.title;
}

export function coverColorVar(c: CoverColor): string {
  return `var(--cover-${c})`;
}

/** 「N日前」 label for a timestamp relative to now (local calendar days). */
export function formatDateJa(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

export function formatDateTimeJa(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${formatDateJa(ts)} ${hh}:${mm}`;
}
