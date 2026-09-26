// 工房 › 作品 tab (docs/SPEC.md F16, §6): work fields, app URL, advanced KDF iterations and the changelog.
import { useId, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { lintStudioProject, newStudioWorkId } from '../../../app/studio';
import { KDF_ITERATIONS_DEFAULT, KDF_ITERATIONS_MAX, KDF_ITERATIONS_MIN, KDF_ITERATIONS_WARN_BELOW } from '../../../core/constants';
import { isAllowedAppUrl, isLocalAppUrl } from '../../../core/manifest/lint';
import { MANIFEST_LIMITS, VERSION_RE, WORK_ID_RE } from '../../../core/manifest/schema';
import { STORE_CODE_INVALID_JA, parseStoreCode } from '../../../core/storeCode';
import type { ChangelogEntry, Engine, ManifestWork, WorkKind } from '../../../core/types';
import { useUi } from '../../context';
import { KIND_LABEL, KIND_ORDER } from '../../format';
import { IdField, ItemTools, SelectField, TextField } from './fields';
import {
  ENGINE_LABEL,
  ENGINE_ORDER,
  defaultAppUrl,
  formatNumber,
  moveItem,
  optionalText,
  removeAt,
  replaceAt,
  todayYmd,
} from './model';
import type { StudioTabProps } from './model';

const WORK_ID_HELP = '半角の英小文字・数字・「-」で4〜40文字（先頭は英小文字か数字）。中身と関係のない文字列がおすすめです';
const MSG_WORK_ID_INVALID = `作品IDは${WORK_ID_HELP.split('。')[0]}にしてください`;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const MSG_RELEASED_WORK_ID = '発売済みの作品では作品IDを変えないでください';

export function WorkTab({ project, update }: StudioTabProps): ReactNode {
  const ui = useUi();
  const w = project.work;
  const setWork = (patch: Partial<ManifestWork>) => update((p) => ({ ...p, work: { ...p.work, ...patch } }));
  const issues = useMemo(() => lintStudioProject(project), [project]);
  const issueAt = (path: string) => issues.find((i) => i.severity === 'error' && i.path === path)?.messageJa ?? null;

  const storeCodeError = w.storeCode && w.storeCode.trim() !== '' && !parseStoreCode(w.storeCode) ? STORE_CODE_INVALID_JA : null;
  const released = project.lastExportedAt !== undefined;

  /** Every change of the work id (typed or regenerated) asks first once the work has been exported. */
  const confirmWorkIdChange = async (): Promise<boolean> => {
    if (!released) return true;
    return ui.confirm({
      title: MSG_RELEASED_WORK_ID,
      body: '作品IDが変わると、プレイヤーの端末では別の作品として扱われ、これまでの記録やおまけが引き継がれません。それでも変えますか？',
      okLabel: '変える',
      danger: true,
    });
  };

  const regenerateWorkId = async () => {
    if (!(await confirmWorkIdChange())) return;
    // A new work also gets a new salt (made at the next 点検): every tag changes with the work id anyway.
    update((p) => {
      const { kdfSalt: _salt, ...rest } = p;
      return { ...rest, work: { ...p.work, id: newStudioWorkId() } };
    });
    ui.toast('作品IDを作り直しました');
  };

  return (
    <div className="stack stu-tab">
      <section className="card-flat stack" aria-labelledby="stu-work-basic">
        <h2 id="stu-work-basic" className="stu-h2">
          作品の情報
        </h2>
        <p className="field-hint">ここに入力した内容は、しおりファイルに書かれて公開されます。</p>
        <TextField
          label="作品タイトル"
          required
          visibility="public"
          value={w.title}
          maxLength={100}
          onChange={(v) => setWork({ title: v })}
          error={w.title.trim() === '' ? 'タイトルを入力してください' : null}
        />
        <TextField
          label="表示名（おしのび用）"
          visibility="public"
          value={w.safeTitle ?? ''}
          maxLength={40}
          onChange={(v) => setWork({ safeTitle: optionalText(v) })}
          hint="プレイヤーの本棚で、タイトルの代わりに最初から表示される名前です（例：サンプルA）。人前で見られても困らない名前にしてください。"
        />
        <TextField
          label="サークル名"
          visibility="public"
          value={w.circle ?? ''}
          maxLength={60}
          onChange={(v) => setWork({ circle: optionalText(v) })}
        />
        <TextField
          label="作成者名"
          visibility="public"
          value={project.authorName ?? ''}
          maxLength={60}
          onChange={(v) => update((p) => ({ ...p, authorName: optionalText(v) }))}
          hint="プレイヤーには「作成者の申告」として表示されます。"
        />
        <TextField
          label="作品コード（任意）"
          visibility="public"
          value={w.storeCode ?? ''}
          maxLength={20}
          mono
          inputMode="latin"
          placeholder="RJ01234567"
          onChange={(v) => setWork({ storeCode: optionalText(v) })}
          onBlur={() => {
            const parsed = w.storeCode ? parseStoreCode(w.storeCode) : null;
            if (parsed && parsed.code !== w.storeCode) setWork({ storeCode: parsed.code });
          }}
          error={storeCodeError}
          hint="RJ・VJ・BJ と6桁または8桁の数字です。まだ決まっていなければ空欄のままで大丈夫です。"
        />
        <div className="stu-grid-2">
          <SelectField<WorkKind>
            label="種類"
            value={w.kind}
            options={KIND_ORDER.map((k) => ({ value: k, label: KIND_LABEL[k] }))}
            onChange={(v) => {
              if (v !== '') setWork({ kind: v });
            }}
          />
          <SelectField<Engine>
            label="制作ツール"
            value={w.engine ?? ''}
            emptyLabel="指定しない"
            options={ENGINE_ORDER.map((e) => ({ value: e, label: ENGINE_LABEL[e] }))}
            onChange={(v) => setWork({ engine: v === '' ? undefined : v })}
          />
        </div>
        <TextField
          label="バージョン"
          required
          visibility="public"
          value={w.version}
          maxLength={20}
          mono
          inputMode="latin"
          onChange={(v) => setWork({ version: v })}
          error={VERSION_RE.test(w.version) ? null : 'バージョンは半角英数字と「.」「+」「-」で20文字までにしてください（例：1.0.0）'}
          hint="しおりファイルを更新するたびに上げてください（例：1.0.0 → 1.0.1）。"
        />
      </section>

      <section className="card-flat stack" aria-labelledby="stu-work-id">
        <h2 id="stu-work-id" className="stu-h2">
          作品IDとアプリのURL
        </h2>
        <IdField
          label="作品ID"
          value={w.id}
          validate={(next) => (WORK_ID_RE.test(next) ? null : MSG_WORK_ID_INVALID)}
          onCommit={async (next) => {
            if (!(await confirmWorkIdChange())) return false;
            setWork({ id: next });
            return true;
          }}
          issue={WORK_ID_RE.test(w.id) ? issueAt('work.id') : MSG_WORK_ID_INVALID}
          hint={
            <>
              {WORK_ID_HELP}。しおりファイルの更新を同じ作品として受け取るための目印なので、
              <strong>発売後は変えないでください</strong>。
            </>
          }
        />
        <div className="row-wrap">
          <button type="button" className="btn btn-sm" onClick={() => void regenerateWorkId()}>
            作品IDを作り直す
          </button>
        </div>
        <TextField
          label="アプリのURL"
          type="url"
          inputMode="url"
          mono
          value={project.appUrl}
          maxLength={2000}
          onChange={(v) => update((p) => ({ ...p, appUrl: v }))}
          hint="QRコードの読み取り先と、はじめに.txt に使われます。"
          warning={
            project.appUrl.trim() === ''
              ? 'URLが空です。QRコードが使えません'
              : !isAllowedAppUrl(project.appUrl)
                ? 'https:// で始まるURLにしてください（試験用の http://localhost は使えます）'
                : isLocalAppUrl(project.appUrl)
                  ? '試験用のURLです。配布するキットには、公開しているアプリのURLを設定してください'
                  : null
          }
        />
        <div className="row-wrap">
          <button
            type="button"
            className="btn btn-sm"
            disabled={project.appUrl === defaultAppUrl()}
            onClick={() => update((p) => ({ ...p, appUrl: defaultAppUrl() }))}
          >
            このアプリのURLにする
          </button>
        </div>
      </section>

      <details className="card-flat stu-adv">
        <summary className="stu-adv-summary">詳細設定（合言葉の鍵）</summary>
        <div className="stack stu-adv-body">
          <IterationsField value={project.kdfIterations} onChange={(n) => update((p) => ({ ...p, kdfIterations: n }))} />
          <p className="small muted">
            鍵のソルト：
            {project.kdfSalt ? '作成済み（点検や書き出しのたびに同じものを使います）' : 'まだありません（最初の点検で作られます）'}
          </p>
          {issueAt('kdfSalt') ? <p className="field-error">{issueAt('kdfSalt')}</p> : null}
        </div>
      </details>

      <ChangelogSection project={project} update={update} />
    </div>
  );
}

function IterationsField({ value, onChange }: { value: number; onChange(n: number): void }): ReactNode {
  const id = useId();
  const [text, setText] = useState(String(value));
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setShown(value);
    setText(String(value));
  }
  const n = Number(text);
  const valid = /^\d+$/.test(text) && n >= KDF_ITERATIONS_MIN && n <= KDF_ITERATIONS_MAX;
  const low = valid && n < KDF_ITERATIONS_WARN_BELOW;
  return (
    <div className="field stu-field">
      <label htmlFor={id}>反復回数（PBKDF2）</label>
      <input
        id={id}
        className="input mono"
        type="text"
        inputMode="numeric"
        value={text}
        aria-invalid={valid ? undefined : 'true'}
        aria-describedby={`${id}-hint`}
        onChange={(e) => {
          const v = e.target.value.replace(/[^\d]/g, '').slice(0, 7);
          setText(v);
          // Only values the project file schema accepts are saved (1..max); the lint enforces the real minimum.
          const next = Number(v);
          if (/^\d+$/.test(v) && next >= 1 && next <= KDF_ITERATIONS_MAX) onChange(next);
        }}
      />
      <div id={`${id}-hint`}>
        <p className="field-hint">
          合言葉から鍵を作るときの計算の回数です。ふつうは{formatNumber(KDF_ITERATIONS_DEFAULT)}のままにしてください。
          減らすと総当たりに弱くなり、増やすとプレイヤーの端末で合言葉の確認に時間がかかります。発売後に変えると、プレイヤーの端末で鍵の計算がやり直しになります。
        </p>
        {!valid ? (
          <p className="field-error">
            {formatNumber(KDF_ITERATIONS_MIN)}〜{formatNumber(KDF_ITERATIONS_MAX)}の整数にしてください
          </p>
        ) : low ? (
          <p className="stu-field-warn">{formatNumber(KDF_ITERATIONS_WARN_BELOW)}未満は総当たりに弱くなります（試験用だけにしてください）</p>
        ) : null}
      </div>
    </div>
  );
}

function ChangelogSection({ project, update }: StudioTabProps): ReactNode {
  const entries = project.changelog;
  const setEntries = (fn: (list: ChangelogEntry[]) => ChangelogEntry[]) =>
    update((p) => ({ ...p, changelog: fn(p.changelog) }));
  const ui = useUi();

  return (
    <section className="card-flat stack" aria-labelledby="stu-changelog">
      <div className="row">
        <h2 id="stu-changelog" className="stu-h2">
          更新履歴
        </h2>
        <span className="badge badge-warn stu-vis">公開</span>
      </div>
      <p className="field-hint">プレイヤーが更新を読み込むときの参考になります（任意）。</p>
      {entries.length === 0 ? <p className="small muted">まだありません。</p> : null}
      <ol className="stu-items">
        {entries.map((e, i) => {
          const name = `更新履歴「${e.version || i + 1}」`;
          return (
            <li key={i} className="stu-item">
              <div className="stu-grid-2">
                <TextField
                  label="バージョン"
                  value={e.version}
                  maxLength={20}
                  mono
                  inputMode="latin"
                  onChange={(v) => setEntries((list) => replaceAt(list, i, { ...e, version: v }))}
                  error={VERSION_RE.test(e.version) ? null : '例：1.0.1'}
                />
                <TextField
                  label="日付"
                  type="date"
                  value={e.date}
                  onChange={(v) => setEntries((list) => replaceAt(list, i, { ...e, date: v }))}
                  error={DATE_RE.test(e.date) ? null : '日付を選んでください'}
                />
              </div>
              <TextField
                label="内容"
                multiline
                rows={2}
                value={e.notes}
                maxLength={500}
                onChange={(v) => setEntries((list) => replaceAt(list, i, { ...e, notes: v }))}
              />
              <ItemTools
                name={name}
                index={i}
                count={entries.length}
                onMove={(d) => setEntries((list) => moveItem(list, i, d))}
                onDelete={async () => {
                  const ok = await ui.confirm({ title: `${name}を削除しますか？`, okLabel: '削除', danger: true });
                  if (ok) setEntries((list) => removeAt(list, i));
                }}
              />
            </li>
          );
        })}
      </ol>
      <div className="row-wrap">
        <button
          type="button"
          className="btn btn-sm"
          disabled={entries.length >= MANIFEST_LIMITS.changelog}
          onClick={() =>
            setEntries((list) => [{ version: project.work.version, date: todayYmd(), notes: '' }, ...list])
          }
        >
          ＋ 更新履歴を追加
        </button>
      </div>
    </section>
  );
}
