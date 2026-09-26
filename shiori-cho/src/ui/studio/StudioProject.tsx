// #/studio/<pid>?tab=… サークル工房 editor (docs/SPEC.md F16, §6). Tabs 作品 / 章・グループ / 目標 / おまけ / 点検 /
// 書き出し (tab changes go through the router). The editor owns a draft of the project: every edit updates it
// at once (bumping updatedAt, which makes the last 点検 stale) and is saved to the studio repository after a short
// pause, with a saved indicator. Pending edits are also saved when leaving the screen or hiding the page.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { withBuildSalt } from '../../app/studio';
import type { StudioTab } from '../../core/route';
import type { StudioProject } from '../../core/types';
import { EmptyState } from '../components/EmptyState';
import { Tabs } from '../components/Tabs';
import { useLatest } from '../components/useLatest';
import { useSettings, useStudioQuery, useStudioRepo, useUi } from '../context';
import { hrefFor, navigate } from '../router';
import { CheckTab } from './tabs/CheckTab';
import { ExportTab } from './tabs/ExportTab';
import { ExtrasTab } from './tabs/ExtrasTab';
import { GoalsTab } from './tabs/GoalsTab';
import { StructureTab } from './tabs/StructureTab';
import { WorkTab } from './tabs/WorkTab';
import { runCheck, useCheckEntry } from './tabs/checkStore';
import { MSG_SECRET_BANNER, errorMessageJa, projectDisplayTitle } from './tabs/model';
import type { ProjectUpdater } from './tabs/model';
import './Studio.css';

/** Autosave delay after the last edit. */
export const AUTOSAVE_MS = 600;

type SaveState = 'saved' | 'pending' | 'saving' | 'error';

export function StudioProjectScreen({ projectId, tab }: { projectId: string; tab: StudioTab }): ReactNode {
  const q = useStudioQuery(async (repo) => (await repo.get(projectId)) ?? null, [projectId]);

  if (q.data === undefined) {
    if (q.error !== undefined) {
      return (
        <main className="screen stu">
          <EmptyState
            icon="⚠️"
            title="プロジェクトを読み込めませんでした"
            body={errorMessageJa(q.error, 'もう一度お試しください')}
            action={
              <button type="button" className="btn" onClick={q.reload}>
                もう一度読み込む
              </button>
            }
          />
        </main>
      );
    }
    return (
      <main className="screen stu" aria-busy="true">
        <p className="muted center" role="status">
          読み込み中…
        </p>
      </main>
    );
  }
  if (q.data === null) {
    return (
      <main className="screen stu">
        <EmptyState
          icon="📭"
          title="プロジェクトが見つかりません"
          body="削除されたか、別の端末のプロジェクトかもしれません。"
          action={
            <a className="btn" href={hrefFor({ name: 'studio' })}>
              工房の一覧へ
            </a>
          }
        />
      </main>
    );
  }
  return <ProjectEditor key={q.data.id} initial={q.data} tab={tab} />;
}

function ProjectEditor({ initial, tab }: { initial: StudioProject; tab: StudioTab }): ReactNode {
  const repo = useStudioRepo();
  const ui = useUi();
  const uiRef = useLatest(ui);
  const { settings } = useSettings();
  const [project, setProject] = useState(initial);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const latest = useRef(initial);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const saving = useRef<Promise<void>>(Promise.resolve());

  const save = useCallback((): Promise<void> => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (!dirty.current) return saving.current;
    dirty.current = false;
    const snapshot = latest.current;
    if (mounted.current) setSaveState('saving');
    const run = saving.current.then(async () => {
      try {
        await repo.put(snapshot);
        if (mounted.current) setSaveState(dirty.current ? 'pending' : 'saved');
      } catch (e) {
        dirty.current = true;
        if (mounted.current) {
          setSaveState('error');
          uiRef.current.toast(errorMessageJa(e, '保存できませんでした'), { tone: 'danger' });
        }
      }
    });
    saving.current = run;
    return run;
  }, [repo, uiRef]);

  const update = useCallback<ProjectUpdater>(
    (fn, opts = {}) => {
      const prev = latest.current;
      const changed = fn(prev);
      if (changed === prev) return;
      const next = opts.edit === false ? changed : { ...changed, updatedAt: Math.max(Date.now(), prev.updatedAt + 1) };
      latest.current = next;
      dirty.current = true;
      setProject(next);
      setSaveState('pending');
      if (timer.current !== null) clearTimeout(timer.current);
      if (opts.immediate) {
        timer.current = null;
        void save();
      } else {
        timer.current = setTimeout(() => void save(), AUTOSAVE_MS);
      }
    },
    [save],
  );

  // Save pending edits when the page is hidden or the editor unmounts.
  useEffect(() => {
    mounted.current = true;
    const onHide = () => {
      if (document.visibilityState === 'hidden') void save();
    };
    const onPageHide = () => void save();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
      mounted.current = false;
      void save();
    };
  }, [save]);

  const onRunCheck = useCallback(async () => {
    const snapshot = latest.current;
    try {
      const entry = await runCheck(snapshot);
      const build = entry.report.build;
      // Keep the salt of the first build, so later builds (and every release) keep the same tags.
      if (build && latest.current.kdfSalt === undefined) update((p) => withBuildSalt(p, build), { edit: false, immediate: true });
      if (entry.updatedAt === latest.current.updatedAt) {
        ui.toast(entry.report.exportable ? '点検が終わりました。書き出せます' : '点検が終わりました。エラーがあります', {
          tone: entry.report.exportable ? 'ok' : 'danger',
        });
      }
    } catch (e) {
      ui.toast(errorMessageJa(e, '点検できませんでした'), { tone: 'danger' });
    }
  }, [ui, update]);

  const entry = useCheckEntry(project.id);
  const fresh = entry !== undefined && entry.updatedAt === project.updatedAt ? entry : undefined;
  const checkBadge = fresh ? (fresh.report.exportable ? '✓' : String(fresh.report.errors.length || '!')) : undefined;

  const title = projectDisplayTitle(project, settings);
  let panel: ReactNode;
  switch (tab) {
    case 'work':
      panel = <WorkTab project={project} update={update} />;
      break;
    case 'structure':
      panel = <StructureTab project={project} update={update} />;
      break;
    case 'goals':
      panel = <GoalsTab project={project} update={update} />;
      break;
    case 'extras':
      panel = <ExtrasTab project={project} update={update} />;
      break;
    case 'check':
      panel = <CheckTab project={project} update={update} onRunCheck={onRunCheck} flush={save} />;
      break;
    case 'export':
      panel = <ExportTab project={project} update={update} flush={save} />;
      break;
  }

  return (
    <main className="screen stu stu-proj" aria-labelledby="stu-proj-title">
      <div className="stu-proj-head">
        <a className="stu-crumb small" href={hrefFor({ name: 'studio' })}>
          サークル工房
        </a>
        <div className="stu-proj-titlerow">
          <h1 id="stu-proj-title" className="stu-title">
            {title}
          </h1>
          <SaveIndicator state={saveState} onRetry={() => void save()} />
        </div>
      </div>
      <p className="banner banner-warn stu-secret" role="note">
        <span aria-hidden="true">🔐</span>
        <span>{MSG_SECRET_BANNER}</span>
      </p>
      <Tabs<StudioTab>
        ariaLabel="工房の編集項目"
        tabs={[
          { id: 'work', label: '作品' },
          { id: 'structure', label: '章・グループ' },
          { id: 'goals', label: '目標', badge: project.goals.length || undefined },
          { id: 'extras', label: 'おまけ', badge: project.sealed.length || undefined },
          { id: 'check', label: '点検', badge: checkBadge },
          { id: 'export', label: '書き出し' },
        ]}
        value={tab}
        onChange={(t) => {
          void save();
          navigate({ name: 'studioProject', id: project.id, tab: t }, { replace: true });
        }}
      />
      <div className="stu-panel" role="tabpanel" id={`stu-panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {panel}
      </div>
    </main>
  );
}

function SaveIndicator({ state, onRetry }: { state: SaveState; onRetry(): void }): ReactNode {
  return (
    <span className={`stu-save is-${state}`} role="status" aria-live="polite">
      {state === 'saved' ? (
        <>
          <span aria-hidden="true">✓ </span>保存済み
        </>
      ) : state === 'error' ? (
        <>
          <span>保存できませんでした</span>
          <button type="button" className="btn btn-sm btn-ghost stu-save-retry" onClick={onRetry}>
            もう一度
          </button>
        </>
      ) : (
        '保存中…'
      )}
    </span>
  );
}
