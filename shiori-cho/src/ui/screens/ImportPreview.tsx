// しおりファイルの確認 (docs/SPEC.md F5 AC2–AC5): previewImport → the user confirms → commitImport.
// Every manifest string is rendered as React text. The author is a claim, never shown as verified.
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { commitImport, defaultCoverEmoji, previewImport } from '../../app/library';
import { nextAlias } from '../../core/alias';
import { MAX_ISSUES_SHOWN } from '../../core/constants';
import type { ImportPreview as Preview, ShioriManifestV1, UnlockOutcome, ValidationIssue } from '../../core/types';
import { EmojiCover } from '../components/EmojiCover';
import { useRepo, useSettings, useUi } from '../context';
import { KIND_LABEL, displayTitle } from '../format';
import { navigate } from '../router';
import { FocusHeading } from './AddWorkFields';
import { errorMessageJa } from './libraryShared';
import { leaveLayersThen } from './work/historyLayer';
import './ImportPreview.css';

export interface ImportPreviewProps {
  /** the shiori.json text (already size-checked by the caller; previewImport checks again) */
  text: string;
  source: 'file' | 'paste';
  /** 「やめる」 / 「戻る」 */
  onCancel(): void;
  /** after a successful import; default: open the work (replacing #/add in the history) */
  onImported?(workId: string): void;
}

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; preview: Preview; upcomingAlias: string };

const LOADING: State = { status: 'loading' };

function openWork(workId: string): void {
  // #/add's sub-view is a history layer: leave it first so the replace takes #/add's own entry.
  leaveLayersThen(() => navigate({ name: 'work', id: workId, tab: 'progress' }, { replace: true }));
}

const AUTHOR_KIND_LABEL: Record<ShioriManifestV1['author']['kind'], string> = {
  creator: 'サークル',
  player: 'プレイヤー',
};

export function ImportPreview({ text, source, onCancel, onImported }: ImportPreviewProps): ReactNode {
  const repo = useRepo();
  /** the result for `text` (a result for an older text reads as loading) */
  const [result, setResult] = useState<{ text: string; state: State } | null>(null);
  const state = result && result.text === text ? result.state : LOADING;

  useEffect(() => {
    let alive = true;
    Promise.all([previewImport(repo, text), repo.listWorks()]).then(
      ([preview, works]) => {
        if (!alive) return;
        const upcomingAlias =
          preview.kind === 'invalid' ? '' : (preview.manifest.work.safeTitle ?? nextAlias(works.map((w) => w.alias)));
        setResult({ text, state: { status: 'ready', preview, upcomingAlias } });
      },
      (e: unknown) => {
        if (alive) setResult({ text, state: { status: 'error', message: errorMessageJa(e) } });
      },
    );
    return () => {
      alive = false;
    };
  }, [repo, text]);

  if (state.status === 'loading') {
    return (
      <div className="ip">
        <p className="muted" role="status">
          しおりファイルを確かめています…
        </p>
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="ip stack">
        <FocusHeading>読み込めませんでした</FocusHeading>
        <p role="alert">{state.message}</p>
        <div className="ip-actions">
          <button type="button" className="btn" onClick={onCancel}>
            戻る
          </button>
        </div>
      </div>
    );
  }

  const { preview, upcomingAlias } = state;
  if (preview.kind === 'invalid') return <InvalidView errors={preview.errors} onCancel={onCancel} />;
  return (
    <ValidView
      preview={preview}
      upcomingAlias={upcomingAlias}
      source={source}
      onCancel={onCancel}
      onImported={onImported ?? openWork}
    />
  );
}

// ───────────────────────── invalid ─────────────────────────

function IssueList({ issues, className }: { issues: readonly ValidationIssue[]; className?: string }): ReactNode {
  const shown = issues.slice(0, MAX_ISSUES_SHOWN);
  const more = issues.length - shown.length;
  return (
    <>
      <ul className={`ip-issues${className ? ` ${className}` : ''}`}>
        {shown.map((issue, i) => (
          <li key={`${i}:${issue.path}:${issue.code}`} className="ip-issue">
            {issue.path !== '' ? <code className="ip-issue-path">{issue.path}</code> : null}
            <span className="ip-issue-msg">{issue.messageJa}</span>
          </li>
        ))}
      </ul>
      {more > 0 ? <p className="ip-more small muted">ほかに{more}件</p> : null}
    </>
  );
}

function InvalidView({ errors, onCancel }: { errors: readonly ValidationIssue[]; onCancel(): void }): ReactNode {
  return (
    <div className="ip stack">
      <FocusHeading>読み込めませんでした</FocusHeading>
      <p className="ip-lead">
        しおりファイルの内容に問題があります（{errors.length}件）。作品に同梱されたファイルか、もう一度お確かめください。
      </p>
      <section className="card-flat ip-issues-card" aria-label="問題の一覧">
        <IssueList issues={errors} />
      </section>
      <div className="ip-actions">
        <button type="button" className="btn btn-primary" onClick={onCancel}>
          戻る
        </button>
      </div>
    </div>
  );
}

// ───────────────────────── new / update ─────────────────────────

function ValidView({
  preview,
  upcomingAlias,
  source,
  onCancel,
  onImported,
}: {
  preview: Exclude<Preview, { kind: 'invalid' }>;
  upcomingAlias: string;
  source: 'file' | 'paste';
  onCancel(): void;
  onImported(workId: string): void;
}): ReactNode {
  const repo = useRepo();
  const ui = useUi();
  const { settings } = useSettings();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const m = preview.manifest;
  const isUpdate = preview.kind === 'update';

  const onCommit = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const { workId, pendingOutcomes } = await commitImport(repo, preview, { source });
      const redeemed = pendingOutcomes.filter((o) => o.status === 'unlocked').length;
      const done = isUpdate ? '更新を読み込みました' : '読み込みました';
      ui.toast(redeemed > 0 ? `${done}。保留中の合言葉を${redeemed}件使いました` : done, { tone: 'ok' });
      const envelopes = openedEnvelopes(pendingOutcomes, workId);
      if (envelopes.length > 0) ui.queueEnvelopes(envelopes);
      onImported(workId);
    } catch (e) {
      ui.toast(errorMessageJa(e), { tone: 'danger' });
      busyRef.current = false;
      setBusy(false);
    }
  };

  if (preview.kind === 'update' && preview.alreadyImported) {
    return (
      <div className="ip stack">
        <FocusHeading>読み込み済みです</FocusHeading>
        <p className="ip-lead">
          このしおりファイルは『{displayTitle(preview.existing, settings)}』にもう読み込まれています。
        </p>
        <div className="ip-actions">
          <button type="button" className="btn" onClick={onCancel}>
            戻る
          </button>
          <button type="button" className="btn btn-primary" onClick={() => onImported(preview.existing.id)}>
            作品を開く
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="ip stack">
      <FocusHeading>{isUpdate ? 'しおりファイルの更新' : 'しおりファイルの確認'}</FocusHeading>

      {preview.kind === 'update' ? (
        <div className="banner ip-update" role="note">
          <span aria-hidden="true">🔄</span>
          <div className="stack-sm">
            <p className="ip-update-line">
              『{displayTitle(preview.existing, settings)}』の更新として読み込みます：追加{preview.diff.added.length}・削除
              {preview.diff.removed.length}
            </p>
            {preview.diff.removed.length > 0 ? (
              <p className="small ip-note">削除された項目の記録は消さずに保管します。</p>
            ) : null}
            {preview.diff.kdfChanged ? (
              <p className="small ip-note">合言葉の鍵が変わりました。入力済みの合言葉は自動で確かめ直します。</p>
            ) : null}
          </div>
        </div>
      ) : null}

      <section className="card ip-summary" aria-label="しおりファイルの内容">
        {preview.kind === 'new' ? (
          <TitleBlock manifest={m} alias={upcomingAlias} aliasOnly={settings.discreet.aliasOnly} />
        ) : (
          <div className="ip-title-row">
            <EmojiCover emoji={preview.existing.coverEmoji} color={preview.existing.coverColor} size={52} />
            <div className="ip-title-text">
              <p className="ip-title">{displayTitle(preview.existing, settings)}</p>
            </div>
          </div>
        )}

        <dl className="ip-meta">
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
            <dd className="ip-version">{m.work.version}</dd>
          </div>
          <div>
            <dt>内容</dt>
            <dd className="ip-counts">
              <span className="ip-nowrap">目標 {preview.stats.goals}</span>・
              <span className="ip-nowrap">合言葉 {preview.stats.codeGoals}</span>・
              <span className="ip-nowrap">おまけ {preview.stats.sealed}</span>
            </dd>
          </div>
        </dl>

        <div className="ip-claim">
          <p className="ip-claim-line">
            作成者の申告：{AUTHOR_KIND_LABEL[m.author.kind]}
            {m.author.name ? `（${m.author.name}）` : ''}
          </p>
          <p className="small muted ip-claim-note">しおり帳は作成者を確認していません。心当たりのないファイルは読み込まないでください。</p>
        </div>
      </section>

      {preview.warnings.length > 0 ? (
        <section className="banner banner-warn ip-warnings" aria-labelledby="ip-warn-title">
          <div className="stack-sm ip-warnings-body">
            <h2 id="ip-warn-title" className="ip-warn-title">
              注意（{preview.warnings.length}件）
            </h2>
            <IssueList issues={preview.warnings} className="is-warn" />
          </div>
        </section>
      ) : null}

      <div className="ip-actions">
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          やめる
        </button>
        <button type="button" className="btn btn-primary" onClick={() => void onCommit()} disabled={busy} aria-busy={busy}>
          {isUpdate ? '更新を読み込む' : '読み込む'}
        </button>
      </div>
    </div>
  );
}

function TitleBlock({ manifest, alias, aliasOnly }: { manifest: ShioriManifestV1; alias: string; aliasOnly: boolean }): ReactNode {
  const [revealed, setRevealed] = useState(false);
  const title = manifest.work.title;
  return (
    <div className="ip-title-row">
      <EmojiCover emoji={defaultCoverEmoji(manifest.work.kind)} color="paper" size={52} />
      <div className="ip-title-text">
        {aliasOnly ? (
          <>
            <p className="ip-title">{alias}</p>
            {revealed ? (
              <p className="ip-real">
                <span className="muted small">本当のタイトル：</span>
                <span>{title}</span>
              </p>
            ) : (
              <button type="button" className="btn btn-sm btn-ghost ip-reveal" onClick={() => setRevealed(true)}>
                本当のタイトルを表示
              </button>
            )}
          </>
        ) : (
          <>
            <p className="ip-title">{title}</p>
            <p className="small muted ip-alias">表示名：{alias}</p>
          </>
        )}
      </div>
    </div>
  );
}

function openedEnvelopes(
  outcomes: readonly UnlockOutcome[],
  fallbackWorkId: string,
): { workId: string; sealedId: string }[] {
  const out: { workId: string; sealedId: string }[] = [];
  for (const o of outcomes) {
    for (const sealedId of o.openedSealedIds) out.push({ workId: o.workId ?? fallbackWorkId, sealedId });
  }
  return out;
}
