// Goal sheet (sheet=g<n>, docs/SPEC.md §6, F6 AC3, F7 AC3–AC4, F8, F14): title or decrypted secret title,
// teaser, description / unlock message, tiered hints (HoldToReveal, 答え needs a confirm), 合言葉,
// 「合言葉なしで達成にする」, the goal's note and, for player-authored files, rename / delete.
import { useEffect, useId, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { setGoalDone, updatePlayerManifest } from '../../../app/library';
import { markDoneWithoutCode } from '../../../app/unlock';
import { NOTE_MAX_CHARS } from '../../../core/constants';
import { isNoHint, isVisible } from '../../../core/progress';
import type { SpoilerLevel } from '../../../core/types';
import { HoldToReveal } from '../../components/HoldToReveal';
import { Sheet } from '../../components/Sheet';
import { SpoilerNote } from '../../components/SpoilerNote';
import { SpoilerText } from '../../components/SpoilerText';
import { useRepo, useUi } from '../../context';
import { hrefFor } from '../../router';
import { charCount, errorMessageJa, hintTierName, isAnswerTier, patchWork } from './workModel';
import type { GoalView, WorkData } from './workModel';

export const ANSWER_CONFIRM_TITLE = '答えを表示します。よろしいですか？';
const WITHOUT_CODE_EXPLANATION =
  '合言葉が手元にないときは、合言葉なしで達成にできます。進捗には数えますが、本当のタイトルは伏せたままで、この項目が条件の封印おまけも開きません。あとから合言葉を入れると解放されます。';

export interface GoalSheetProps {
  data: WorkData;
  view: GoalView;
  tolerance: SpoilerLevel;
  preview: boolean;
  onClose(): void;
  /** preview mode: code entry happens in place (the #/code route belongs to the real library) */
  onEnterCode(): void;
}

export function GoalSheet({ data, view, tolerance, preview, onClose, onEnterCode }: GoalSheetProps): ReactNode {
  const repo = useRepo();
  const ui = useUi();
  const moreId = useId();
  const hintsId = useId();
  const [moreOpen, setMoreOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const { goal } = view;
  const workId = data.work.id;
  const isPlayer = data.manifest?.author.kind === 'player';
  const group = data.manifest?.groups.find((g) => g.id === goal.group);
  const labelVisible = isVisible(goal.spoiler, tolerance);
  const title = view.secret?.title ?? (labelVisible ? goal.label : '項目の詳細');
  const noHint = view.done && isNoHint(view.progress);

  // Viewing the goal clears its NEW badge (F5 AC4).
  const isNew = view.isNew;
  const goalId = goal.id;
  useEffect(() => {
    if (!isNew) return;
    patchWork(repo, workId, (w) => ({ ...w, newGoalIds: w.newGoalIds.filter((id) => id !== goalId) })).catch(() => undefined);
  }, [isNew, goalId, repo, workId]);

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      ui.toast(errorMessageJa(e), { tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  const toggleManual = () =>
    run(async () => {
      await setGoalDone(repo, workId, goalId, !view.done);
      ui.toast(view.done ? '達成を取り消しました' : '達成にしました', { tone: 'ok' });
    });

  const markWithoutCode = async () => {
    const ok = await ui.confirm({
      title: '合言葉なしで達成にしますか？',
      body: '本当のタイトルは伏せたままで、この項目が条件の封印おまけも開きません。あとから合言葉を入れると解放されます。',
      okLabel: '達成にする',
    });
    if (!ok) return;
    await run(async () => {
      await markDoneWithoutCode(repo, workId, goalId);
      setMoreOpen(false);
      ui.toast('合言葉なしで達成にしました', { tone: 'ok' });
    });
  };

  const undoWithoutCode = () =>
    run(async () => {
      await setGoalDone(repo, workId, goalId, false);
      setMoreOpen(false);
      ui.toast('達成を取り消しました');
    });

  const revealTier = (tier: number) =>
    run(async () => {
      if (tier < 1 || tier > 3) return;
      await repo.putHint({ workId, goalId, tier: tier as 1 | 2 | 3, updatedAt: Date.now() });
    });

  const rename = async () => {
    const next = await ui.prompt({
      title: '名前を変える',
      label: '項目名',
      initialValue: goal.label,
      okLabel: '変える',
      validate: (value) => {
        const t = value.trim();
        if (t === '') return '項目名を入力してください';
        if (charCount(t) > 60) return '項目名は60文字以内にしてください';
        return null;
      },
    });
    if (next === null || next.trim() === goal.label) return;
    await run(async () => {
      await updatePlayerManifest(repo, workId, (m) => {
        const g = m.goals.find((x) => x.id === goalId);
        if (g) g.label = next.trim();
        return m;
      });
      ui.toast('名前を変えました', { tone: 'ok' });
    });
  };

  const remove = async () => {
    const hasProgress = view.done || view.hintTier > 0 || data.notes.some((n) => n.goalId === goalId);
    if (hasProgress) {
      const ok = await ui.confirm({
        title: 'この項目を削除しますか？',
        body: '達成やヒントの記録がある項目です。削除すると、この項目は進捗に数えなくなります。',
        okLabel: '削除する',
        danger: true,
      });
      if (!ok) return;
    }
    await run(async () => {
      await updatePlayerManifest(repo, workId, (m) => {
        m.goals = m.goals.filter((g) => g.id !== goalId);
        return m;
      });
      ui.toast('項目を削除しました');
      onClose();
    });
  };

  const hintCount = goal.hints.length;
  const tier = view.hintTier;

  return (
    <Sheet open title={title} onClose={onClose}>
      <div className="stack gs">
        <div className="gs-meta">
          {group ? <span className="badge">{group.label}</span> : null}
          {view.done ? (
            <span className="badge badge-ok">✓ 達成</span>
          ) : view.isCode ? (
            <span className="badge">🔒 合言葉で解放</span>
          ) : (
            <span className="badge">未達成</span>
          )}
          {view.isNew ? <span className="badge badge-accent">NEW</span> : null}
          {noHint ? <span className="badge badge-ok">ノーヒント</span> : null}
        </div>

        {view.secret ? (
          <p className="small muted gs-public">表示名：{goal.label}</p>
        ) : labelVisible ? null : (
          <SpoilerText as="p" className="gs-label" text={goal.label} spoiler={goal.spoiler} tolerance={tolerance} />
        )}

        {goal.teaser ? (
          <SpoilerText as="p" className="gs-teaser" text={goal.teaser} spoiler={goal.spoiler} tolerance={tolerance} />
        ) : null}

        {view.secret?.description ? <p className="pre gs-desc">{view.secret.description}</p> : null}
        {view.secret?.unlockMessage ? <blockquote className="pre gs-message">{view.secret.unlockMessage}</blockquote> : null}

        {view.isCode && view.done && !view.redeemed ? (
          <p className="banner gs-note-banner">
            合言葉なしで達成にしています。本当のタイトルは伏せたままで、この項目が条件の封印おまけも開きません。
          </p>
        ) : null}

        {/* actions */}
        {!view.isCode ? (
          <div className="row-wrap">
            <button
              type="button"
              className={`btn${view.done ? '' : ' btn-primary'}`}
              aria-pressed={view.done}
              disabled={busy}
              onClick={() => void toggleManual()}
            >
              {view.done ? '達成を取り消す' : '達成にする'}
            </button>
          </div>
        ) : !view.redeemed ? (
          <div className="stack-sm">
            <div className="row-wrap">
              {preview ? (
                <button type="button" className="btn btn-primary" onClick={onEnterCode}>
                  合言葉を入れる
                </button>
              ) : (
                <a className="btn btn-primary" href={hrefFor({ name: 'code', workId })}>
                  合言葉を入れる
                </a>
              )}
              <button
                type="button"
                className="btn btn-ghost gs-more-btn"
                aria-expanded={moreOpen}
                aria-controls={moreId}
                onClick={() => setMoreOpen((o) => !o)}
              >
                <span aria-hidden="true">⋯</span> その他
              </button>
            </div>
            <div id={moreId} className="card-flat gs-more" hidden={!moreOpen}>
              {view.done ? (
                <>
                  <p className="small">合言葉なしの達成を取り消します。</p>
                  <button type="button" className="btn" disabled={busy} onClick={() => void undoWithoutCode()}>
                    達成を取り消す
                  </button>
                </>
              ) : (
                <>
                  <p className="small">{WITHOUT_CODE_EXPLANATION}</p>
                  <button type="button" className="btn" disabled={busy} onClick={() => void markWithoutCode()}>
                    合言葉なしで達成にする
                  </button>
                </>
              )}
            </div>
          </div>
        ) : null}

        {/* hints */}
        {hintCount > 0 ? (
          <section className="gs-hints" aria-labelledby={hintsId}>
            <h3 id={hintsId} className="gs-sub">
              ヒント <span className="muted small">（長押しで1段ずつ表示）</span>
            </h3>
            <ol className="gs-hint-list">
              {goal.hints.map((text, i) => {
                const n = i + 1;
                const name = hintTierName(n, hintCount);
                if (n <= tier) {
                  return (
                    <li key={n} className="gs-hint is-open">
                      <p className="gs-hint-head">
                        ヒント{n}（{name}）
                      </p>
                      <p className="pre gs-hint-text">{text}</p>
                    </li>
                  );
                }
                const next = n === tier + 1;
                return (
                  <li key={n} className="gs-hint">
                    <HoldToReveal
                      label={`ヒント${n}（${name}）を見る`}
                      disabled={!next || busy}
                      confirm={
                        isAnswerTier(n, hintCount) ? { title: ANSWER_CONFIRM_TITLE, okLabel: '表示する' } : undefined
                      }
                      onReveal={() => void revealTier(n)}
                    />
                    {next ? null : <p className="field-hint">前のヒントを見ると選べます</p>}
                  </li>
                );
              })}
            </ol>
          </section>
        ) : null}

        <GoalNote data={data} goalId={goalId} />

        {isPlayer && !preview ? (
          <div className="gs-player">
            <p className="small muted">このしおりはあなたが作ったものです。</p>
            <div className="row-wrap">
              <button type="button" className="btn" disabled={busy} onClick={() => void rename()}>
                名前を変える
              </button>
              <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void remove()}>
                項目を削除
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}

// ───────────────────────── goal note ─────────────────────────

function GoalNote({ data, goalId }: { data: WorkData; goalId: string }): ReactNode {
  const repo = useRepo();
  const ui = useUi();
  const fieldId = useId();
  const hintId = useId();
  const existing = data.notes.find((n) => n.goalId === goalId);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const count = charCount(text);
  const tooLong = count > NOTE_MAX_CHARS;

  const startEdit = () => {
    setText(existing?.text ?? '');
    setEditing(true);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (tooLong || busy) return;
    setBusy(true);
    try {
      const now = Date.now();
      if (text.trim() === '') {
        if (existing) await repo.deleteNote(existing.id);
      } else {
        await repo.putNote({
          id: existing?.id ?? globalThis.crypto.randomUUID(),
          workId: data.work.id,
          goalId,
          text,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        });
      }
      setEditing(false);
      ui.toast('メモを保存しました', { tone: 'ok' });
    } catch (err) {
      ui.toast(errorMessageJa(err), { tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="gs-notebox" aria-label="この項目のメモ">
      <h3 className="gs-sub">この項目のメモ</h3>
      {editing ? (
        <form className="stack-sm" onSubmit={(e) => void save(e)}>
          <label htmlFor={fieldId} className="visually-hidden">
            この項目のメモ
          </label>
          <textarea
            id={fieldId}
            className="textarea"
            value={text}
            aria-describedby={hintId}
            aria-invalid={tooLong || undefined}
            onChange={(e) => setText(e.target.value)}
          />
          <p id={hintId} className={tooLong ? 'field-error' : 'field-hint'}>
            {count.toLocaleString('ja-JP')} / {NOTE_MAX_CHARS.toLocaleString('ja-JP')}文字・||ここ|| のように囲むと、タップするまでぼかします
          </p>
          <div className="row-wrap">
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy || tooLong}>
              保存
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditing(false)}>
              キャンセル
            </button>
          </div>
        </form>
      ) : existing ? (
        <div className="stack-sm">
          <SpoilerNote className="card-flat gs-note pre" text={existing.text} />
          <div>
            <button type="button" className="btn btn-sm" onClick={startEdit}>
              メモを編集
            </button>
          </div>
        </div>
      ) : (
        <div>
          <button type="button" className="btn btn-sm" onClick={startEdit}>
            ＋ メモを書く
          </button>
        </div>
      )}
    </section>
  );
}
