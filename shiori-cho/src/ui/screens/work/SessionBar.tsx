// Sticky bottom session bar 「▶ 始める」 / 「■ 終える 00:42」 and the end sheet (docs/SPEC.md F13 AC1–AC2).
import { useId, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { endSession } from '../../../app/sessions';
import { formatMinutesJa, sessionMinutes } from '../../../core/session';
import type { Checkpoint, Session, WorkRecord } from '../../../core/types';
import { Sheet } from '../../components/Sheet';
import { useRepo, useUi } from '../../context';
import { hrefFor } from '../../router';
import { SessionFields } from './LogTab';
import type { SessionFieldValues } from './LogTab';
import { errorMessageJa, formatElapsed, parseMinutesField, useNow } from './workModel';

export interface SessionBarProps {
  work: WorkRecord;
  openSession?: Session;
  checkpoints: readonly Checkpoint[];
  preview: boolean;
  starting: boolean;
  onStart(): void;
}

export function SessionBar({ work, openSession, checkpoints, preview, starting, onStart }: SessionBarProps): ReactNode {
  const mine = openSession !== undefined && openSession.workId === work.id ? openSession : undefined;
  const other = openSession !== undefined && !mine;
  const now = useNow(mine ? 1000 : null);
  const [ending, setEnding] = useState(false);

  // One stable <button> for both states, so keyboard focus stays on it when 始める turns into 終える.
  return (
    <div
      className={`wk-sessionbar${mine ? ' is-recording' : ''}${other ? ' has-other' : ''}`}
      role="region"
      aria-label="プレイ記録"
    >
      <div className="wk-sessionbar-inner">
        {other ? (
          <p className="wk-sb-other small">
            <span>ほかの作品を記録中です。</span>
            {preview ? null : <a href={hrefFor({ name: 'work', id: openSession.workId, tab: 'progress' })}>その作品を開く</a>}
          </p>
        ) : null}
        <button
          type="button"
          className={`btn btn-block wk-sb-btn${mine ? ' wk-sb-end' : ' btn-primary'}`}
          onClick={mine ? () => setEnding(true) : onStart}
          disabled={!mine && starting}
          aria-haspopup={mine ? 'dialog' : undefined}
        >
          {mine ? (
            <>
              <span className="wk-sb-dot" aria-hidden="true" />
              <span aria-hidden="true">■</span>
              <span>終える</span>
              <span className="wk-sb-timer" aria-hidden="true">
                {formatElapsed(now - mine.startedAt)}
              </span>
              <span className="visually-hidden">（記録中）</span>
            </>
          ) : (
            <>
              <span aria-hidden="true">▶</span>
              <span>始める</span>
            </>
          )}
        </button>
      </div>
      {mine && ending ? (
        <EndSessionSheet session={mine} work={work} checkpoints={checkpoints} onClose={() => setEnding(false)} />
      ) : null}
    </div>
  );
}

export function EndSessionSheet({
  session,
  work,
  checkpoints,
  onClose,
}: {
  session: Session;
  work: WorkRecord;
  checkpoints: readonly Checkpoint[];
  onClose(): void;
}): ReactNode {
  const repo = useRepo();
  const ui = useUi();
  const formId = useId();
  const [values, setValues] = useState<SessionFieldValues>(() => ({
    minutes: String(sessionMinutes(session.startedAt, Date.now())),
    checkpointId: work.currentCheckpointId ?? '',
    whereNote: '',
    nextTodo: '',
  }));
  const [minutesError, setMinutesError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const parsed = parseMinutesField(values.minutes);
    if (!parsed.ok) {
      setMinutesError(parsed.message);
      return;
    }
    setMinutesError(null);
    setBusy(true);
    try {
      const input: { minutes?: number; checkpointId?: string; whereNote?: string; nextTodo?: string } = {
        whereNote: values.whereNote,
        nextTodo: values.nextTodo,
      };
      if (parsed.value !== undefined) input.minutes = parsed.value;
      if (values.checkpointId !== '') input.checkpointId = values.checkpointId;
      const ended = await endSession(repo, session.id, input);
      ui.toast(`記録しました（${formatMinutesJa(ended.minutes ?? 0)}）`, { tone: 'ok' });
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
      title="記録を終える"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            まだ続ける
          </button>
          <button type="submit" form={formId} className="btn btn-primary" disabled={busy}>
            記録を終える
          </button>
        </>
      }
    >
      <form id={formId} className="stack" onSubmit={(e) => void submit(e)} noValidate>
        <p className="small muted">どれも空欄のままで大丈夫です。次に開いたとき「前回の続き」に表示されます。</p>
        <SessionFields values={values} onChange={setValues} checkpoints={checkpoints} minutesError={minutesError} />
      </form>
    </Sheet>
  );
}
