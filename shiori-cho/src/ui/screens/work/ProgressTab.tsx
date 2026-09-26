// 進捗 tab (docs/SPEC.md F7, F8 AC1/AC3/AC4, F9, F13 AC3): missable alerts, resume card, 「いまどこ？」,
// the overall ring, per-group goal lists and the one-time コンプ prompt.
import { useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { setGoalDone, updatePlayerManifest } from '../../../app/library';
import { UNDO_TOAST_MS } from '../../../core/constants';
import { computeProgress, isNoHint, missableAlerts } from '../../../core/progress';
import type { MissableAlert, SpoilerLevel } from '../../../core/types';
import { ProgressBar, ProgressRing } from '../../components/Progress';
import { SpoilerText } from '../../components/SpoilerText';
import { useRepo, useSettings, useUi } from '../../context';
import { hrefFor } from '../../router';
import { ResumeCard } from './ResumeCard';
import { errorMessageJa, newGoalId, patchWork } from './workModel';
import type { GoalView, WorkData } from './workModel';

export interface ProgressTabProps {
  data: WorkData;
  views: GoalView[];
  tolerance: SpoilerLevel;
  preview: boolean;
  starting: boolean;
  onStartSession(): void;
  onOpenGoal(index: number): void;
  onQuickAttach(): void;
}

export function ProgressTab(props: ProgressTabProps): ReactNode {
  const { data, views, tolerance, preview, starting, onStartSession, onOpenGoal } = props;
  const m = data.manifest;
  const resume = (
    <ResumeCard
      sessions={data.sessions}
      checkpoints={m?.checkpoints ?? []}
      canStart={data.openSession === undefined}
      starting={starting}
      onStart={onStartSession}
    />
  );

  if (!m) {
    return (
      <div className="stack">
        {resume}
        <NoManifestCard preview={preview} onQuickAttach={props.onQuickAttach} />
      </div>
    );
  }

  const alerts = missableAlerts(m, data.progress, data.work.currentCheckpointId);
  const soon = alerts.filter((a) => a.level === 'soon');
  const ahead = alerts.filter((a) => a.level === 'ahead');
  const summary = computeProgress(m, data.progress);
  const goalIndex = new Map(m.goals.map((g, i) => [g.id, i]));
  const cpLabel = (id: string) => m.checkpoints.find((c) => c.id === id)?.label ?? id;

  return (
    <div className="stack">
      {soon.length > 0 ? (
        <SoonAlerts
          alerts={soon}
          tolerance={tolerance}
          cpLabel={cpLabel}
          onOpen={(id) => {
            const i = goalIndex.get(id);
            if (i !== undefined) onOpenGoal(i);
          }}
        />
      ) : null}
      {resume}
      {m.checkpoints.length > 0 ? <CheckpointSelect data={data} /> : null}
      {ahead.length > 0 ? <AheadAlerts alerts={ahead} tolerance={tolerance} cpLabel={cpLabel} /> : null}

      {summary.total > 0 && summary.pct === 100 && !preview ? <CompletionPrompt data={data} /> : null}

      <section className="card wk-overall" aria-label="全体の進捗">
        <ProgressRing pct={summary.pct} caption={`${summary.done} / ${summary.total}`} />
        <div className="wk-overall-groups">
          {summary.total === 0 ? <p className="muted small">まだ項目がありません</p> : null}
          {summary.byGroup
            .filter((g) => g.total > 0)
            .map((g) => (
              <ProgressBar key={g.groupId} pct={g.pct} label={`${g.label}　${g.done}/${g.total}`} />
            ))}
        </div>
      </section>

      {m.groups.map((group) => {
        const list = views.filter((v) => v.goal.group === group.id);
        const sum = summary.byGroup.find((g) => g.groupId === group.id);
        return (
          <GoalGroup
            key={group.id}
            data={data}
            groupId={group.id}
            label={group.label}
            done={sum?.done ?? 0}
            total={sum?.total ?? 0}
            views={list}
            tolerance={tolerance}
            canAdd={m.author.kind === 'player' && !preview}
            onOpenGoal={onOpenGoal}
          />
        );
      })}
    </div>
  );
}

// ───────────────────────── 記録だけ ─────────────────────────

function NoManifestCard({ preview, onQuickAttach }: { preview: boolean; onQuickAttach(): void }): ReactNode {
  const titleId = useId();
  return (
    <section className="card wk-nomanifest" aria-labelledby={titleId}>
      <h2 id={titleId} className="wk-card-title">
        <span aria-hidden="true">📄</span> しおりファイルがありません
      </h2>
      <p className="small">
        この作品はプレイ記録とメモだけを付けています。しおりファイルを読み込むか、エンディングなどの数からかんたんなチェックリストを作ると、進捗を記録できます。
      </p>
      {preview ? null : (
        <div className="row-wrap">
          <a className="btn" href={hrefFor({ name: 'add' })}>
            しおりファイルを読み込む
          </a>
          <button type="button" className="btn" onClick={onQuickAttach}>
            かんたんしおりにする
          </button>
        </div>
      )}
    </section>
  );
}

// ───────────────────────── いまどこ？ ─────────────────────────

function CheckpointSelect({ data }: { data: WorkData }): ReactNode {
  const repo = useRepo();
  const ui = useUi();
  const id = useId();
  const checkpoints = data.manifest?.checkpoints ?? [];
  const value = data.work.currentCheckpointId ?? '';

  const onChange = async (next: string) => {
    try {
      await patchWork(repo, data.work.id, (w) => {
        const out = { ...w };
        if (next === '') delete out.currentCheckpointId;
        else out.currentCheckpointId = next;
        return out;
      });
    } catch (e) {
      ui.toast(errorMessageJa(e), { tone: 'danger' });
    }
  };

  return (
    <div className="field wk-where">
      <label htmlFor={id}>いまどこ？</label>
      <select id={id} className="select" value={value} onChange={(e) => void onChange(e.target.value)}>
        <option value="">まだ決めていない</option>
        {checkpoints.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
      <p className="field-hint">取り返しのつかない項目の注意が、いまの場所に合わせて表示されます。</p>
    </div>
  );
}

// ───────────────────────── missable alerts ─────────────────────────

function SoonAlerts(props: {
  alerts: MissableAlert[];
  tolerance: SpoilerLevel;
  cpLabel(id: string): string;
  onOpen(goalId: string): void;
}): ReactNode {
  const titleId = useId();
  return (
    <section className="wk-alert" aria-labelledby={titleId}>
      <h2 id={titleId} className="wk-alert-title">
        <span aria-hidden="true">⚠️</span> この先に進む前に確認を
      </h2>
      <ul className="wk-alert-list">
        {props.alerts.map((a) => (
          <li key={a.goalId} className="wk-alert-item">
            <p className="wk-alert-where small">「{props.cpLabel(a.beforeCheckpointId)}」に進む前に</p>
            <SpoilerText as="p" className="wk-alert-warn" text={a.warn} spoiler={a.spoiler} tolerance={props.tolerance} />
            <button type="button" className="btn btn-sm" onClick={() => props.onOpen(a.goalId)}>
              項目を見る
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function AheadAlerts(props: { alerts: MissableAlert[]; tolerance: SpoilerLevel; cpLabel(id: string): string }): ReactNode {
  return (
    <details className="wk-ahead">
      <summary>
        <span aria-hidden="true">🕯️</span> このあと気をつけたいこと（{props.alerts.length}件）
      </summary>
      <ul className="wk-ahead-list">
        {props.alerts.map((a) => (
          <li key={a.goalId}>
            <p className="small muted">「{props.cpLabel(a.beforeCheckpointId)}」より前に</p>
            <SpoilerText as="p" text={a.warn} spoiler={a.spoiler} tolerance={props.tolerance} />
          </li>
        ))}
      </ul>
    </details>
  );
}

// ───────────────────────── 100% → コンプ ─────────────────────────

function CompletionPrompt({ data }: { data: WorkData }): ReactNode {
  const repo = useRepo();
  const ui = useUi();
  const { settings, update } = useSettings();
  const [busy, setBusy] = useState(false);
  const work = data.work;
  if (work.status === 'completed' || settings.completionPromptedWorkIds.includes(work.id)) return null;

  const done = async (complete: boolean) => {
    setBusy(true);
    try {
      if (complete) await patchWork(repo, work.id, (w) => ({ ...w, status: 'completed' }));
      await update({ completionPromptedWorkIds: [...settings.completionPromptedWorkIds, work.id] });
      if (complete) ui.toast('「コンプ」にしました', { tone: 'ok' });
    } catch (e) {
      ui.toast(errorMessageJa(e), { tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card wk-complete" aria-label="すべて達成">
      <p className="wk-complete-title">
        <span aria-hidden="true">🎉</span> すべての項目を達成しました
      </p>
      <p className="small">この作品の状態を「コンプ」にしますか？</p>
      <div className="row-wrap">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void done(true)}>
          コンプにする
        </button>
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void done(false)}>
          今はしない
        </button>
      </div>
    </section>
  );
}

// ───────────────────────── goals ─────────────────────────

function GoalGroup(props: {
  data: WorkData;
  groupId: string;
  label: string;
  done: number;
  total: number;
  views: GoalView[];
  tolerance: SpoilerLevel;
  canAdd: boolean;
  onOpenGoal(index: number): void;
}): ReactNode {
  const repo = useRepo();
  const ui = useUi();
  const titleId = useId();
  const workId = props.data.work.id;
  /** goal ids with a toggle in flight (double taps are ignored) */
  const busy = useRef(new Set<string>());

  const toggle = async (v: GoalView) => {
    const goalId = v.goal.id;
    if (busy.current.has(goalId)) return;
    busy.current.add(goalId);
    const before = v.progress;
    try {
      await setGoalDone(repo, workId, goalId, !v.done);
      const undo = async () => {
        try {
          // Restore the exact earlier record (keeps doneAt and hintTierAtDone), or remove the new one.
          if (before) await repo.putProgress(before);
          else await setGoalDone(repo, workId, goalId, false);
        } catch (e) {
          ui.toast(errorMessageJa(e), { tone: 'danger' });
        }
      };
      ui.toast(v.done ? '達成を取り消しました' : '達成にしました', {
        action: { label: '元に戻す', onClick: () => void undo() },
        durationMs: UNDO_TOAST_MS,
      });
    } catch (e) {
      ui.toast(errorMessageJa(e), { tone: 'danger' });
    } finally {
      busy.current.delete(goalId);
    }
  };

  const addGoal = async () => {
    const label = await ui.prompt({
      title: '項目を追加',
      label: '項目名',
      okLabel: '追加する',
      validate: (value) => {
        const t = value.trim();
        if (t === '') return '項目名を入力してください';
        if (Array.from(t).length > 60) return '項目名は60文字以内にしてください';
        return null;
      },
    });
    if (label === null) return;
    try {
      await updatePlayerManifest(repo, workId, (m) => {
        m.goals.push({
          id: newGoalId(m),
          group: props.groupId,
          label: label.trim(),
          spoiler: 0,
          hints: [],
          unlock: { type: 'manual' },
        });
        return m;
      });
      ui.toast('項目を追加しました', { tone: 'ok' });
    } catch (e) {
      ui.toast(errorMessageJa(e), { tone: 'danger' });
    }
  };

  return (
    <section className="wk-group" aria-labelledby={titleId}>
      <h2 id={titleId} className="wk-group-title">
        <span className="wk-group-label">{props.label}</span>
        <span className="wk-group-count">
          {props.done}/{props.total}
        </span>
      </h2>
      {props.views.length > 0 ? (
        <ul className="wk-goals">
          {props.views.map((v) => (
            <GoalRow
              key={v.goal.id}
              view={v}
              tolerance={props.tolerance}
              onToggle={() => void toggle(v)}
              onOpen={() => props.onOpenGoal(v.index)}
            />
          ))}
        </ul>
      ) : (
        <p className="muted small wk-group-empty">項目がありません</p>
      )}
      {props.canAdd ? (
        <button type="button" className="btn btn-sm btn-ghost wk-add-goal" onClick={() => void addGoal()}>
          ＋ 項目を追加
        </button>
      ) : null}
    </section>
  );
}

function CheckIcon(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function HintDots({ used, total }: { used: number; total: number }): ReactNode {
  return (
    <span className="wk-dots" role="img" aria-label={`ヒント ${used}/${total} 使用`}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`wk-dot${i < used ? ' is-on' : ''}`} />
      ))}
    </span>
  );
}

function GoalRow(props: { view: GoalView; tolerance: SpoilerLevel; onToggle(): void; onOpen(): void }): ReactNode {
  const { view: v, tolerance } = props;
  const titleId = useId();
  const locked = v.isCode && !v.secret;
  const noHint = v.done && isNoHint(v.progress);
  return (
    <li className={`wk-goal${v.done ? ' is-done' : ''}`}>
      <span className="wk-goal-check">
        {v.isCode ? (
          <span className={`wk-check is-static${v.done ? ' is-on' : ''}`} aria-hidden="true">
            {v.done ? <CheckIcon /> : null}
          </span>
        ) : (
          <button
            type="button"
            className={`wk-check${v.done ? ' is-on' : ''}`}
            aria-pressed={v.done}
            aria-label="達成"
            aria-describedby={titleId}
            onClick={props.onToggle}
          >
            {v.done ? <CheckIcon /> : null}
          </button>
        )}
      </span>
      <div className="wk-goal-main">
        <p className="wk-goal-title" id={titleId}>
          {locked ? (
            <span className="wk-lock" role="img" aria-label="未解放">
              🔒
            </span>
          ) : null}
          {v.secret ? (
            <span className="wk-goal-secret">{v.secret.title}</span>
          ) : (
            <SpoilerText text={v.goal.label} spoiler={v.goal.spoiler} tolerance={tolerance} />
          )}
        </p>
        {v.isNew || noHint || v.goal.hints.length > 0 || v.done ? (
          <div className="wk-goal-meta">
            {v.done ? <span className="visually-hidden">達成済み</span> : null}
            {v.isNew ? <span className="badge badge-accent">NEW</span> : null}
            {noHint ? <span className="badge badge-ok">ノーヒント</span> : null}
            {v.goal.hints.length > 0 ? <HintDots used={v.hintTier} total={v.goal.hints.length} /> : null}
          </div>
        ) : null}
      </div>
      <button type="button" className="wk-goal-open" aria-labelledby={titleId} onClick={props.onOpen}>
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
          <path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </li>
  );
}
