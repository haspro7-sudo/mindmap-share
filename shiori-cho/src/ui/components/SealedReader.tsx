// F12 AC3: reads (decrypts) a sealed item via app/unlock.readSealed and renders it as plain text:
// title, body (pre-wrap), `from` signature for letters, returnCode (large monospace + コピー + instruction),
// storeLink (button hidden when hideStoreLinks; confirm before opening), blurExtras support.
// Decrypted payloads live only in React state (F12 AC4): they are decrypted again on every view.
import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { writeClipboard } from '../../app/platform';
import { loadWorkManifest, readSealed } from '../../app/unlock';
import { isShioriError } from '../../core/errors';
import type { SealedItem, SealedPayload } from '../../core/types';
import { useRepoQuery, useSettings, useUi } from '../context';
import { ExternalLinkButton } from './ExternalLinkButton';
import { SEALED_KIND_ICON, SEALED_KIND_LABEL } from './sealedKind';
import './SealedReader.css';

export interface SealedReaderProps {
  workId: string;
  sealedId: string;
}

interface ReaderData {
  item?: Pick<SealedItem, 'id' | 'label' | 'kind' | 'teaser'>;
  payload: SealedPayload | null;
}

export function SealedReader({ workId, sealedId }: SealedReaderProps): ReactNode {
  const { settings } = useSettings();
  const ui = useUi();
  const titleId = useId();
  const [revealed, setRevealed] = useState(false);
  const q = useRepoQuery<ReaderData>(
    async (repo) => {
      const wm = await loadWorkManifest(repo, workId);
      const item = wm?.record.manifest.sealed.find((s) => s.id === sealedId);
      if (!item) return { payload: null };
      const payload = await readSealed(repo, workId, sealedId);
      return { item: { id: item.id, label: item.label, kind: item.kind, teaser: item.teaser }, payload };
    },
    [workId, sealedId],
  );

  if (q.error !== undefined && !q.data) {
    const message = isShioriError(q.error) ? q.error.messageJa : 'おまけを開けませんでした';
    return (
      <div className="sr-state" role="alert">
        <p className="sr-state-icon" aria-hidden="true">
          ⚠️
        </p>
        <p className="sr-state-title">おまけを開けませんでした</p>
        <p className="muted small">{message}</p>
        <button type="button" className="btn btn-sm" onClick={q.reload}>
          もう一度試す
        </button>
      </div>
    );
  }

  if (!q.data) {
    return (
      <div className="sr-state" role="status" aria-busy="true">
        <span className="sr-spinner" aria-hidden="true" />
        <p className="muted">開封しています…</p>
      </div>
    );
  }

  const { item, payload } = q.data;
  if (!item || !payload) {
    return (
      <div className="sr-state">
        <p className="sr-state-icon" aria-hidden="true">
          🔒
        </p>
        <p className="sr-state-title">{item ? item.label : 'おまけが見つかりません'}</p>
        <p className="muted small">
          {item ? 'まだ封印されています。条件の合言葉を入れると読めるようになります。' : 'しおりファイルが更新された可能性があります。'}
        </p>
      </div>
    );
  }

  const blurred = settings.discreet.blurExtras && !revealed;
  const showStore = payload.storeLink !== undefined && !settings.discreet.hideStoreLinks;

  const copy = async (code: string) => {
    const ok = await writeClipboard(code);
    if (ok) ui.toast('コピーしました', { tone: 'ok' });
    else ui.toast('コピーできませんでした。長押しで選択してください', { tone: 'danger' });
  };

  return (
    <article className="sr" aria-labelledby={titleId}>
      <p className="sr-kind">
        <span aria-hidden="true">{SEALED_KIND_ICON[item.kind]}</span>
        <span>{SEALED_KIND_LABEL[item.kind]}</span>
        {item.label !== SEALED_KIND_LABEL[item.kind] && item.label !== payload.title ? (
          <span className="sr-kind-label">・{item.label}</span>
        ) : null}
      </p>
      <h2 id={titleId} className="sr-title">
        {payload.title}
      </h2>

      <div className={`sr-content${blurred ? ' is-blurred' : ''}`}>
        <div className="sr-content-inner" aria-hidden={blurred ? 'true' : undefined}>
          {payload.body !== '' ? <div className="sr-body pre">{payload.body}</div> : null}
          {payload.from ? <p className="sr-from">{payload.from}</p> : null}
          {payload.returnCode ? (
            <section className="sr-return" aria-label="返し合言葉">
              <p className="sr-return-label">返し合言葉</p>
              <p className="sr-return-code mono">{payload.returnCode.code}</p>
              <button
                type="button"
                className="btn btn-sm"
                tabIndex={blurred ? -1 : undefined}
                onClick={() => void copy(payload.returnCode!.code)}
              >
                コピー
              </button>
              <p className="sr-return-instruction pre">{payload.returnCode.instruction}</p>
            </section>
          ) : null}
        </div>
        {blurred ? (
          <button type="button" className="sr-reveal" onClick={() => setRevealed(true)}>
            <span className="sr-reveal-label">タップして本文を表示</span>
          </button>
        ) : null}
      </div>

      {showStore && payload.storeLink ? (
        <div className="sr-store">
          <p className="sr-store-caption">{payload.storeLink.caption}</p>
          <ExternalLinkButton storeCode={payload.storeLink.storeCode} label="作品ページを開く" />
        </div>
      ) : null}
    </article>
  );
}
