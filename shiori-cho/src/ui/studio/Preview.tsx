// #/studio/<pid>/preview 「プレイヤー画面で試す」 (docs/SPEC.md F16 AC5): the real player WorkScreen, mounted on
// an in-memory repository seeded with the project's build (the last 点検 of this exact project version when there
// is one, else a fresh build). Nothing here is saved: progress, codes and settings changes stay in memory and are
// gone when the preview closes. The preview nests its own UiProvider (envelopes read the memory repository) and a
// SettingsContext whose updates are kept in memory (the app's settings are read, never written).
import { useEffect, useId, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { commitImport, previewImport } from '../../app/library';
import { vibrate } from '../../app/platform';
import { withBuildSalt } from '../../app/studio';
import type { CheckReport } from '../../app/studio';
import { submitCode } from '../../app/unlock';
import { codeErrorMessageJa } from '../../core/codes';
import { ShioriError } from '../../core/errors';
import type { WorkTab } from '../../core/route';
import type { BuildResult, CodeRow, Settings, StudioProject } from '../../core/types';
import { createMemoryRepo } from '../../storage/memoryRepo';
import type { ShioriRepo } from '../../storage/repo';
import { CodeInput } from '../components/CodeInput';
import { EmptyState } from '../components/EmptyState';
import { useLatest } from '../components/useLatest';
import { RepoContext, SettingsContext, useRepo, useSettings, useStudioQuery, useStudioRepo, useUi } from '../context';
import type { SettingsApi } from '../context';
import { hrefFor } from '../router';
import { WorkScreen } from '../screens/work/WorkScreen';
import type { WorkSheet } from '../screens/work/WorkScreen';
import { UiProvider } from '../shell/UiProvider';
import { freshCheck, otherProjects, runCheck } from './tabs/checkStore';
import { errorMessageJa } from './tabs/model';
import './Studio.css';

export const PREVIEW_BANNER = 'プレビュー（保存されません）';

export function StudioPreviewScreen({ projectId }: { projectId: string }): ReactNode {
  const q = useStudioQuery(async (repo) => (await repo.get(projectId)) ?? null, [projectId]);

  if (q.data === undefined) {
    return (
      <main className="screen stu" aria-busy={q.error === undefined}>
        {q.error !== undefined ? (
          <EmptyState icon="⚠️" title="プロジェクトを読み込めませんでした" body={errorMessageJa(q.error, 'もう一度お試しください')} />
        ) : (
          <p className="muted center" role="status">
            読み込み中…
          </p>
        )}
      </main>
    );
  }
  if (q.data === null) {
    return (
      <main className="screen stu">
        <EmptyState
          icon="📭"
          title="プロジェクトが見つかりません"
          action={
            <a className="btn" href={hrefFor({ name: 'studio' })}>
              工房の一覧へ
            </a>
          }
        />
      </main>
    );
  }
  return <PreviewBuilder key={`${q.data.id}:${q.data.updatedAt}`} project={q.data} />;
}

type BuildState =
  | { status: 'building' }
  | { status: 'failed'; message: string; report?: CheckReport }
  | { status: 'ready'; build: BuildResult; report: CheckReport };

/** Reuses the last 点検 of this project version, or builds now; keeps the build's salt in the project. */
function PreviewBuilder({ project }: { project: StudioProject }): ReactNode {
  const studioRepo = useStudioRepo();
  const projectRef = useLatest(project);
  const settingsRef = useLatest(useSettings().settings);
  const [state, setState] = useState<BuildState>({ status: 'building' });
  const [round, setRound] = useState(0);

  useEffect(() => {
    let alive = true;
    const p = projectRef.current;
    const cached = freshCheck(p);
    (cached ? Promise.resolve(cached) : otherProjects(studioRepo, p.id, settingsRef.current).then((others) => runCheck(p, { others })))
      .then(async (entry) => {
        const build = entry.report.build;
        if (!build) {
          if (alive) {
            setState({
              status: 'failed',
              message: 'しおりファイルを作れませんでした。「点検」タブでエラーを直してから、もう一度お試しください。',
              report: entry.report,
            });
          }
          return;
        }
        // Keep the salt (like 点検 does), so later builds keep the same tags. Not an edit: updatedAt stays.
        if (p.kdfSalt === undefined) {
          const current = await studioRepo.get(p.id);
          if (current && current.updatedAt === p.updatedAt && current.kdfSalt === undefined) {
            await studioRepo.put(withBuildSalt(current, build));
          }
        }
        if (alive) setState({ status: 'ready', build, report: entry.report });
      })
      .catch((e: unknown) => {
        if (alive) setState({ status: 'failed', message: errorMessageJa(e, 'プレビューを準備できませんでした') });
      });
    return () => {
      alive = false;
    };
  }, [project.id, project.updatedAt, projectRef, settingsRef, studioRepo]);

  const back = hrefFor({ name: 'studioProject', id: project.id, tab: 'check' });

  if (state.status === 'building') {
    return (
      <main className="screen stu stu-prev-wait" aria-busy="true">
        <p className="banner stu-prev-banner" role="status">
          <span className="stu-spinner" aria-hidden="true" />
          <span>プレビューを準備しています…（合言葉の鍵を計算しています）</span>
        </p>
      </main>
    );
  }
  if (state.status === 'failed') {
    return (
      <main className="screen stu">
        <EmptyState
          icon="🧪"
          title="プレビューを開けませんでした"
          body={state.message}
          action={
            <a className="btn btn-primary" href={back}>
              「点検」タブへ
            </a>
          }
        />
      </main>
    );
  }
  return (
    <PreviewSession
      key={round}
      project={project}
      build={state.build}
      report={state.report}
      onRestart={() => setRound((r) => r + 1)}
    />
  );
}

interface Session {
  repo: ShioriRepo;
  workId: string;
}

interface PreviewSessionProps {
  project: StudioProject;
  build: BuildResult;
  report: CheckReport;
  /** 「最初からやり直す」: remount with a fresh memory repository */
  onRestart(): void;
}

function PreviewSession({ project, build, report, onRestart }: PreviewSessionProps): ReactNode {
  const appUi = useUi();
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const repo = createMemoryRepo();
    (async () => {
      const preview = await previewImport(repo, build.json);
      if (preview.kind === 'invalid') {
        throw new ShioriError('validation', preview.errors[0]?.messageJa ?? 'しおりファイルを読み込めませんでした');
      }
      const { workId } = await commitImport(repo, preview, { source: 'file' });
      if (alive) setSession({ repo, workId });
    })().catch((e: unknown) => {
      if (alive) setError(errorMessageJa(e, 'プレビューを準備できませんでした'));
    });
    return () => {
      alive = false;
    };
  }, [build]);

  const back = hrefFor({ name: 'studioProject', id: project.id, tab: 'check' });

  const bar = (
    <div className="stu-prev-bar">
      <div className="banner banner-warn stu-prev-banner" role="note">
        <span aria-hidden="true">🧪</span>
        <span>
          <strong>{PREVIEW_BANNER}</strong>
          <span className="stu-secret-sub">プレイヤーが見る画面です。ここで入れた合言葉や記録は、どこにも保存されません。</span>
        </span>
      </div>
      {!report.exportable ? (
        <p className="banner banner-danger stu-prev-banner" role="note">
          <span aria-hidden="true">⚠️</span>
          <span>点検でエラーが見つかっています。書き出す前に直してください。</span>
        </p>
      ) : null}
      <div className="row-wrap">
        <a className="btn btn-sm" href={back}>
          <span aria-hidden="true">←</span> 工房に戻る
        </a>
        <button type="button" className="btn btn-sm" onClick={onRestart}>
          最初からやり直す
        </button>
      </div>
    </div>
  );

  if (error) {
    return (
      <div className="stu-prev">
        {bar}
        <main className="screen stu">
          <EmptyState icon="⚠️" title="プレビューを開けませんでした" body={error} />
        </main>
      </div>
    );
  }
  if (!session) {
    return (
      <div className="stu-prev">
        {bar}
        <main className="screen stu" aria-busy="true">
          <p className="muted center" role="status">
            読み込み中…
          </p>
        </main>
      </div>
    );
  }

  return (
    <RepoContext.Provider value={session.repo}>
      <PreviewSettings>
        <UiProvider onHide={appUi.hide} onLock={appUi.lockNow}>
          <div className="stu-prev">
            {bar}
            <div className="stu-prev-bar">
              <PreviewCodeBox workId={session.workId} codes={build.codes} />
            </div>
            <PreviewWork workId={session.workId} />
          </div>
        </UiProvider>
      </PreviewSettings>
    </RepoContext.Provider>
  );
}

/** The app's settings, with updates kept in memory (the preview never writes the real settings). */
function PreviewSettings({ children }: { children: ReactNode }): ReactNode {
  const app = useSettings();
  const [patch, setPatch] = useState<Partial<Settings>>({});
  const value = useMemo<SettingsApi>(
    () => ({
      settings: { ...app.settings, ...patch, discreet: { ...app.settings.discreet, ...patch.discreet } },
      update: async (p) => {
        setPatch((prev) => ({ ...prev, ...p, discreet: { ...app.settings.discreet, ...prev.discreet, ...p.discreet } }));
      },
    }),
    [app.settings, patch],
  );
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

function PreviewWork({ workId }: { workId: string }): ReactNode {
  const [view, setView] = useState<{ tab: WorkTab; sheet?: WorkSheet }>({ tab: 'progress' });
  return <WorkScreen workId={workId} tab={view.tab} sheet={view.sheet} onChange={setView} preview />;
}

function PreviewCodeBox({ workId, codes }: { workId: string; codes: readonly CodeRow[] }): ReactNode {
  const repo = useRepo();
  const ui = useUi();
  const inputId = useId();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (input: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const out = await submitCode(repo, input, { workId });
      if (out.status === 'unlocked') {
        vibrate(30);
        ui.toast(out.secret ? `解放しました：${out.secret.title}` : '解放しました', { tone: 'ok' });
        const w = out.workId;
        if (w && out.openedSealedIds.length > 0) ui.queueEnvelopes(out.openedSealedIds.map((sealedId) => ({ workId: w, sealedId })));
        setValue('');
      } else if (out.status === 'already') {
        ui.toast('この合言葉は入力済みです');
      } else if (out.status === 'invalid' && out.error) {
        ui.toast(codeErrorMessageJa(out.error), { tone: 'danger' });
      } else {
        ui.toast('この作品の合言葉ではないようです', { tone: 'danger' });
      }
    } catch (e) {
      ui.toast(errorMessageJa(e), { tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  if (codes.length === 0) return null;
  return (
    <section className="card-flat stack-sm stu-prev-code" aria-labelledby={`${inputId}-title`}>
      <h2 id={`${inputId}-title`} className="stu-h3">
        <label htmlFor={inputId}>合言葉を試す</label>
      </h2>
      <CodeInput id={inputId} value={value} onChange={setValue} onSubmit={() => void submit(value)} busy={busy} />
      <div className="row-wrap">
        <button type="button" className="btn btn-primary btn-sm" onClick={() => void submit(value)} disabled={busy}>
          {busy ? <span className="stu-spinner" aria-hidden="true" /> : null}
          確かめる
        </button>
      </div>
      <details className="stu-prev-codes">
        <summary className="stu-adv-summary">この作品の合言葉（工房の控え・{codes.length}件）</summary>
        <ul className="stu-prev-code-list">
          {codes.map((c) => (
            <li key={c.goalId}>
              <span className="stu-prev-code-text">
                <span className="small">{c.label}</span>
                <span className="mono">{c.display}</span>
              </span>
              <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void submit(c.display)} aria-label={`「${c.label}」の合言葉を入れる`}>
                入れる
              </button>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
