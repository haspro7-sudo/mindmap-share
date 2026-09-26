// メモ tab (docs/SPEC.md F14): the work's notes (plain text, `||…||` spans blurred until tapped), add / edit /
// delete, up to 5,000 characters. Notes attached to a goal are listed too, with a link to their goal.
import { useId, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { NOTE_MAX_CHARS } from '../../../core/constants';
import type { Note } from '../../../core/types';
import { SpoilerNote } from '../../components/SpoilerNote';
import { useRepo, useUi } from '../../context';
import { formatDateTimeJa } from '../../format';
import { charCount, errorMessageJa } from './workModel';
import type { WorkData } from './workModel';

export interface NotesTabProps {
  data: WorkData;
  onOpenGoal(index: number): void;
}

export function NotesTab({ data, onOpenGoal }: NotesTabProps): ReactNode {
  const repo = useRepo();
  const ui = useUi();
  const [editingId, setEditingId] = useState<string | null>(null);
  const notes = [...data.notes].sort((a, b) => b.updatedAt - a.updatedAt);
  const goalIndex = new Map((data.manifest?.goals ?? []).map((g, i) => [g.id, i]));

  const save = async (text: string, existing?: Note): Promise<boolean> => {
    try {
      const now = Date.now();
      const note: Note = {
        id: existing?.id ?? globalThis.crypto.randomUUID(),
        workId: data.work.id,
        text,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      if (existing?.goalId !== undefined) note.goalId = existing.goalId;
      await repo.putNote(note);
      ui.toast(existing ? 'メモを更新しました' : 'メモを追加しました', { tone: 'ok' });
      return true;
    } catch (e) {
      ui.toast(errorMessageJa(e), { tone: 'danger' });
      return false;
    }
  };

  const remove = async (note: Note) => {
    const ok = await ui.confirm({ title: 'このメモを削除しますか？', okLabel: '削除する', danger: true });
    if (!ok) return;
    try {
      await repo.deleteNote(note.id);
      ui.toast('メモを削除しました');
    } catch (e) {
      ui.toast(errorMessageJa(e), { tone: 'danger' });
    }
  };

  return (
    <div className="stack">
      <NoteEditor key="new" submitLabel="メモを追加" onSave={(text) => save(text)} resetOnSave />
      <p className="small muted wk-notes-help">
        「||」で囲んだ部分（例：||猫についていく||）は、タップするまでぼかして表示します。閉じていない「||」はそのまま表示されます。
      </p>

      {notes.length === 0 ? (
        <p className="muted small center wk-notes-empty">まだメモはありません</p>
      ) : (
        <ul className="wk-notes">
          {notes.map((n) => {
            const gi = n.goalId !== undefined ? goalIndex.get(n.goalId) : undefined;
            return (
              <li key={n.id} className="card-flat wk-note">
                {editingId === n.id ? (
                  <NoteEditor
                    initial={n.text}
                    submitLabel="保存"
                    onCancel={() => setEditingId(null)}
                    onSave={async (text) => {
                      const ok = await save(text, n);
                      if (ok) setEditingId(null);
                      return ok;
                    }}
                  />
                ) : (
                  <>
                    <div className="wk-note-head small muted">
                      <span>{formatDateTimeJa(n.updatedAt)}</span>
                      {n.goalId !== undefined ? <span className="badge">項目のメモ</span> : null}
                    </div>
                    <SpoilerNote className="wk-note-text pre" text={n.text} />
                    <div className="wk-note-actions">
                      {gi !== undefined ? (
                        <button type="button" className="btn btn-sm btn-ghost" onClick={() => onOpenGoal(gi)}>
                          項目を開く
                        </button>
                      ) : null}
                      <span className="spacer" />
                      <button type="button" className="btn btn-sm" onClick={() => setEditingId(n.id)}>
                        編集
                      </button>
                      <button type="button" className="btn btn-sm btn-ghost wk-danger-text" onClick={() => void remove(n)}>
                        削除
                      </button>
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function NoteEditor(props: {
  initial?: string;
  submitLabel: string;
  onSave(text: string): Promise<boolean>;
  onCancel?(): void;
  resetOnSave?: boolean;
}): ReactNode {
  const fieldId = useId();
  const hintId = useId();
  const [text, setText] = useState(props.initial ?? '');
  const [busy, setBusy] = useState(false);
  const count = charCount(text);
  const tooLong = count > NOTE_MAX_CHARS;
  const blank = text.trim() === '';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || tooLong || blank) return;
    setBusy(true);
    try {
      const ok = await props.onSave(text);
      if (ok && props.resetOnSave) setText('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stack-sm wk-note-form" onSubmit={(e) => void submit(e)}>
      <label htmlFor={fieldId} className={props.initial === undefined ? 'field-label' : 'visually-hidden'}>
        {props.initial === undefined ? '新しいメモ' : 'メモを編集'}
      </label>
      <textarea
        id={fieldId}
        className="textarea"
        value={text}
        aria-describedby={hintId}
        aria-invalid={tooLong || undefined}
        placeholder="気づいたこと、覚えておきたいことなど"
        onChange={(e) => setText(e.target.value)}
      />
      <div className="wk-note-form-foot">
        <span id={hintId} className={tooLong ? 'field-error' : 'field-hint'}>
          {count.toLocaleString('ja-JP')} / {NOTE_MAX_CHARS.toLocaleString('ja-JP')}文字
          {tooLong ? '（長すぎます）' : ''}
        </span>
        <span className="spacer" />
        {props.onCancel ? (
          <button type="button" className="btn btn-sm btn-ghost" onClick={props.onCancel}>
            キャンセル
          </button>
        ) : null}
        <button type="submit" className="btn btn-sm btn-primary" disabled={busy || tooLong || blank}>
          {props.submitLabel}
        </button>
      </div>
    </form>
  );
}
