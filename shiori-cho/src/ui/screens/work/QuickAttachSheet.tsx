// 「かんたんしおりにする」 for a 記録だけ work (docs/SPEC.md F6 AC1–AC2): builds a player-authored manifest from
// counts and attaches it to THIS work (sessions and notes stay). library.ts only offers createQuickWork (a new
// work), so the attach step lives here and runs under the shared repository lock.
import { useId, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { withRepoLock } from '../../../app/repoLock';
import { ShioriError } from '../../../core/errors';
import { QUICK_LABELS, QUICK_LIMITS, buildQuickManifest, newPlayerWorkId } from '../../../core/manifest/quick';
import { manifestKey } from '../../../core/manifest/validate';
import type { QuickCounts, WorkRecord } from '../../../core/types';
import type { ShioriRepo } from '../../../storage/repo';
import { Sheet } from '../../components/Sheet';
import { useRepo, useUi } from '../../context';
import { useBackToClose } from './historyLayer';
import { errorMessageJa } from './workModel';

const FIELDS: ReadonlyArray<keyof QuickCounts> = ['endings', 'cg', 'achievements', 'tracks', 'chapters'];

async function attachQuickManifest(repo: ShioriRepo, workId: string, counts: QuickCounts, now: number): Promise<void> {
  await withRepoLock(repo, async () => {
    const work = await repo.getWork(workId);
    if (!work) throw new ShioriError('notFound', '作品が見つかりません');
    if (work.manifestKey) throw new ShioriError('conflict', 'この作品にはもうしおりがあります');
    let manifestWorkId = newPlayerWorkId();
    while (await repo.findWorkByManifestWorkId(manifestWorkId)) manifestWorkId = newPlayerWorkId();
    const manifest = buildQuickManifest({ title: work.title, kind: work.kind, workId: manifestWorkId, counts });
    const key = await manifestKey(manifest);
    await repo.putManifest({ key, workId: work.id, manifest, source: 'quick', importedAt: now });
    const next: WorkRecord = { ...work, manifestKey: key, manifestWorkId, newGoalIds: [], updatedAt: now };
    await repo.putWork(next);
  });
}

export function QuickAttachSheet({ work, onClose }: { work: WorkRecord; onClose(): void }): ReactNode {
  const repo = useRepo();
  const ui = useUi();
  const formId = useId();
  const baseId = useId();
  const [values, setValues] = useState<Record<keyof QuickCounts, string>>(() => ({
    endings: work.kind === 'game' ? '1' : '0',
    cg: '0',
    achievements: '0',
    tracks: work.kind === 'voice' ? '1' : '0',
    chapters: '0',
  }));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useBackToClose(true, onClose);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const counts = {} as QuickCounts;
    for (const k of FIELDS) {
      const raw = values[k].normalize('NFKC').trim();
      counts[k] = raw === '' ? 0 : Number(raw);
    }
    setBusy(true);
    try {
      await attachQuickManifest(repo, work.id, counts, Date.now());
      ui.toast('チェックリストを作りました', { tone: 'ok' });
      onClose();
    } catch (err) {
      setError(errorMessageJa(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open
      title="かんたんしおりにする"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            キャンセル
          </button>
          <button type="submit" form={formId} className="btn btn-primary" disabled={busy}>
            作る
          </button>
        </>
      }
    >
      <form id={formId} className="stack" onSubmit={(e) => void submit(e)} noValidate>
        <p className="small">
          数を入れるだけで「END 1」「CG 1」のようなチェックリストができます。あとから項目の名前を変えたり、追加・削除したりできます。
        </p>
        <div className="wk-quick-grid">
          {FIELDS.map((k) => (
            <div key={k} className="field">
              <label htmlFor={`${baseId}-${k}`}>{QUICK_LABELS[k]}</label>
              <input
                id={`${baseId}-${k}`}
                className="input"
                type="number"
                inputMode="numeric"
                min={0}
                max={QUICK_LIMITS[k]}
                step={1}
                value={values[k]}
                onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))}
              />
              <span className="field-hint">0〜{QUICK_LIMITS[k]}</span>
            </div>
          ))}
        </div>
        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Sheet>
  );
}
