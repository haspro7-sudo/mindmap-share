// 記録 tab (docs/SPEC.md F13 AC4): 累計時間, 最終プレイ日 and the session list (edit in a sheet, delete with confirm).
import { useId, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { SESSION_NOTE_MAX_CHARS, editSession } from '../../../app/sessions';
import { SESSION_MAX_MINUTES } from '../../../core/constants';
import { formatMinutesJa, totalMinutes } from '../../../core/session';
import type { Checkpoint, Session } from '../../../core/types';
import { EmptyState } from '../../components/EmptyState';
import { Sheet } from '../../components/Sheet';
import { useRepo, useUi } from '../../context';
import { formatDateJa, formatDateTimeJa } from '../../format';
import { charCount, errorMessageJa, parseMinutesField } from './workModel';
import type { WorkData } from './workModel';

export function LogTab({ data }: { data: WorkData }): ReactNode {
  const repo = useRepo();
  const ui = useUi();
  const [editing, setEditing] = useState<Session | null>(null);
  const checkpoints = data.manifest?.checkpoints ?? [];
  const sessions = data.sessions;
  const ended = sessions.filter((s) => s.endedAt !== undefined);
  const lastEnded = ended.reduce<number | undefined>((acc, s) => (acc === undefined || s.endedAt! > acc ? s.endedAt : acc), undefined);
  const lastPlayed = data.work.lastPlayedAt ?? lastEnded;
  const cpLabel = (id?: string) => (id ? checkpoints.find((c) => c.id === id)?.label : undefined);

  const remove = async (s: Session) => {
    const ok = await ui.confirm({
      title: 'この記録を削除しますか？',
      body: `${formatDateTimeJa(s.startedAt)} の記録です。削除すると元に戻せません。`,
      okLabel: '削除する',
      danger: true,
    });
    if (!ok) return;
    try {
      await repo.deleteSession(s.id);
      ui.toast('記録を削除しました');
    } catch (e) {
      ui.toast(errorMessageJa(e), { tone: 'danger' });
    }
  };

  return (
    <div className="stack">
      <section className="card wk-stats-card" aria-label="プレイのまとめ">
        <dl className="wk-stats">
          <div>
            <dt>累計時間</dt>
            <dd>{formatMinutesJa(totalMinutes(sessions))}</dd>
          </div>
          <div>
            <dt>最終プレイ日</dt>
            <dd>{lastPlayed !== undefined ? formatDateJa(lastPlayed) : 'まだありません'}</dd>
          </div>
          <div>
            <dt>記録</dt>
            <dd>{ended.length}回</dd>
          </div>
        </dl>
      </section>

      <h2 className="section-title">プレイ記録</h2>
      {sessions.length === 0 ? (
        <EmptyState icon="⏱️" title="まだ記録がありません" body="下の「始める」を押すと、遊んだ時間を記録できます。" />
      ) : (
        <ul className="wk-sessions">
          {sessions.map((s) => {
            const cp = cpLabel(s.checkpointId);
            const open = s.endedAt === undefined;
            return (
              <li key={s.id} className="card-flat wk-session">
                <div className="wk-session-head">
                  <span className="wk-session-date">{formatDateTimeJa(s.startedAt)}</span>
                  {open ? (
                    <span className="badge badge-accent">記録中</span>
                  ) : (
                    <span className="wk-session-min">{formatMinutesJa(s.minutes ?? 0)}</span>
                  )}
                </div>
                {cp || s.whereNote || s.nextTodo ? (
                  <dl className="wk-session-notes small">
                    {cp ? (
                      <div>
                        <dt>現在地</dt>
                        <dd>{cp}</dd>
                      </div>
                    ) : null}
                    {s.whereNote ? (
                      <div>
                        <dt>どこまで</dt>
                        <dd>{s.whereNote}</dd>
                      </div>
                    ) : null}
                    {s.nextTodo ? (
                      <div>
                        <dt>次にやること</dt>
                        <dd>{s.nextTodo}</dd>
                      </div>
                    ) : null}
                  </dl>
                ) : null}
                {open ? null : (
                  <div className="wk-session-actions">
                    <button
                      type="button"
                      className="btn btn-sm"
                      aria-label={`${formatDateTimeJa(s.startedAt)} の記録を編集`}
                      onClick={() => setEditing(s)}
                    >
                      編集
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost wk-danger-text"
                      aria-label={`${formatDateTimeJa(s.startedAt)} の記録を削除`}
                      onClick={() => void remove(s)}
                    >
                      削除
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {editing ? <SessionEditSheet session={editing} checkpoints={checkpoints} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

// ───────────────────────── shared session fields ─────────────────────────

export interface SessionFieldValues {
  minutes: string;
  checkpointId: string;
  whereNote: string;
  nextTodo: string;
}

export function SessionFields(props: {
  values: SessionFieldValues;
  onChange(next: SessionFieldValues): void;
  checkpoints: readonly Checkpoint[];
  minutesError?: string | null;
}): ReactNode {
  const { values, onChange, checkpoints } = props;
  const minId = useId();
  const minHint = useId();
  const cpId = useId();
  const whereId = useId();
  const whereHint = useId();
  const nextId = useId();
  const nextHint = useId();
  const set = (patch: Partial<SessionFieldValues>) => onChange({ ...values, ...patch });
  return (
    <>
      <div className="field">
        <label htmlFor={minId}>遊んだ時間（分）</label>
        <input
          id={minId}
          className="input wk-min-input"
          type="number"
          inputMode="numeric"
          min={0}
          max={SESSION_MAX_MINUTES}
          step={1}
          value={values.minutes}
          aria-describedby={minHint}
          aria-invalid={props.minutesError ? true : undefined}
          onChange={(e) => set({ minutes: e.target.value })}
        />
        <p id={minHint} className={props.minutesError ? 'field-error' : 'field-hint'}>
          {props.minutesError ?? `最大${SESSION_MAX_MINUTES}分（12時間）まで。空欄なら時計から計算します`}
        </p>
      </div>
      {checkpoints.length > 0 ? (
        <div className="field">
          <label htmlFor={cpId}>現在地</label>
          <select id={cpId} className="select" value={values.checkpointId} onChange={(e) => set({ checkpointId: e.target.value })}>
            <option value="">指定しない</option>
            {checkpoints.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <div className="field">
        <label htmlFor={whereId}>どこまで進んだ？</label>
        <input
          id={whereId}
          className="input"
          type="text"
          maxLength={SESSION_NOTE_MAX_CHARS}
          value={values.whereNote}
          placeholder="例：図書館の2階まで"
          aria-describedby={whereHint}
          onChange={(e) => set({ whereNote: e.target.value })}
        />
        <p id={whereHint} className="field-hint">
          {charCount(values.whereNote)} / {SESSION_NOTE_MAX_CHARS}文字・空欄でもかまいません
        </p>
      </div>
      <div className="field">
        <label htmlFor={nextId}>次にやること</label>
        <input
          id={nextId}
          className="input"
          type="text"
          maxLength={SESSION_NOTE_MAX_CHARS}
          value={values.nextTodo}
          placeholder="例：地下の書庫を調べる"
          aria-describedby={nextHint}
          onChange={(e) => set({ nextTodo: e.target.value })}
        />
        <p id={nextHint} className="field-hint">
          {charCount(values.nextTodo)} / {SESSION_NOTE_MAX_CHARS}文字・空欄でもかまいません
        </p>
      </div>
    </>
  );
}

function SessionEditSheet({
  session,
  checkpoints,
  onClose,
}: {
  session: Session;
  checkpoints: readonly Checkpoint[];
  onClose(): void;
}): ReactNode {
  const repo = useRepo();
  const ui = useUi();
  const formId = useId();
  const [values, setValues] = useState<SessionFieldValues>({
    minutes: session.minutes !== undefined ? String(session.minutes) : '',
    checkpointId: session.checkpointId ?? '',
    whereNote: session.whereNote ?? '',
    nextTodo: session.nextTodo ?? '',
  });
  const [minutesError, setMinutesError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = parseMinutesField(values.minutes);
    if (!parsed.ok) {
      setMinutesError(parsed.message);
      return;
    }
    setMinutesError(null);
    setBusy(true);
    try {
      const next: Session = { ...session };
      if (parsed.value === undefined) delete next.minutes;
      else next.minutes = parsed.value;
      if (values.checkpointId === '') delete next.checkpointId;
      else next.checkpointId = values.checkpointId;
      next.whereNote = values.whereNote;
      next.nextTodo = values.nextTodo;
      await editSession(repo, next);
      ui.toast('記録を更新しました', { tone: 'ok' });
      onClose();
    } catch (err) {
      ui.toast(errorMessageJa(err), { tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open
      title="記録を編集"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            キャンセル
          </button>
          <button type="submit" form={formId} className="btn btn-primary" disabled={busy}>
            保存
          </button>
        </>
      }
    >
      <form id={formId} className="stack" onSubmit={(e) => void submit(e)} noValidate>
        <p className="small muted">{formatDateTimeJa(session.startedAt)} に始めた記録</p>
        <SessionFields values={values} onChange={setValues} checkpoints={checkpoints} minutesError={minutesError} />
      </form>
    </Sheet>
  );
}
