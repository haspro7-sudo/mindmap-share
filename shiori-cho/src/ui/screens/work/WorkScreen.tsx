// 作品ページ #/w/<id> (docs/SPEC.md §6, F7–F9, F12–F14, F6 AC3). Tabs and sheets are controlled by the host through
// `tab` / `sheet` / `onChange` (the app maps them to the hash; the studio preview keeps them in local state), so
// this screen never navigates for tab or sheet changes.
import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { vibrate } from '../../../app/platform';
import { startSession } from '../../../app/sessions';
import { isCodeGoal, submitCode } from '../../../app/unlock';
import { codeErrorMessageJa, parseCode } from '../../../core/codes';
import { isShioriError } from '../../../core/errors';
import { computeProgress } from '../../../core/progress';
import type { WorkTab } from '../../../core/route';
import { EmojiCover } from '../../components/EmojiCover';
import { EmptyState } from '../../components/EmptyState';
import { SealedReader } from '../../components/SealedReader';
import { Sheet } from '../../components/Sheet';
import { Tabs } from '../../components/Tabs';
import { useRepo, useSettings, useUi } from '../../context';
import { KIND_LABEL, STATUS_LABEL, displayTitle } from '../../format';
import { hrefFor, navigate } from '../../router';
import { ExtrasTab } from './ExtrasTab';
import { GoalSheet } from './GoalSheet';
import { LogTab } from './LogTab';
import { NotesTab } from './NotesTab';
import { ProgressTab } from './ProgressTab';
import { QuickAttachSheet } from './QuickAttachSheet';
import { SessionBar } from './SessionBar';
import { errorMessageJa, goalViews, useGoalSecrets, useWorkData } from './workModel';
import './work.css';

export type WorkSheet = { type: 'goal' | 'sealed'; index: number } | undefined;
export interface WorkScreenProps {
  workId: string;
  tab: WorkTab;
  sheet?: WorkSheet;
  onChange(next: { tab: WorkTab; sheet?: WorkSheet }): void;
  /** true inside the studio preview (hide edit/delete/store links/session bar persistence notes) */
  preview?: boolean;
}

export function WorkScreen(props: WorkScreenProps): ReactNode {
  const { workId, tab, sheet, onChange, preview = false } = props;
  const repo = useRepo();
  const ui = useUi();
  const { settings } = useSettings();
  const q = useWorkData(workId);
  const secrets = useGoalSecrets(workId);
  const [starting, setStarting] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const titleId = useId();

  const data = q.data;
  if (data === undefined) {
    if (q.error !== undefined) {
      return (
        <main className="screen wk">
          <EmptyState
            icon="⚠️"
            title="作品を読み込めませんでした"
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
      <main className="screen wk" aria-busy="true">
        <p className="muted wk-loading" role="status">
          読み込み中…
        </p>
      </main>
    );
  }
  if (data === null) {
    return (
      <main className="screen wk">
        <EmptyState
          icon="📭"
          title="作品が見つかりません"
          body="削除されたか、別の端末の作品かもしれません。"
          action={
            preview ? undefined : (
              <a className="btn" href={hrefFor({ name: 'home' })}>
                本棚へ
              </a>
            )
          }
        />
      </main>
    );
  }

  const { work, manifest } = data;
  const tolerance = work.spoilerTolerance;
  const views = goalViews(data, secrets);
  const summary = manifest ? computeProgress(manifest, data.progress) : undefined;
  const hasCodeGoals = manifest?.goals.some(isCodeGoal) ?? false;
  const unseen = data.sealedOpens.filter((o) => !o.seen).length;
  const title = displayTitle(work, settings);

  const change = (next: { tab: WorkTab; sheet?: WorkSheet }) => onChange(next);
  const openGoal = (index: number) => change({ tab, sheet: { type: 'goal', index } });
  const closeSheet = () => change({ tab });

  const start = async () => {
    if (starting) return;
    setStarting(true);
    try {
      await startSession(repo, workId);
      ui.toast('記録を始めました', { tone: 'ok' });
    } catch (e) {
      const other = data.openSession && data.openSession.workId !== workId ? data.openSession.workId : undefined;
      const canJump = !preview && other !== undefined && isShioriError(e) && e.code === 'conflict';
      ui.toast(errorMessageJa(e), {
        tone: 'danger',
        ...(canJump
          ? { action: { label: '記録中の作品へ', onClick: () => navigate({ name: 'work', id: other, tab: 'progress' }) } }
          : {}),
      });
    } finally {
      setStarting(false);
    }
  };

  // Studio preview: the #/code route belongs to the real library, so the code is entered in place.
  const enterCodeInPlace = async () => {
    const input = await ui.prompt({
      title: '合言葉を入れる',
      label: '合言葉',
      okLabel: '確かめる',
      validate: (v) => {
        const p = parseCode(v);
        return p.ok ? null : codeErrorMessageJa(p.error);
      },
    });
    if (input === null) return;
    try {
      const out = await submitCode(repo, input, { workId });
      if (out.status === 'unlocked') {
        vibrate(30);
        ui.toast(out.secret ? `解放しました：${out.secret.title}` : '解放しました', { tone: 'ok' });
        if (out.openedSealedIds.length > 0 && out.workId) {
          const w = out.workId;
          ui.queueEnvelopes(out.openedSealedIds.map((sealedId) => ({ workId: w, sealedId })));
        }
      } else if (out.status === 'already') {
        ui.toast('この合言葉は入力済みです');
      } else if (out.status === 'invalid' && out.error) {
        ui.toast(codeErrorMessageJa(out.error), { tone: 'danger' });
      } else {
        ui.toast('この作品の合言葉ではないようです', { tone: 'danger' });
      }
    } catch (e) {
      ui.toast(errorMessageJa(e), { tone: 'danger' });
    }
  };

  let sheetNode: ReactNode = null;
  if (sheet?.type === 'goal') {
    const view = views[sheet.index];
    if (view) {
      sheetNode = (
        <GoalSheet
          key={view.goal.id}
          data={data}
          view={view}
          tolerance={tolerance}
          preview={preview}
          onClose={closeSheet}
          onEnterCode={() => void enterCodeInPlace()}
        />
      );
    }
  } else if (sheet?.type === 'sealed') {
    const item = manifest?.sealed[sheet.index];
    if (item) {
      sheetNode = (
        <Sheet open title={item.label} onClose={closeSheet}>
          <SealedReader workId={work.id} sealedId={item.id} />
        </Sheet>
      );
    }
  }

  let panel: ReactNode;
  switch (tab) {
    case 'progress':
      panel = (
        <ProgressTab
          data={data}
          views={views}
          tolerance={tolerance}
          preview={preview}
          starting={starting}
          onStartSession={() => void start()}
          onOpenGoal={openGoal}
          onQuickAttach={() => setQuickOpen(true)}
        />
      );
      break;
    case 'extras':
      panel = (
        <ExtrasTab data={data} tolerance={tolerance} onOpen={(index) => change({ tab, sheet: { type: 'sealed', index } })} />
      );
      break;
    case 'log':
      panel = <LogTab data={data} />;
      break;
    case 'notes':
      panel = <NotesTab data={data} onOpenGoal={openGoal} />;
      break;
  }

  return (
    <main className="screen wk" aria-labelledby={titleId}>
      <header className="wk-head">
        <EmojiCover emoji={work.coverEmoji} color={work.coverColor} size={56} />
        <div className="wk-head-text">
          <h1 id={titleId} className="wk-title">
            {title}
          </h1>
          <div className="wk-head-meta">
            <span className={`badge wk-status is-${work.status}`}>{STATUS_LABEL[work.status]}</span>
            <span className="small muted">{KIND_LABEL[work.kind]}</span>
            {summary ? (
              <span className="small muted">
                達成 {summary.pct}%
              </span>
            ) : (
              <span className="small muted">記録だけ</span>
            )}
          </div>
        </div>
      </header>

      {!preview || hasCodeGoals ? (
        <div className="wk-actions">
          {!preview || hasCodeGoals ? (
            preview ? (
              <button type="button" className="btn btn-sm btn-primary" onClick={() => void enterCodeInPlace()}>
                <span aria-hidden="true">🔑</span> 合言葉を入れる
              </button>
            ) : (
              <a className="btn btn-sm btn-primary" href={hrefFor({ name: 'code', workId: work.id })}>
                <span aria-hidden="true">🔑</span> 合言葉を入れる
              </a>
            )
          ) : null}
          {preview ? null : (
            <a className="btn btn-sm" href={hrefFor({ name: 'workEdit', id: work.id })}>
              <span aria-hidden="true">⚙️</span> 作品設定
            </a>
          )}
        </div>
      ) : null}

      <Tabs
        ariaLabel="作品ページの表示"
        tabs={[
          { id: 'progress', label: '進捗' },
          { id: 'extras', label: 'おまけ', badge: unseen > 0 ? unseen : undefined },
          { id: 'log', label: '記録' },
          { id: 'notes', label: 'メモ', badge: data.notes.length > 0 ? data.notes.length : undefined },
        ]}
        value={tab}
        onChange={(t) => change({ tab: t })}
      />

      <div className="wk-panel" role="tabpanel" id={`wk-panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {panel}
      </div>

      <SessionBar
        work={work}
        openSession={data.openSession}
        checkpoints={manifest?.checkpoints ?? []}
        preview={preview}
        starting={starting}
        onStart={() => void start()}
      />

      {sheetNode}
      {quickOpen && !manifest ? <QuickAttachSheet work={work} onClose={() => setQuickOpen(false)} /> : null}
    </main>
  );
}
