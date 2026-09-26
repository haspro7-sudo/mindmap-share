// 「しおりファイルを読み込む」 for an existing work (作品ページの「しおりファイルがありません」, 作品設定):
// picks a shiori.json (file or pasted text), shows what it will do to THIS work (previewAttach) and attaches it
// (attachManifest), so the work's sessions, notes, resume info and status stay where they are. #/add is for adding
// a new work instead. Every manifest string is rendered as React text; the author is a claim, never verified.
import { useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { attachManifest, previewAttach } from '../../../app/library';
import type { AttachPreview } from '../../../app/library';
import { readClipboard, readFileAsText } from '../../../app/platform';
import { MAX_ISSUES_SHOWN, MAX_MANIFEST_BYTES } from '../../../core/constants';
import { utf8ByteLength } from '../../../core/manifest/validate';
import type { ManifestSource, ValidationIssue, WorkRecord } from '../../../core/types';
import { Sheet } from '../../components/Sheet';
import { useRepo, useSettings, useUi } from '../../context';
import { KIND_LABEL, displayTitle } from '../../format';
import { MSG_FILE_TOO_LARGE } from '../libraryShared';
import { useBackToClose } from './historyLayer';
import { errorMessageJa } from './workModel';

const MSG_PASTE_EMPTY = 'しおりファイルの内容を貼り付けてください';
const MSG_CLIPBOARD = 'クリップボードを読めませんでした。入力欄を長押しして貼り付けてください';

type Step =
  | { name: 'pick' }
  | { name: 'checking' }
  | { name: 'ready'; preview: AttachPreview; source: Extract<ManifestSource, 'file' | 'paste'> };

export interface AttachManifestSheetProps {
  work: WorkRecord;
  /** sheet title (e.g. 「更新を読み込む」 in 作品設定 for a work that already has the circle's file) */
  title?: string;
  onClose(): void;
}

export function AttachManifestSheet({ work, title = 'しおりファイルを読み込む', onClose }: AttachManifestSheetProps): ReactNode {
  const repo = useRepo();
  const ui = useUi();
  const { settings } = useSettings();
  const pasteId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>({ name: 'pick' });
  const [pasteText, setPasteText] = useState('');
  const [pickError, setPickError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const name = displayTitle(work, settings);
  useBackToClose(true, onClose);

  const check = async (text: string, source: 'file' | 'paste') => {
    setStep({ name: 'checking' });
    try {
      setStep({ name: 'ready', preview: await previewAttach(repo, work.id, text), source });
    } catch (e) {
      setPickError(errorMessageJa(e));
      setStep({ name: 'pick' });
    }
  };

  const openFile = async (file: File | undefined) => {
    setPickError(null);
    if (!file) return;
    if (file.size > MAX_MANIFEST_BYTES) {
      setPickError(MSG_FILE_TOO_LARGE);
      return;
    }
    try {
      await check(await readFileAsText(file), 'file');
    } catch (e) {
      setPickError(errorMessageJa(e));
    }
  };

  const submitPaste = () => {
    if (pasteText.trim() === '') {
      setPickError(MSG_PASTE_EMPTY);
      return;
    }
    if (pasteText.length > MAX_MANIFEST_BYTES || utf8ByteLength(pasteText) > MAX_MANIFEST_BYTES) {
      setPickError(MSG_FILE_TOO_LARGE);
      return;
    }
    setPickError(null);
    void check(pasteText, 'paste');
  };

  const pasteFromClipboard = async () => {
    const text = await readClipboard();
    if (text === null || text.trim() === '') {
      ui.toast(MSG_CLIPBOARD);
      return;
    }
    setPasteText(text);
    setPickError(null);
  };

  const commit = async (preview: Extract<AttachPreview, { kind: 'ready' }>, source: 'file' | 'paste') => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const res = await attachManifest(repo, work.id, preview.manifest, { source });
      const redeemed = res.pendingOutcomes.filter((o) => o.status === 'unlocked').length;
      const done = preview.mode === 'update' ? '更新を読み込みました' : 'しおりファイルを読み込みました';
      ui.toast(redeemed > 0 ? `${done}。保留中の合言葉を${redeemed}件使いました` : done, { tone: 'ok' });
      const envelopes = new Map<string, { workId: string; sealedId: string }>();
      for (const o of res.pendingOutcomes) {
        for (const sealedId of o.openedSealedIds) envelopes.set(sealedId, { workId: o.workId ?? work.id, sealedId });
      }
      for (const sealedId of res.openedSealedIds) envelopes.set(sealedId, { workId: work.id, sealedId });
      if (envelopes.size > 0) ui.queueEnvelopes([...envelopes.values()]);
      onClose();
    } catch (e) {
      ui.toast(errorMessageJa(e), { tone: 'danger' });
      busyRef.current = false;
      setBusy(false);
    }
  };

  const back = () => {
    setStep({ name: 'pick' });
    setPickError(null);
  };

  let body: ReactNode;
  let footer: ReactNode;
  if (step.name === 'pick' || step.name === 'checking') {
    const checking = step.name === 'checking';
    body = (
      <div className="stack">
        <p className="small">
          『{name}』に、サークルが配布している「shiori.json」を読み込みます。プレイ記録・前回の続き・メモはこの作品にそのまま残ります。
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="visually-hidden"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            e.currentTarget.value = '';
            void openFile(file);
          }}
        />
        <button
          type="button"
          className="btn btn-primary btn-block"
          disabled={checking}
          aria-busy={checking}
          onClick={() => fileRef.current?.click()}
        >
          ファイルを選ぶ
        </button>
        <div className="stack-sm">
          <div className="wk-attach-labelrow">
            <label htmlFor={pasteId} className="field-label">
              または、内容を貼り付ける
            </label>
            <button type="button" className="btn btn-sm" onClick={() => void pasteFromClipboard()}>
              貼り付け
            </button>
          </div>
          <textarea
            id={pasteId}
            className="textarea mono"
            rows={4}
            value={pasteText}
            placeholder={'{ "schema": "shiori/1", … }'}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            onChange={(e) => {
              setPasteText(e.target.value);
              if (pickError) setPickError(null);
            }}
          />
          <button type="button" className="btn btn-block" disabled={checking} onClick={submitPaste}>
            内容を確かめる
          </button>
        </div>
        {checking ? (
          <p className="muted small" role="status">
            しおりファイルを確かめています…
          </p>
        ) : null}
        {pickError ? (
          <p className="field-error" role="alert">
            {pickError}
          </p>
        ) : null}
      </div>
    );
    footer = (
      <button type="button" className="btn" onClick={onClose}>
        キャンセル
      </button>
    );
  } else {
    const { preview, source } = step;
    const reselect = (
      <button type="button" className="btn" onClick={back} disabled={busy}>
        選び直す
      </button>
    );
    if (preview.kind === 'invalid') {
      body = (
        <div className="stack" role="alert">
          <p>しおりファイルの内容に問題があります（{preview.errors.length}件）。作品に同梱されたファイルか、もう一度お確かめください。</p>
          <Issues issues={preview.errors} />
        </div>
      );
      footer = reselect;
    } else if (preview.blocked) {
      body = (
        <p role="alert">
          {preview.blocked.reason === 'otherWork'
            ? `このしおりファイルは、本棚の別の作品『${displayTitle(preview.blocked.other, settings)}』で使っています。その作品を開いて使ってください。`
            : 'この作品には、別の作品のサークルのしおりファイルが付いています。この作品のしおりファイルを選んでください。'}
        </p>
      );
      footer = reselect;
    } else if (preview.alreadyAttached) {
      body = <p>このしおりファイルは、この作品にもう読み込まれています。</p>;
      footer = (
        <>
          {reselect}
          <button type="button" className="btn btn-primary" onClick={onClose}>
            閉じる
          </button>
        </>
      );
    } else {
      const m = preview.manifest;
      body = (
        <div className="stack">
          <p className="banner" role="note">
            {preview.mode === 'update'
              ? `『${name}』の更新として読み込みます：追加${preview.diff.added.length}・削除${preview.diff.removed.length}`
              : preview.mode === 'replacePlayer'
                ? `『${name}』のかんたんしおりを、このしおりファイルに入れ替えます。同じ項目IDの記録は引き継ぎ、それ以外の記録は消さずに保管します。`
                : `『${name}』のチェックリストとして読み込みます。`}
          </p>
          {preview.mode === 'update' && preview.diff.removed.length > 0 ? (
            <p className="small muted">削除された項目の記録は消さずに保管します。</p>
          ) : null}
          <dl className="wk-attach-meta small">
            {m.work.circle ? (
              <div>
                <dt>サークル</dt>
                <dd>{m.work.circle}</dd>
              </div>
            ) : null}
            <div>
              <dt>種類</dt>
              <dd>{KIND_LABEL[m.work.kind]}</dd>
            </div>
            <div>
              <dt>バージョン</dt>
              <dd className="mono">{m.work.version}</dd>
            </div>
            <div>
              <dt>内容</dt>
              <dd>
                目標 {preview.stats.goals}・合言葉 {preview.stats.codeGoals}・おまけ {preview.stats.sealed}
              </dd>
            </div>
            <div>
              <dt>作成者の申告</dt>
              <dd>
                {m.author.kind === 'creator' ? 'サークル' : 'プレイヤー'}
                {m.author.name ? `（${m.author.name}）` : ''}
              </dd>
            </div>
          </dl>
          <p className="small muted">しおり帳は作成者を確認していません。心当たりのないファイルは読み込まないでください。</p>
          {preview.warnings.length > 0 ? (
            <section className="banner banner-warn" aria-label={`注意（${preview.warnings.length}件）`}>
              <div className="stack-sm">
                <p className="small">注意（{preview.warnings.length}件）</p>
                <Issues issues={preview.warnings} />
              </div>
            </section>
          ) : null}
        </div>
      );
      footer = (
        <>
          {reselect}
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            aria-busy={busy}
            onClick={() => void commit(preview, source)}
          >
            読み込む
          </button>
        </>
      );
    }
  }

  return (
    <Sheet open title={title} onClose={onClose} footer={footer}>
      {body}
    </Sheet>
  );
}

function Issues({ issues }: { issues: readonly ValidationIssue[] }): ReactNode {
  const shown = issues.slice(0, MAX_ISSUES_SHOWN);
  const more = issues.length - shown.length;
  return (
    <>
      <ul className="wk-attach-issues small">
        {shown.map((issue, i) => (
          <li key={`${i}:${issue.path}:${issue.code}`}>
            {issue.path !== '' ? <code>{issue.path}</code> : null} {issue.messageJa}
          </li>
        ))}
      </ul>
      {more > 0 ? <p className="small muted">ほかに{more}件</p> : null}
    </>
  );
}
