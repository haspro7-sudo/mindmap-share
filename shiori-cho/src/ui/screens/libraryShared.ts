// Helpers shared by the library screens (本棚 / 作品を追加 / しおりの読み込み). No components here.
import { useCallback } from 'react';
import { MSG_TITLE_REQUIRED, MSG_TITLE_TOO_LONG, WORK_TITLE_MAX, importBundledDemos } from '../../app/library';
import { nextAlias } from '../../core/alias';
import { isShioriError } from '../../core/errors';
import { STORE_CODE_INVALID_JA, parseStoreCode } from '../../core/storeCode';
import type { WorkKind } from '../../core/types';
import { DEMO_AMAOTO, DEMO_HOSHIYOMI } from '../../demo/demoCodes';
import { useRepo, useRepoQuery, useUi } from '../context';
import { navigate } from '../router';

export const MSG_UNEXPECTED = 'うまく処理できませんでした。もう一度お試しください';
export const MSG_FILE_TOO_LARGE = 'ファイルが大きすぎます（512KBまで）';

/** The Japanese message of a ShioriError, or a neutral fallback (the technical error goes to the console). */
export function errorMessageJa(e: unknown): string {
  if (isShioriError(e)) return e.messageJa;
  console.error('[shiori]', e);
  return MSG_UNEXPECTED;
}

const DEMO_WORK_IDS: readonly string[] = [DEMO_HOSHIYOMI.workId, DEMO_AMAOTO.workId];

/**
 * 「サンプルを試す」 (F17 AC1): imports both bundled demos and tells the user what happened.
 * Resolves to true on success. The toast offers the demo codes in ヘルプ (F17 AC2).
 */
export function useTrySamples(): () => Promise<boolean> {
  const repo = useRepo();
  const ui = useUi();
  return useCallback(async () => {
    try {
      const before = await repo.listWorks();
      const had = before.filter((w) => w.manifestWorkId !== undefined && DEMO_WORK_IDS.includes(w.manifestWorkId)).length;
      await importBundledDemos(repo);
      const added = DEMO_WORK_IDS.length - had;
      ui.toast(added > 0 ? `サンプルを${added}作品追加しました` : 'サンプルはすでに本棚にあります', {
        tone: 'ok',
        action: { label: '合言葉を見る', onClick: () => navigate({ name: 'help', section: 'demo-codes' }) },
      });
      return true;
    } catch (e) {
      ui.toast(errorMessageJa(e), { tone: 'danger' });
      return false;
    }
  }, [repo, ui]);
}

/** The alias a new work would get by default (「作品C」…), for input placeholders. */
export function useNextAlias(): string | undefined {
  const q = useRepoQuery(async (repo) => nextAlias((await repo.listWorks()).map((w) => w.alias)), []);
  return q.data;
}

// ───────────────────────── add-work forms ─────────────────────────

export interface WorkBasics {
  title: string;
  alias: string;
  kind: WorkKind;
  storeCode: string;
}

export type WorkBasicsErrors = Partial<Record<'title' | 'storeCode', string>>;

/** Field-level validation of the basics (the service validates again). */
export function validateWorkBasics(v: WorkBasics): WorkBasicsErrors {
  const errors: WorkBasicsErrors = {};
  const title = v.title.trim();
  if (title === '') errors.title = MSG_TITLE_REQUIRED;
  else if (title.length > WORK_TITLE_MAX) errors.title = MSG_TITLE_TOO_LONG;
  if (v.storeCode.trim() !== '' && !parseStoreCode(v.storeCode)) errors.storeCode = STORE_CODE_INVALID_JA;
  return errors;
}

/** Focuses the first element among `ids` that exists (after a failed submit). */
export function focusFirst(ids: readonly string[]): void {
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) {
      el.focus();
      return;
    }
  }
}
