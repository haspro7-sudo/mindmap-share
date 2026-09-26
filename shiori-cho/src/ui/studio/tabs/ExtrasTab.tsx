// 工房 › おまけ tab (docs/SPEC.md F12, F16, §6): sealed extras. Public label/teaser/kind, the condition
// (すべて = allOf / どれか = anyOf over code goals) and the sealed payload (title, body, from, return code,
// optional store link card).
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { lintProject } from '../../../core/manifest/lint';
import { MANIFEST_LIMITS, SEALED_KINDS } from '../../../core/manifest/schema';
import { STORE_CODE_INVALID_JA, parseStoreCode } from '../../../core/storeCode';
import type { DraftSealed, SealedKind, SealedPayload } from '../../../core/types';
import { SEALED_KIND_ICON, SEALED_KIND_LABEL } from '../../components/sealedKind';
import { useUi } from '../../context';
import { ChoiceGroup, IdField, IssueList, ItemTools, SelectField, TextField, VisibilityBadge } from './fields';
import {
  codeGoalsOf,
  countErrors,
  idError,
  issuesUnder,
  itemKeys,
  moveItem,
  nextReturnCode,
  nextStoreLink,
  removeAt,
  replaceAt,
  uniqueId,
} from './model';
import type { StudioTabProps } from './model';

export function ExtrasTab({ project, update }: StudioTabProps): ReactNode {
  const [selected, setSelected] = useState<number | null>(null);
  const returnFocus = useRef<number | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const issues = useMemo(() => lintProject(project), [project]);
  const items = project.sealed;
  const keys = itemKeys(items);

  useEffect(() => {
    if (selected !== null || returnFocus.current === null) return;
    const i = returnFocus.current;
    returnFocus.current = null;
    listRef.current?.querySelectorAll<HTMLButtonElement>('.stu-row-main')[i]?.focus();
  }, [selected]);

  const add = () => {
    const index = project.sealed.length;
    update((p) => {
      const id = uniqueId('extra-', p.sealed.map((s) => s.id));
      const label = `おまけ${p.sealed.length + 1}`;
      const item: DraftSealed = { id, label, kind: 'letter', mode: 'allOf', goals: [], payload: { title: label, body: '' } };
      return { ...p, sealed: [...p.sealed, item] };
    });
    setSelected(index);
  };

  const item = selected !== null ? items[selected] : undefined;
  if (selected !== null && item) {
    return (
      <SealedForm
        key={keys[selected]}
        project={project}
        update={update}
        index={selected}
        item={item}
        issues={issuesUnder(issues, `sealed[${selected}]`)}
        onClose={() => {
          returnFocus.current = selected;
          setSelected(null);
        }}
        onDeleted={() => setSelected(null)}
      />
    );
  }

  return (
    <div className="stack stu-tab">
      <section className="card-flat stack" aria-labelledby="stu-extras">
        <div className="row">
          <h2 id="stu-extras" className="stu-h2">
            おまけ（封印）
          </h2>
          <span className="badge">{items.length}件</span>
        </div>
        <p className="field-hint">
          合言葉がそろうと開く文章のおまけです（手紙・あとがき・後日談など）。中身は暗号化され、条件の合言葉を入れるまで読めません。
        </p>
        {codeGoalsOf(project).length === 0 ? (
          <p className="banner banner-warn stu-note" role="note">
            <span aria-hidden="true">💡</span>
            <span>おまけの条件には、合言葉つきの目標が必要です。先に「目標」タブで作ってください。</span>
          </p>
        ) : null}
        {items.length === 0 ? <p className="small muted">まだありません。</p> : null}
        <ol className="stu-rows" ref={listRef}>
          {items.map((s, i) => {
            const errors = countErrors(issuesUnder(issues, `sealed[${i}]`));
            return (
              <li key={keys[i]} className="stu-row">
                <button type="button" className="stu-row-main" onClick={() => setSelected(i)}>
                  <span className="stu-row-title">
                    <span aria-hidden="true">{SEALED_KIND_ICON[s.kind]} </span>
                    {s.label || '（表示名なし）'}
                  </span>
                  <span className="stu-row-meta">
                    <span className="badge">{SEALED_KIND_LABEL[s.kind]}</span>
                    <span className="badge badge-accent">
                      {s.mode === 'allOf' ? `すべて（${s.goals.length}）` : `どれか（${s.goals.length}）`}
                    </span>
                    {errors > 0 ? <span className="badge badge-danger">要修正 {errors}</span> : null}
                  </span>
                  <span className="visually-hidden">を編集</span>
                </button>
                <ItemTools
                  name={`おまけ「${s.label || s.id}」`}
                  index={i}
                  count={items.length}
                  onMove={(d) => update((p) => ({ ...p, sealed: moveItem(p.sealed, i, d) }))}
                />
              </li>
            );
          })}
        </ol>
        <div className="row-wrap">
          <button type="button" className="btn btn-primary btn-sm" onClick={add} disabled={items.length >= MANIFEST_LIMITS.sealed}>
            ＋ おまけを追加
          </button>
        </div>
      </section>
    </div>
  );
}

interface SealedFormProps extends StudioTabProps {
  index: number;
  item: DraftSealed;
  issues: ReturnType<typeof issuesUnder>;
  onClose(): void;
  onDeleted(): void;
}

function SealedForm({ project, update, index, item, issues, onClose, onDeleted }: SealedFormProps): ReactNode {
  const ui = useUi();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [linkOpen, setLinkOpen] = useState(item.payload.storeLink !== undefined);
  useEffect(() => headingRef.current?.focus(), []);

  const set = (fn: (s: DraftSealed) => DraftSealed) =>
    update((p) => {
      const cur = p.sealed[index];
      return cur ? { ...p, sealed: replaceAt(p.sealed, index, fn(cur)) } : p;
    });
  const patch = (fields: Partial<DraftSealed>) => set((s) => ({ ...s, ...fields }));
  const setPayload = (fields: Partial<SealedPayload>) => set((s) => ({ ...s, payload: { ...s.payload, ...fields } }));
  const pathIssue = (suffix: string) =>
    issues.find((i) => i.severity === 'error' && i.path.startsWith(`sealed[${index}]${suffix}`))?.messageJa ?? null;

  const codeGoals = codeGoalsOf(project);
  const payload = item.payload;
  const storeCode = payload.storeLink?.storeCode ?? '';

  const toggleGoal = (goalId: string, on: boolean) =>
    set((s) => ({
      ...s,
      goals: on ? (s.goals.includes(goalId) ? s.goals : [...s.goals, goalId]) : s.goals.filter((g) => g !== goalId),
    }));

  const remove = async () => {
    const ok = await ui.confirm({
      title: `おまけ「${item.label || item.id}」を削除しますか？`,
      body: '本文なども消えます。元に戻せません。',
      okLabel: '削除',
      danger: true,
    });
    if (!ok) return;
    update((p) => ({ ...p, sealed: removeAt(p.sealed, index) }));
    onDeleted();
    ui.toast('おまけを削除しました');
  };

  const unknownGoals = item.goals.filter((g) => !codeGoals.some((c) => c.id === g));

  return (
    <div className="stack stu-tab stu-form">
      <div className="row stu-form-head">
        <button type="button" className="btn btn-sm btn-ghost stu-back" onClick={onClose}>
          <span aria-hidden="true">←</span> おまけの一覧
        </button>
      </div>
      <h2 className="stu-h2 stu-form-title" tabIndex={-1} ref={headingRef}>
        おまけ「{item.label || item.id}」の編集
      </h2>
      <IssueList issues={issues} />

      <section className="card-flat stack" aria-labelledby={`stu-x-basic-${index}`}>
        <h3 id={`stu-x-basic-${index}`} className="stu-h3">
          基本（公開）
        </h3>
        <TextField
          label="表示名"
          required
          visibility="public"
          value={item.label}
          maxLength={40}
          onChange={(v) => patch({ label: v })}
          error={item.label.trim() === '' ? '表示名を入力してください' : null}
          hint="開く前から見える名前です（例：あとがき）。"
        />
        <TextField
          label="ひとこと（任意）"
          visibility="public"
          value={item.teaser ?? ''}
          maxLength={120}
          onChange={(v) => patch({ teaser: v === '' ? undefined : v })}
          hint="開く条件の案内などに使えます（例：全てのエンディングで開きます）。"
        />
        <SelectField<SealedKind>
          label="種類"
          visibility="public"
          value={item.kind}
          options={SEALED_KINDS.map((k) => ({ value: k, label: `${SEALED_KIND_ICON[k]} ${SEALED_KIND_LABEL[k]}` }))}
          onChange={(v) => {
            if (v !== '') patch({ kind: v });
          }}
          hint="アイコンと開くときの演出が変わります。"
        />
        <IdField
          label="おまけID"
          value={item.id}
          validate={(next) => idError(next, item.id, project.sealed.filter((_, k) => k !== index).map((s) => s.id))}
          onCommit={(next) => patch({ id: next })}
        />
      </section>

      <section className="card-flat stack" aria-labelledby={`stu-x-cond-${index}`}>
        <div className="row">
          <h3 id={`stu-x-cond-${index}`} className="stu-h3">
            開く条件
          </h3>
          <VisibilityBadge kind="public" />
        </div>
        <ChoiceGroup<'allOf' | 'anyOf'>
          legend="条件"
          value={item.mode}
          onChange={(m) => patch({ mode: m })}
          options={[
            { value: 'allOf', label: 'すべて', hint: '選んだ合言葉がすべてそろうと開きます' },
            { value: 'anyOf', label: 'どれか', hint: '選んだ合言葉のどれか1つで開きます' },
          ]}
        />
        {codeGoals.length === 0 ? (
          <p className="field-error">合言葉つきの目標がありません。「目標」タブで作ってください。</p>
        ) : (
          <fieldset className="stu-checks">
            <legend className="stu-choice-legend">合言葉つきの目標（{item.goals.length}件を選択中）</legend>
            {codeGoals.map((g) => (
              <label key={g.id} className="stu-check">
                <input type="checkbox" checked={item.goals.includes(g.id)} onChange={(e) => toggleGoal(g.id, e.target.checked)} />
                <span className="stu-check-text">
                  <span>{g.label || g.id}</span>
                  <span className="small muted mono">{g.id}</span>
                </span>
              </label>
            ))}
          </fieldset>
        )}
        {unknownGoals.length > 0 ? (
          <div className="stack-sm">
            <p className="field-error">条件に、見つからない（または合言葉つきでない）目標が含まれています：{unknownGoals.join('、')}</p>
            <div className="row-wrap">
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => set((s) => ({ ...s, goals: s.goals.filter((g) => codeGoals.some((c) => c.id === g)) }))}
              >
                条件から外す
              </button>
            </div>
          </div>
        ) : pathIssue('.goals') ? (
          <p className="field-error">{pathIssue('.goals')}</p>
        ) : null}
      </section>

      <section className="card-flat stack" aria-labelledby={`stu-x-body-${index}`}>
        <div className="row">
          <h3 id={`stu-x-body-${index}`} className="stu-h3">
            中身
          </h3>
          <VisibilityBadge kind="secret" />
        </div>
        <p className="field-hint">条件の合言葉を入れるまで暗号化されます。文章だけが入れられます。</p>
        <TextField
          label="タイトル"
          required
          visibility="secret"
          value={payload.title}
          maxLength={60}
          onChange={(v) => setPayload({ title: v })}
          error={payload.title.trim() === '' ? 'タイトルを入力してください' : null}
        />
        <TextField
          label="本文"
          visibility="secret"
          multiline
          rows={8}
          value={payload.body}
          maxLength={20000}
          onChange={(v) => setPayload({ body: v })}
        />
        <TextField
          label="署名（任意）"
          visibility="secret"
          value={payload.from ?? ''}
          maxLength={40}
          onChange={(v) => setPayload({ from: v === '' ? undefined : v })}
          hint="手紙の最後に表示されます（例：司書ミナより）。"
        />
      </section>

      {item.kind === 'returnCode' || payload.returnCode ? (
        <section className="card-flat stack" aria-labelledby={`stu-x-rc-${index}`}>
          <div className="row">
            <h3 id={`stu-x-rc-${index}`} className="stu-h3">
              返し合言葉
            </h3>
            <VisibilityBadge kind="secret" />
          </div>
          <p className="field-hint">おまけを開いたプレイヤーに表示され、ゲームの中に入力してもらう言葉です。判定はゲーム側で行います。</p>
          {item.kind !== 'returnCode' ? (
            <p className="stu-field-warn">種類が「返し合言葉」ではないため、この欄は表示されません。種類を変えるか、欄を空にしてください。</p>
          ) : null}
          <TextField
            label="返し合言葉"
            required={item.kind === 'returnCode'}
            visibility="secret"
            value={payload.returnCode?.code ?? ''}
            maxLength={40}
            onChange={(v) => setPayload({ returnCode: nextReturnCode(payload.returnCode, { code: v }) })}
            error={pathIssue('.payload.returnCode') && (payload.returnCode?.code ?? '').trim() === '' ? pathIssue('.payload.returnCode') : null}
          />
          <TextField
            label="入力する場所の案内"
            required={item.kind === 'returnCode'}
            multiline
            rows={2}
            visibility="secret"
            value={payload.returnCode?.instruction ?? ''}
            maxLength={200}
            onChange={(v) => setPayload({ returnCode: nextReturnCode(payload.returnCode, { instruction: v }) })}
            hint="例：タイトル画面の「扉の合言葉」に入力してください"
          />
        </section>
      ) : null}

      <section className="card-flat stack" aria-labelledby={`stu-x-link-${index}`}>
        <h3 id={`stu-x-link-${index}`} className="stu-h3">
          作品ページへのリンク（任意）
        </h3>
        <label className="switch-row">
          <span>おまけの最後に、作品ページへのボタンを付ける</span>
          <input
            type="checkbox"
            checked={linkOpen}
            onChange={(e) => {
              setLinkOpen(e.target.checked);
              if (!e.target.checked) setPayload({ storeLink: undefined });
            }}
          />
        </label>
        {linkOpen ? (
          <>
            <p className="field-hint">
              次回作の案内などに使えます。プレイヤーの「おしのびモード」では、はじめはボタンが隠れています。開く前に確認も表示されます。
            </p>
            <TextField
              label="作品コード"
              visibility="secret"
              mono
              inputMode="latin"
              placeholder="RJ01234567"
              value={storeCode}
              maxLength={20}
              onChange={(v) => setPayload({ storeLink: nextStoreLink(payload.storeLink, { storeCode: v }) })}
              onBlur={() => {
                const parsed = parseStoreCode(storeCode);
                if (parsed && parsed.code !== storeCode) {
                  setPayload({ storeLink: nextStoreLink(payload.storeLink, { storeCode: parsed.code }) });
                }
              }}
              error={storeCode !== '' && !parseStoreCode(storeCode) ? STORE_CODE_INVALID_JA : null}
            />
            <TextField
              label="ボタンの説明"
              visibility="secret"
              value={payload.storeLink?.caption ?? ''}
              maxLength={60}
              onChange={(v) => setPayload({ storeLink: nextStoreLink(payload.storeLink, { caption: v }) })}
              hint="例：次回作「〇〇」の作品ページ"
              error={storeCode !== '' && (payload.storeLink?.caption ?? '').trim() === '' ? '説明を入力してください' : null}
            />
          </>
        ) : null}
      </section>

      <div className="row-wrap stu-form-foot">
        <button type="button" className="btn btn-sm" onClick={onClose}>
          <span aria-hidden="true">←</span> おまけの一覧
        </button>
        <span className="spacer" />
        <button type="button" className="btn btn-sm btn-danger" onClick={() => void remove()}>
          このおまけを削除
        </button>
      </div>
    </div>
  );
}
