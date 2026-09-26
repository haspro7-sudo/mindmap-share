// 「前回の続き（今日／昨日／N日ぶり）」 card (docs/SPEC.md F13 AC3): the latest ended session with resume info.
import { useId } from 'react';
import type { ReactNode } from 'react';
import { daysSince, resumeInfo, resumeLabelJa } from '../../../core/session';
import type { Checkpoint, Session } from '../../../core/types';
import { useNow } from './workModel';

export interface ResumeCardProps {
  sessions: readonly Session[];
  checkpoints: readonly Checkpoint[];
  /** show 「続きを始める」 (no session is being recorded) */
  canStart: boolean;
  starting?: boolean;
  onStart(): void;
}

export function ResumeCard({ sessions, checkpoints, canStart, starting = false, onStart }: ResumeCardProps): ReactNode {
  const titleId = useId();
  const now = useNow(60_000);
  const s = resumeInfo(sessions);
  if (!s || s.endedAt === undefined) return null;
  const when = resumeLabelJa(daysSince(s.endedAt, now));
  const cp = s.checkpointId ? checkpoints.find((c) => c.id === s.checkpointId)?.label : undefined;
  return (
    <section className="card wk-resume" aria-labelledby={titleId}>
      <h2 id={titleId} className="wk-resume-title">
        <span aria-hidden="true">🔖</span> 前回の続き（{when}）
      </h2>
      <dl className="wk-resume-list">
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
      {canStart ? (
        <button type="button" className="btn btn-primary wk-resume-btn" onClick={onStart} disabled={starting}>
          <span aria-hidden="true">▶</span>
          <span>続きを始める</span>
        </button>
      ) : null}
    </section>
  );
}
