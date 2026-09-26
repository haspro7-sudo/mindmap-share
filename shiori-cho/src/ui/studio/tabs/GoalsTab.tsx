// 工房 › 目標 tab (docs/SPEC.md F16 AC2, §6): the goal list (reorder, add) and a form per DraftGoal: public
// fields, three PUBLIC hint tiers (示唆/方向/答え), missable warning, unlock 手動/合言葉 with a generated code
// (英数字 or ひらがな5語) and 「作り直す」, and the sealed secret (title, description, unlock message).
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { generateGoalCode } from '../../../app/studio';
import { lintProject } from '../../../core/manifest/lint';
import { MANIFEST_LIMITS } from '../../../core/manifest/schema';
import type { CodeKind, DraftGoal, SpoilerLevel, StudioProject } from '../../../core/types';
import { useUi } from '../../context';
import { ChoiceGroup, IdField, IssueList, ItemTools, SelectField, TextField } from './fields';
import {
  HINT_TIERS,
  MSG_RELEASED_CODES,
  SPOILER_LEVELS,
  STUDIO_SPOILER_LABEL,
  countErrors,
  errorMessageJa,
  idError,
  issuesUnder,
  itemKeys,
  moveItem,
  nextSecret,
  removeGoal,
  renameGoal,
  replaceAt,
  sealedUsingGoal,
  uniqueId,
} from './model';
import type { StudioTabProps } from './model';

const KIND_OPTIONS: ReadonlyArray<{ value: CodeKind; label: string; hint: string }> = [
  { value: 'b32', label: '英数字', hint: '9文字。ゲーム向き' },
  { value: 'kana', label: 'ひらがな5語', hint: '読み上げやすく、音声作品・CG集向き' },
];

export function GoalsTab({ project, update }: StudioTabProps): ReactNode {
  const ui = useUi();
  const [selected, setSelected] = useState<number | null>(null);
  const returnFocus = useRef<number | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const issues = useMemo(() => lintProject(project), [project]);
  const goals = project.goals;
  const keys = itemKeys(goals);

  // Back from a form: focus that goal's row again.
  useEffect(() => {
    if (selected !== null || returnFocus.current === null) return;
    const i = returnFocus.current;
    returnFocus.current = null;
    listRef.current?.querySelectorAll<HTMLButtonElement>('.stu-row-main')[i]?.focus();
  }, [selected]);

  const add = (unlockType: 'manual' | 'code') => {
    try {
      const index = project.goals.length;
      update((p) => {
        const id = uniqueId(unlockType === 'code' ? 'end-' : 'goal-', p.goals.map((g) => g.id));
        const n = p.goals.length + 1;
        const base: DraftGoal = {
          id,
          group: p.groups[0]?.id ?? '',
          label: unlockType === 'code' ? `END ${p.goals.filter((g) => g.unlockType === 'code').length + 1}` : `目標 ${n}`,
          spoiler: unlockType === 'code' ? 1 : 0,
          hints: [],
          unlockType,
        };
        if (unlockType === 'code') {
          base.codeKind = 'b32';
          base.code = generateGoalCode(p, 'b32');
        }
        return { ...p, goals: [...p.goals, base] };
      });
      setSelected(index);
    } catch (e) {
      ui.toast(errorMessageJa(e), { tone: 'danger' });
    }
  };

  const goal = selected !== null ? goals[selected] : undefined;
  if (selected !== null && goal) {
    return (
      <GoalForm
        key={keys[selected]}
        project={project}
        update={update}
        index={selected}
        goal={goal}
        issues={issuesUnder(issues, `goals[${selected}]`)}
        onClose={() => {
          returnFocus.current = selected;
          setSelected(null);
        }}
        onDeleted={() => setSelected(null)}
      />
    );
  }

  const groupLabel = (id: string) => project.groups.find((g) => g.id === id)?.label || id || 'グループなし';

  return (
    <div className="stack stu-tab">
      <section className="card-flat stack" aria-labelledby="stu-goals">
        <div className="row">
          <h2 id="stu-goals" className="stu-h2">
            目標
          </h2>
          <span className="badge">{goals.length}件</span>
        </div>
        <p className="field-hint">
          エンディングや実績など、プレイヤーがチェックする項目です。「合言葉つき」の目標は、作中で表示する合言葉を入れると本当の名前が読めます。
        </p>
        {goals.length === 0 ? <p className="small muted">まだありません。下のボタンから追加してください。</p> : null}
        <ol className="stu-rows" ref={listRef}>
          {goals.map((g, i) => {
            const own = issuesUnder(issues, `goals[${i}]`);
            const errors = countErrors(own);
            return (
              <li key={keys[i]} className="stu-row">
                <button type="button" className="stu-row-main" onClick={() => setSelected(i)}>
                  <span className="stu-row-title">{g.label || '（表示名なし）'}</span>
                  <span className="stu-row-meta">
                    <span className="badge">{groupLabel(g.group)}</span>
                    {g.unlockType === 'code' ? (
                      <span className="badge badge-accent">
                        <span aria-hidden="true">🔑</span>合言葉
                      </span>
                    ) : (
                      <span className="badge">手動</span>
                    )}
                    {errors > 0 ? <span className="badge badge-danger">要修正 {errors}</span> : null}
                    {g.unlockType === 'code' && g.code ? <span className="mono small stu-row-code">{g.code}</span> : null}
                  </span>
                  <span className="visually-hidden">を編集</span>
                </button>
                <ItemTools
                  name={`目標「${g.label || g.id}」`}
                  index={i}
                  count={goals.length}
                  onMove={(d) => update((p) => ({ ...p, goals: moveItem(p.goals, i, d) }))}
                />
              </li>
            );
          })}
        </ol>
        <div className="row-wrap">
          <button type="button" className="btn btn-primary btn-sm" onClick={() => add('code')} disabled={goals.length >= MANIFEST_LIMITS.goals}>
            ＋ 合言葉つきの目標
          </button>
          <button type="button" className="btn btn-sm" onClick={() => add('manual')} disabled={goals.length >= MANIFEST_LIMITS.goals}>
            ＋ 手動の目標
          </button>
        </div>
      </section>
    </div>
  );
}

interface GoalFormProps extends StudioTabProps {
  index: number;
  goal: DraftGoal;
  issues: ReturnType<typeof issuesUnder>;
  onClose(): void;
  onDeleted(): void;
}

function GoalForm({ project, update, index, goal, issues, onClose, onDeleted }: GoalFormProps): ReactNode {
  const ui = useUi();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);

  const set = (fn: (g: DraftGoal) => DraftGoal) =>
    update((p) => {
      const cur = p.goals[index];
      return cur ? { ...p, goals: replaceAt(p.goals, index, fn(cur)) } : p;
    });
  const patch = (fields: Partial<DraftGoal>) => set((g) => ({ ...g, ...fields }));
  const released = project.lastExportedAt !== undefined;
  const pathIssue = (suffix: string) =>
    issues.find((i) => i.severity === 'error' && i.path === `goals[${index}]${suffix}`)?.messageJa ?? null;

  const newCode = (p: StudioProject, kind: CodeKind) => generateGoalCode(p, kind);

  const confirmReleased = async (): Promise<boolean> => {
    if (!released || !goal.code) return true;
    return ui.confirm({
      title: MSG_RELEASED_CODES,
      body: 'この作品はすでに書き出されています。合言葉を変えると、前の合言葉を入れたプレイヤーのおまけが開けなくなり、作中の表示も直す必要があります。それでも作り直しますか？',
      okLabel: '作り直す',
      danger: true,
    });
  };

  const regenerate = async (kind: CodeKind) => {
    if (!(await confirmReleased())) return;
    try {
      update((p) => {
        const cur = p.goals[index];
        if (!cur) return p;
        return { ...p, goals: replaceAt(p.goals, index, { ...cur, codeKind: kind, code: newCode(p, kind) }) };
      });
      ui.toast('合言葉を作り直しました');
    } catch (e) {
      ui.toast(errorMessageJa(e), { tone: 'danger' });
    }
  };

  const setUnlockType = (t: 'manual' | 'code') => {
    if (t === goal.unlockType) return;
    try {
      update((p) => {
        const cur = p.goals[index];
        if (!cur) return p;
        let next: DraftGoal = { ...cur, unlockType: t };
        if (t === 'code') {
          const kind = cur.codeKind ?? 'b32';
          next = { ...next, codeKind: kind, code: cur.code && cur.codeKind === kind ? cur.code : newCode(p, kind) };
        }
        return { ...p, goals: replaceAt(p.goals, index, next) };
      });
    } catch (e) {
      ui.toast(errorMessageJa(e), { tone: 'danger' });
    }
  };

  const setKind = async (kind: CodeKind) => {
    if (kind === goal.codeKind) return;
    await regenerate(kind);
  };

  const remove = async () => {
    const users = sealedUsingGoal(project, goal.id).length;
    const ok = await ui.confirm({
      title: `目標「${goal.label || goal.id}」を削除しますか？`,
      body: [
        users > 0 ? `この目標は、おまけ${users}件の条件に使われています。条件からも外れます。` : '',
        goal.unlockType === 'code' ? '合言葉と秘密の内容も消えます。' : '',
        released ? '発売済みの作品で目標を消すと、プレイヤーの端末ではその記録が「アーカイブ」になります。' : '',
      ]
        .filter(Boolean)
        .join('\n') || undefined,
      okLabel: '削除',
      danger: true,
    });
    if (!ok) return;
    update((p) => removeGoal(p, index));
    onDeleted();
    ui.toast('目標を削除しました');
  };

  const hints = goal.hints ?? [];
  const setHint = (tier: number, value: string) =>
    set((g) => {
      const next = [...(g.hints ?? [])];
      while (next.length < HINT_TIERS.length) next.push('');
      next[tier] = value;
      while (next.length > 0 && next[next.length - 1] === '') next.pop();
      return { ...g, hints: next };
    });

  const missableOn = goal.missable !== undefined;
  const cps = project.checkpoints;
  const groupOptions = project.groups.map((g) => ({ value: g.id, label: g.label || g.id }));
  const secret = goal.secret;

  return (
    <div className="stack stu-tab stu-form">
      <div className="row stu-form-head">
        <button type="button" className="btn btn-sm btn-ghost stu-back" onClick={onClose}>
          <span aria-hidden="true">←</span> 目標の一覧
        </button>
      </div>
      <h2 className="stu-h2 stu-form-title" tabIndex={-1} ref={headingRef}>
        目標「{goal.label || goal.id}」の編集
      </h2>
      <IssueList issues={issues} />

      <section className="card-flat stack" aria-labelledby={`stu-g-basic-${index}`}>
        <h3 id={`stu-g-basic-${index}`} className="stu-h3">
          基本（公開）
        </h3>
        <TextField
          label="表示名"
          required
          visibility="public"
          value={goal.label}
          maxLength={60}
          onChange={(v) => patch({ label: v })}
          error={goal.label.trim() === '' ? '表示名を入力してください' : null}
          hint={
            goal.unlockType === 'code'
              ? '合言葉を入れる前に見える名前です。「END 3」「？？？」のように、ネタバレしない名前にしてください。'
              : '例：図書館の猫と3回話した'
          }
        />
        <TextField
          label="ひとこと（任意）"
          visibility="public"
          value={goal.teaser ?? ''}
          maxLength={120}
          onChange={(v) => patch({ teaser: v === '' ? undefined : v })}
          hint="目標の下に小さく表示される説明です。"
        />
        <div className="stu-grid-2">
          <SelectField<string>
            label="グループ"
            value={goal.group}
            options={groupOptions}
            onChange={(v) => patch({ group: v })}
            error={pathIssue('.group')}
          />
          <SelectField<`${SpoilerLevel}`>
            label="ネタバレ度"
            value={`${goal.spoiler ?? 0}` as `${SpoilerLevel}`}
            options={SPOILER_LEVELS.map((l) => ({ value: `${l}` as `${SpoilerLevel}`, label: STUDIO_SPOILER_LABEL[l] }))}
            onChange={(v) => {
              if (v !== '') patch({ spoiler: Number(v) as SpoilerLevel });
            }}
            hint="公開される表示名・ひとこと・注意文のネタバレ度です。プレイヤーの設定より高いと、ぼかして表示されます。"
          />
        </div>
        <IdField
          label="目標ID"
          value={goal.id}
          validate={(next) => idError(next, goal.id, project.goals.filter((_, k) => k !== index).map((g) => g.id))}
          onCommit={(next) => update((p) => renameGoal(p, index, next))}
          issue={pathIssue('.id')}
          hint="QRコード画像のファイル名にも使われます（例：end-a）。発売後は変えないでください。"
        />
      </section>

      <section className="card-flat stack" aria-labelledby={`stu-g-hints-${index}`}>
        <div className="row">
          <h3 id={`stu-g-hints-${index}`} className="stu-h3">
            段階ヒント
          </h3>
          <span className="badge badge-warn stu-vis">公開</span>
        </div>
        <p className="banner banner-warn stu-note" role="note">
          <span aria-hidden="true">📢</span>
          <span>
            ヒントは<strong>公開</strong>されます。しおりファイルを開けば誰でも読めるので、秘密タイトルや合言葉は書かないでください。
          </span>
        </p>
        {HINT_TIERS.map((tier, k) => (
          <TextField
            key={tier}
            label={`ヒント${k + 1}：${tier}`}
            value={hints[k] ?? ''}
            maxLength={200}
            multiline
            rows={2}
            onChange={(v) => setHint(k, v)}
            error={pathIssue(`.hints[${k}]`)}
            hint={
              k === 0
                ? 'どこに目を向ければよいか、そっと示します。'
                : k === 1
                  ? 'どうすればよいか、方向を伝えます。'
                  : '答えそのものです。プレイヤーは確認してから開きます。'
            }
          />
        ))}
      </section>

      <section className="card-flat stack" aria-labelledby={`stu-g-miss-${index}`}>
        <div className="row">
          <h3 id={`stu-g-miss-${index}`} className="stu-h3">
            取り返し注意
          </h3>
          <span className="badge badge-warn stu-vis">公開</span>
        </div>
        <label className="switch-row">
          <span>この先に進むと取り逃す目標です</span>
          <input
            type="checkbox"
            checked={missableOn}
            onChange={(e) =>
              patch({
                missable: e.target.checked ? { before: cps[Math.min(1, cps.length - 1)]?.id ?? '', warn: '' } : undefined,
              })
            }
          />
        </label>
        {missableOn && goal.missable ? (
          <>
            {cps.length === 0 ? (
              <p className="field-error">先に「章・グループ」タブで章を追加してください。</p>
            ) : (
              <SelectField<string>
                label="この章より前に知らせる"
                value={goal.missable.before}
                options={cps.map((c) => ({ value: c.id, label: c.label || c.id }))}
                onChange={(v) => patch({ missable: { before: v, warn: goal.missable?.warn ?? '' } })}
                error={pathIssue('.missable.before')}
                hint="プレイヤーの現在地がこの章より前のあいだ、注意が表示されます。"
              />
            )}
            <TextField
              label="注意の文"
              visibility="public"
              value={goal.missable.warn}
              maxLength={120}
              onChange={(v) => patch({ missable: { before: goal.missable?.before ?? '', warn: v } })}
              error={goal.missable.warn.trim() === '' ? '注意の文を入力してください' : null}
              hint="何が起きるかは書かずに、見直してほしいことだけを書きます（例：この先に進む前に、図書館の中をもう一度見て回ろう）。"
            />
          </>
        ) : null}
      </section>

      <section className="card-flat stack" aria-labelledby={`stu-g-unlock-${index}`}>
        <h3 id={`stu-g-unlock-${index}`} className="stu-h3">
          達成のしかた
        </h3>
        <ChoiceGroup<'manual' | 'code'>
          legend="解放"
          value={goal.unlockType}
          onChange={setUnlockType}
          options={[
            { value: 'manual', label: '手動', hint: 'プレイヤーが自分でチェックします' },
            { value: 'code', label: '合言葉', hint: '作中の合言葉を入れると達成になり、秘密の内容が読めます' },
          ]}
        />
        {goal.unlockType === 'code' ? (
          <>
            <ChoiceGroup<CodeKind>
              legend="合言葉の種類"
              value={goal.codeKind ?? 'b32'}
              onChange={(k) => void setKind(k)}
              options={KIND_OPTIONS}
            />
            <div className="stu-code-box">
              <div className="stu-code-head">
                <span className="stu-code-label">合言葉</span>
                <span className="badge badge-ok stu-vis">
                  <span aria-hidden="true">🔒</span>秘密
                </span>
              </div>
              <p className="stu-code mono" aria-label={`合言葉 ${goal.code ?? 'なし'}`}>
                {goal.code ?? '（まだありません）'}
              </p>
              <p className="field-hint">作中でプレイヤーが目標を達成する場面に、この合言葉を表示してください。</p>
              {released ? (
                <p className="stu-field-warn">
                  <span aria-hidden="true">⚠️ </span>
                  {MSG_RELEASED_CODES}
                </p>
              ) : null}
              {pathIssue('.code') ? <p className="field-error">{pathIssue('.code')}</p> : null}
              <div className="row-wrap">
                <button type="button" className="btn btn-sm" onClick={() => void regenerate(goal.codeKind ?? 'b32')}>
                  作り直す
                </button>
              </div>
            </div>

            <div className="stack stu-secret-block">
              <div className="row">
                <h4 className="stu-h4">秘密の内容</h4>
                <span className="badge badge-ok stu-vis">
                  <span aria-hidden="true">🔒</span>秘密
                </span>
              </div>
              <p className="field-hint">合言葉を入れるまで暗号化されて、しおりファイルからは読めません。</p>
              <TextField
                label="秘密タイトル"
                required
                visibility="secret"
                value={secret?.title ?? ''}
                maxLength={60}
                onChange={(v) => patch({ secret: nextSecret(goal.secret, { title: v }) })}
                error={pathIssue('.secret.title')}
                hint="合言葉を入れたあとに表示される本当の名前です（例：星図の果て）。"
              />
              <TextField
                label="説明（任意）"
                visibility="secret"
                multiline
                rows={3}
                value={secret?.description ?? ''}
                maxLength={500}
                onChange={(v) => patch({ secret: nextSecret(goal.secret, { description: v }) })}
              />
              <TextField
                label="解放メッセージ（任意）"
                visibility="secret"
                multiline
                rows={2}
                value={secret?.unlockMessage ?? ''}
                maxLength={300}
                onChange={(v) => patch({ secret: nextSecret(goal.secret, { unlockMessage: v }) })}
                hint="合言葉を入れた直後に表示されます。"
              />
            </div>
          </>
        ) : null}
      </section>

      <div className="row-wrap stu-form-foot">
        <button type="button" className="btn btn-sm" onClick={onClose}>
          <span aria-hidden="true">←</span> 目標の一覧
        </button>
        <span className="spacer" />
        <button type="button" className="btn btn-sm btn-danger" onClick={() => void remove()}>
          この目標を削除
        </button>
      </div>
    </div>
  );
}
