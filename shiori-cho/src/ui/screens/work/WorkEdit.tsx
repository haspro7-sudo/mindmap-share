// 作品設定 #/w/<id>/edit (docs/SPEC.md §6, F2 AC2, F4, F6 AC4, F8 AC1): alias, real title (behind 「本当のタイトルを表示」
// in おしのびモード), emoji / color, status, kind, store code, spoiler tolerance, manifest info, update, export, delete.
import { useId, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import {
  COVER_EMOJI_MAX_CHARS,
  MSG_ALIAS_TOO_LONG,
  MSG_COVER_EMOJI_INVALID,
  MSG_TITLE_REQUIRED,
  MSG_TITLE_TOO_LONG,
  WORK_ALIAS_MAX,
  WORK_TITLE_MAX,
  defaultCoverEmoji,
  exportPlayerManifest,
  manifestStats,
} from '../../../app/library';
import { download } from '../../../app/platform';
import { MANIFEST_FILE_NAME } from '../../../core/constants';
import { STORE_CODE_INVALID_JA, parseStoreCode } from '../../../core/storeCode';
import type {
  CoverColor,
  ManifestRecord,
  ManifestSource,
  SpoilerLevel,
  WorkKind,
  WorkRecord,
  WorkStatus,
} from '../../../core/types';
import { EmojiCover } from '../../components/EmojiCover';
import { EmptyState } from '../../components/EmptyState';
import { ExternalLinkButton } from '../../components/ExternalLinkButton';
import { useRepo, useRepoQuery, useSettings, useUi } from '../../context';
import {
  COVER_COLORS,
  COVER_EMOJIS,
  KIND_LABEL,
  KIND_ORDER,
  SPOILER_LABEL,
  STATUS_LABEL,
  STATUS_ORDER,
  coverColorVar,
  displayTitle,
} from '../../format';
import { hrefFor, navigate } from '../../router';
import { charCount, errorMessageJa, patchWork } from './workModel';
import './WorkEdit.css';

const COLOR_LABEL: Record<CoverColor, string> = {
  paper: '生成り',
  sky: '空',
  leaf: '若葉',
  sun: 'ひだまり',
  rose: '桜',
  plum: '藤',
  slate: '灰',
};

const SOURCE_LABEL: Record<ManifestSource, string> = {
  bundled: 'サンプル',
  file: 'ファイル',
  paste: '貼り付け',
  quick: 'かんたんしおり',
  'player-edit': 'かんたんしおり（編集済み）',
};

const SPOILER_LEVELS: readonly SpoilerLevel[] = [0, 1, 2, 3];

export function WorkEditScreen({ workId }: { workId: string }): ReactNode {
  const q = useRepoQuery(
    async (repo) => {
      const work = await repo.getWork(workId);
      if (!work) return null;
      const record = work.manifestKey ? await repo.getManifest(work.manifestKey) : undefined;
      return { work, record };
    },
    [workId],
  );

  if (q.data === undefined) {
    return (
      <main className="screen we">
        <p className="muted center" role="status">
          読み込み中…
        </p>
      </main>
    );
  }
  if (q.data === null) {
    return (
      <main className="screen we">
        <EmptyState
          icon="📭"
          title="作品が見つかりません"
          body="すでに削除されたかもしれません。"
          action={
            <a className="btn" href={hrefFor({ name: 'home' })}>
              本棚へ
            </a>
          }
        />
      </main>
    );
  }
  return <WorkEditForm key={q.data.work.id} work={q.data.work} record={q.data.record} />;
}

interface Draft {
  alias: string;
  title: string;
  coverEmoji: string;
  coverColor: CoverColor;
  status: WorkStatus;
  kind: WorkKind;
  storeCode: string;
  spoilerTolerance: SpoilerLevel;
}

type DraftErrors = Partial<Record<'alias' | 'title' | 'storeCode' | 'coverEmoji', string>>;

function draftOf(w: WorkRecord): Draft {
  return {
    alias: w.alias,
    title: w.title,
    coverEmoji: w.coverEmoji,
    coverColor: w.coverColor,
    status: w.status,
    kind: w.kind,
    storeCode: w.storeCode ?? '',
    spoilerTolerance: w.spoilerTolerance,
  };
}

function sameDraft(a: Draft, b: Draft): boolean {
  return (Object.keys(a) as (keyof Draft)[]).every((k) => a[k] === b[k]);
}

function WorkEditForm({ work, record }: { work: WorkRecord; record?: ManifestRecord }): ReactNode {
  const repo = useRepo();
  const ui = useUi();
  const { settings } = useSettings();
  const ids = {
    heading: useId(),
    alias: useId(),
    aliasHint: useId(),
    title: useId(),
    emoji: useId(),
    status: useId(),
    kind: useId(),
    store: useId(),
    storeHint: useId(),
    spoilerHint: useId(),
  };
  const [baseline, setBaseline] = useState(() => draftOf(work));
  const [draft, setDraft] = useState(() => draftOf(work));
  const [errors, setErrors] = useState<DraftErrors>({});
  const [titleShown, setTitleShown] = useState(false);
  const [customEmoji, setCustomEmoji] = useState(() => (COVER_EMOJIS.includes(work.coverEmoji) ? '' : work.coverEmoji));
  const [busy, setBusy] = useState(false);
  const dirty = !sameDraft(draft, baseline);
  const aliasOnly = settings.discreet.aliasOnly;
  const showTitle = !aliasOnly || titleShown;
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const validate = (d: Draft): { errors: DraftErrors; storeCode?: string; emoji: string } => {
    const out: DraftErrors = {};
    const alias = d.alias.trim();
    if (alias === '') out.alias = '表示名を入力してください';
    else if (charCount(alias) > WORK_ALIAS_MAX) out.alias = MSG_ALIAS_TOO_LONG;
    const title = d.title.trim();
    if (title === '') out.title = MSG_TITLE_REQUIRED;
    else if (title.length > WORK_TITLE_MAX) out.title = MSG_TITLE_TOO_LONG;
    let storeCode: string | undefined;
    if (d.storeCode.trim() !== '') {
      const parsed = parseStoreCode(d.storeCode);
      if (parsed) storeCode = parsed.code;
      else out.storeCode = STORE_CODE_INVALID_JA;
    }
    const emoji = d.coverEmoji.trim();
    if (charCount(emoji) > COVER_EMOJI_MAX_CHARS) out.coverEmoji = MSG_COVER_EMOJI_INVALID;
    const result: { errors: DraftErrors; storeCode?: string; emoji: string } = {
      errors: out,
      emoji: emoji === '' ? defaultCoverEmoji(d.kind) : emoji,
    };
    if (storeCode !== undefined) result.storeCode = storeCode;
    return result;
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const v = validate(draft);
    setErrors(v.errors);
    if (Object.keys(v.errors).length > 0) {
      if (v.errors.title && !showTitle) setTitleShown(true);
      ui.toast('入力内容を確かめてください', { tone: 'danger' });
      return;
    }
    setBusy(true);
    try {
      const saved: Draft = {
        ...draft,
        alias: draft.alias.trim(),
        title: draft.title.trim(),
        coverEmoji: v.emoji,
        storeCode: v.storeCode ?? '',
      };
      await patchWork(repo, work.id, (w) => {
        const next: WorkRecord = {
          ...w,
          alias: saved.alias,
          title: saved.title,
          coverEmoji: saved.coverEmoji,
          coverColor: saved.coverColor,
          status: saved.status,
          kind: saved.kind,
          spoilerTolerance: saved.spoilerTolerance,
        };
        if (v.storeCode !== undefined) next.storeCode = v.storeCode;
        else delete next.storeCode;
        return next;
      });
      setDraft(saved);
      setBaseline(saved);
      ui.toast('保存しました', { tone: 'ok' });
    } catch (err) {
      ui.toast(errorMessageJa(err), { tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  const exportManifest = async () => {
    try {
      const text = await exportPlayerManifest(repo, work.id);
      download(MANIFEST_FILE_NAME, text, 'application/json');
      ui.toast('しおりファイルを書き出しました', { tone: 'ok' });
    } catch (err) {
      ui.toast(errorMessageJa(err), { tone: 'danger' });
    }
  };

  const remove = async () => {
    const first = await ui.confirm({
      title: 'この作品を削除しますか？',
      body: '進捗・合言葉・おまけ・プレイ記録・メモも、この端末からすべて消えます。',
      okLabel: '削除へ進む',
      danger: true,
    });
    if (!first) return;
    const second = await ui.confirm({
      title: '本当に削除しますか？',
      body: 'この操作は元に戻せません。必要ならバックアップを取ってから削除してください。',
      okLabel: '削除する',
      danger: true,
    });
    if (!second) return;
    try {
      await repo.deleteWork(work.id);
      ui.toast('作品を削除しました');
      navigate({ name: 'home' }, { replace: true });
    } catch (err) {
      ui.toast(errorMessageJa(err), { tone: 'danger' });
    }
  };

  const parsedStore = parseStoreCode(draft.storeCode);
  const m = record?.manifest;
  const stats = m ? manifestStats(m) : undefined;

  return (
    <main className="screen we" aria-labelledby={ids.heading}>
      <div className="we-head">
        <EmojiCover emoji={draft.coverEmoji.trim() || defaultCoverEmoji(draft.kind)} color={draft.coverColor} size={48} />
        <div className="we-head-text">
          <h1 id={ids.heading} className="we-title">
            作品設定
          </h1>
          <p className="small muted we-sub">{displayTitle(work, settings)}</p>
        </div>
      </div>

      <form className="stack we-form" onSubmit={(e) => void save(e)} noValidate>
        <section className="card stack" aria-label="名前">
          <div className="field">
            <label htmlFor={ids.alias}>表示名</label>
            <input
              id={ids.alias}
              className="input"
              type="text"
              value={draft.alias}
              maxLength={WORK_ALIAS_MAX}
              aria-describedby={ids.aliasHint}
              aria-invalid={errors.alias ? true : undefined}
              onChange={(e) => set({ alias: e.target.value })}
            />
            <p id={ids.aliasHint} className={errors.alias ? 'field-error' : 'field-hint'}>
              {errors.alias ?? 'おしのびモードでは、本棚や作品ページにこの名前だけが表示されます'}
            </p>
          </div>

          <div className="field">
            {showTitle ? (
              <>
                <label htmlFor={ids.title}>本当のタイトル</label>
                <input
                  id={ids.title}
                  className="input"
                  type="text"
                  value={draft.title}
                  maxLength={WORK_TITLE_MAX}
                  aria-invalid={errors.title ? true : undefined}
                  onChange={(e) => set({ title: e.target.value })}
                />
                {errors.title ? (
                  <p className="field-error">{errors.title}</p>
                ) : aliasOnly ? (
                  <p className="field-hint">この画面を離れると、また隠れます</p>
                ) : null}
              </>
            ) : (
              <>
                <span className="field-label">本当のタイトル</span>
                <div className="we-hidden-title">
                  <span className="muted small">おしのびモードのため隠しています</span>
                  <button type="button" className="btn btn-sm" onClick={() => setTitleShown(true)}>
                    本当のタイトルを表示
                  </button>
                </div>
              </>
            )}
          </div>
        </section>

        <section className="card stack" aria-label="見た目">
          <fieldset className="we-fieldset">
            <legend className="field-label">アイコン</legend>
            <div className="we-emojis">
              {COVER_EMOJIS.map((em) => (
                <label key={em} className={`we-emoji${draft.coverEmoji === em ? ' is-selected' : ''}`}>
                  <input
                    type="radio"
                    name={ids.emoji}
                    className="we-radio"
                    value={em}
                    checked={draft.coverEmoji === em}
                    onChange={() => {
                      setCustomEmoji('');
                      set({ coverEmoji: em });
                    }}
                  />
                  <span aria-hidden="true">{em}</span>
                  <span className="visually-hidden">絵文字 {em}</span>
                </label>
              ))}
            </div>
            <label className="we-custom-emoji">
              <span className="small">ほかの絵文字</span>
              <input
                className="input"
                type="text"
                value={customEmoji}
                placeholder="例：🎮"
                aria-invalid={errors.coverEmoji ? true : undefined}
                onChange={(e) => {
                  const v = e.target.value;
                  setCustomEmoji(v);
                  set({ coverEmoji: v.trim() === '' ? baseline.coverEmoji : v });
                }}
              />
            </label>
            {errors.coverEmoji ? <p className="field-error">{errors.coverEmoji}</p> : null}
          </fieldset>

          <fieldset className="we-fieldset">
            <legend className="field-label">色</legend>
            <div className="we-colors">
              {COVER_COLORS.map((c) => (
                <label key={c} className={`we-color${draft.coverColor === c ? ' is-selected' : ''}`}>
                  <input
                    type="radio"
                    name={`${ids.emoji}-color`}
                    className="we-radio"
                    value={c}
                    checked={draft.coverColor === c}
                    onChange={() => set({ coverColor: c })}
                  />
                  <span className="we-swatch" style={{ background: coverColorVar(c) }} aria-hidden="true" />
                  <span className="we-color-name">{COLOR_LABEL[c]}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </section>

        <section className="card stack" aria-label="状態と種類">
          <div className="we-two">
            <div className="field">
              <label htmlFor={ids.status}>状態</label>
              <select
                id={ids.status}
                className="select"
                value={draft.status}
                onChange={(e) => set({ status: e.target.value as WorkStatus })}
              >
                {STATUS_ORDER.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor={ids.kind}>種類</label>
              <select id={ids.kind} className="select" value={draft.kind} onChange={(e) => set({ kind: e.target.value as WorkKind })}>
                {KIND_ORDER.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="field">
            <label htmlFor={ids.store}>作品コード（任意）</label>
            <input
              id={ids.store}
              className="input mono"
              type="text"
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              value={draft.storeCode}
              placeholder="例：RJ01234567"
              aria-describedby={ids.storeHint}
              aria-invalid={errors.storeCode ? true : undefined}
              onChange={(e) => set({ storeCode: e.target.value })}
            />
            <p id={ids.storeHint} className={errors.storeCode ? 'field-error' : 'field-hint'}>
              {errors.storeCode ??
                (settings.discreet.hideStoreLinks
                  ? 'おしのびモードのため、ストアへのリンクは隠しています（設定で変えられます）'
                  : 'RJ・VJ・BJ と数字6桁または8桁')}
            </p>
            {parsedStore ? (
              <div>
                <ExternalLinkButton storeCode={parsedStore.code} label="作品ページを開く" />
              </div>
            ) : null}
          </div>
        </section>

        <section className="card" aria-label="ネタバレの許容度">
          <fieldset className="we-fieldset" aria-describedby={ids.spoilerHint}>
            <legend className="field-label">ネタバレの許容度</legend>
            <p id={ids.spoilerHint} className="small muted we-explain">
              作者が付けた「ネタバレ度」がこの値より大きい項目名・説明・注意書きは、ぼかして表示します。ぼかした部分はタップすると、その画面を見ている間だけ表示されます。
            </p>
            <div className="we-levels">
              {SPOILER_LEVELS.map((lv) => (
                <label key={lv} className={`we-level${draft.spoilerTolerance === lv ? ' is-selected' : ''}`}>
                  <input
                    type="radio"
                    name={`${ids.emoji}-spoiler`}
                    value={lv}
                    checked={draft.spoilerTolerance === lv}
                    onChange={() => set({ spoilerTolerance: lv })}
                  />
                  <span>{SPOILER_LABEL[lv]}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </section>

        <div className="we-savebar">
          <button type="submit" className="btn btn-primary btn-block" disabled={busy || !dirty}>
            {dirty ? '変更を保存する' : '保存済み'}
          </button>
        </div>
      </form>

      <section className="card stack we-manifest" aria-label="しおりファイル">
        <h2 className="we-section-title">しおりファイル</h2>
        {m && record ? (
          <>
            <dl className="we-info">
              <div>
                <dt>バージョン</dt>
                <dd className="mono">{m.work.version}</dd>
              </div>
              <div>
                <dt>作成者</dt>
                <dd>
                  作成者の申告：{m.author.kind === 'creator' ? 'サークル' : 'プレイヤー'}
                  {m.author.name ? `（${m.author.name}）` : ''}
                </dd>
              </div>
              <div>
                <dt>読み込み元</dt>
                <dd>{SOURCE_LABEL[record.source]}</dd>
              </div>
              {stats ? (
                <div>
                  <dt>内容</dt>
                  <dd>
                    目標 {stats.goals}・合言葉 {stats.codeGoals}・おまけ {stats.sealed}
                  </dd>
                </div>
              ) : null}
            </dl>
            <p className="small muted">作成者の申告は、しおり帳が確認したものではありません。</p>
            {m.changelog.length > 0 ? (
              <details className="we-changelog">
                <summary>更新履歴（{m.changelog.length}件）</summary>
                <ul>
                  {m.changelog.map((c, i) => (
                    <li key={`${c.version}-${i}`}>
                      <p className="we-changelog-head">
                        <span className="mono">{c.version}</span>
                        <span className="muted small">{c.date}</span>
                      </p>
                      {c.notes ? <p className="pre small">{c.notes}</p> : null}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            <div className="row-wrap">
              <a className="btn" href={hrefFor({ name: 'add' })}>
                更新を読み込む
              </a>
              {m.author.kind === 'player' ? (
                <button type="button" className="btn" onClick={() => void exportManifest()}>
                  しおりファイルとして書き出す
                </button>
              ) : null}
            </div>
          </>
        ) : (
          <>
            <p className="small">この作品にはしおりファイルがありません（記録だけ）。</p>
            <div>
              <a className="btn" href={hrefFor({ name: 'add' })}>
                しおりファイルを読み込む
              </a>
            </div>
          </>
        )}
      </section>

      <section className="card stack we-danger" aria-label="作品の削除">
        <h2 className="we-section-title">作品の削除</h2>
        <p className="small">進捗やプレイ記録を含めて、この作品をこの端末から削除します。</p>
        <div>
          <button type="button" className="btn btn-danger" onClick={() => void remove()}>
            この作品を削除
          </button>
        </div>
      </section>
    </main>
  );
}
